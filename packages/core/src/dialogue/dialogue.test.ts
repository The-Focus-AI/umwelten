import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dialogue } from './dialogue.js';
import type {
  DialogueEvent,
  Participant,
  TurnContext,
  TurnResult,
} from './types.js';

/** A scripted participant that records every delta feed it receives. */
function makeParticipant(
  id: string,
  displayName: string,
  reply: (newEvents: DialogueEvent[], turn: number) => TurnResult,
): Participant & { received: DialogueEvent[][] } {
  const received: DialogueEvent[][] = [];
  return {
    id,
    displayName,
    kind: 'model' as const,
    received,
    async takeTurn(newEvents: DialogueEvent[], ctx: TurnContext) {
      received.push(newEvents);
      return reply(newEvents, ctx.turn);
    },
  };
}

const echo =
  (text: string) =>
  (_events: DialogueEvent[], turn: number): TurnResult => ({
    content: `${text} ${turn}`,
  });

describe('Dialogue', () => {
  it('requires at least 2 participants with unique ids', () => {
    const a = makeParticipant('a', 'A', echo('a'));
    expect(() => new Dialogue({ participants: [a], seed: { content: 'hi' } })).toThrow(
      /at least 2/,
    );
    const a2 = makeParticipant('a', 'A2', echo('a'));
    expect(
      () => new Dialogue({ participants: [a, a2], seed: { content: 'hi' } }),
    ).toThrow(/unique/);
  });

  it('alternates round-robin and stops at maxTurns', async () => {
    const a = makeParticipant('a', 'A', echo('alpha'));
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'debate this' },
      stop: { maxTurns: 4 },
    });
    const result = await dialogue.run();

    expect(result.stoppedBy).toBe('maxTurns');
    expect(result.turns).toBe(4);
    const speakers = result.events
      .filter((e) => e.kind === 'message')
      .map((e) => e.participantId);
    expect(speakers).toEqual(['a', 'b', 'a', 'b']);
  });

  it('feeds each participant only the events since its last turn', async () => {
    const a = makeParticipant('a', 'A', echo('alpha'));
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'debate this' },
      stop: { maxTurns: 4 },
    });
    await dialogue.run();

    // A's first turn sees only the seed
    expect(a.received[0].map((e) => e.kind)).toEqual(['seed']);
    // B's first turn sees the seed AND A's first message
    expect(b.received[0].map((e) => e.participantId)).toEqual(['user', 'a']);
    expect(b.received[0][1].content).toBe('alpha 1');
    // A's second turn sees only B's message
    expect(a.received[1].map((e) => e.participantId)).toEqual(['b']);
  });

  it('stops with allDone when every participant signals done', async () => {
    const a = makeParticipant('a', 'A', () => ({ content: 'done a', done: true }));
    const b = makeParticipant('b', 'B', () => ({ content: 'done b', done: true }));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 10 },
    });
    const result = await dialogue.run();
    expect(result.stoppedBy).toBe('allDone');
    expect(result.turns).toBe(2);
  });

  it('round-robin skips a done participant while others continue', async () => {
    let bTurns = 0;
    const a = makeParticipant('a', 'A', () => ({ content: 'im out', done: true }));
    const b = makeParticipant('b', 'B', () => {
      bTurns++;
      return { content: `b ${bTurns}`, done: bTurns >= 2 };
    });
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 10 },
    });
    const result = await dialogue.run();
    const speakers = result.events
      .filter((e) => e.kind === 'message')
      .map((e) => e.participantId);
    expect(speakers).toEqual(['a', 'b', 'b']);
    expect(result.stoppedBy).toBe('allDone');
  });

  it('stops with anyDone when configured', async () => {
    const a = makeParticipant('a', 'A', () => ({ content: 'done', done: true }));
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 10, stopWhen: 'anyDone' },
    });
    const result = await dialogue.run();
    expect(result.stoppedBy).toBe('anyDone');
    expect(result.turns).toBe(1);
  });

  it('honors an until predicate', async () => {
    const a = makeParticipant('a', 'A', echo('alpha'));
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 10, until: (state) => state.turn >= 3 },
    });
    const result = await dialogue.run();
    expect(result.stoppedBy).toBe('until');
    expect(result.turns).toBe(3);
  });

  it('honors an abort signal', async () => {
    const controller = new AbortController();
    const a = makeParticipant('a', 'A', () => {
      controller.abort();
      return { content: 'last words' };
    });
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 10, signal: controller.signal },
    });
    const result = await dialogue.run();
    expect(result.stoppedBy).toBe('abort');
    expect(result.turns).toBe(1);
  });

  it('records a moderator event when the policy stops the dialogue', async () => {
    const a = makeParticipant('a', 'A', echo('alpha'));
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      policy: {
        next: (state) =>
          state.turn >= 1
            ? { stop: true, reason: 'we are going in circles' }
            : { speakerId: 'a' },
      },
      stop: { maxTurns: 10 },
    });
    const result = await dialogue.run();
    expect(result.stoppedBy).toBe('policy');
    const moderatorEvent = result.events.find((e) => e.kind === 'moderator');
    expect(moderatorEvent?.content).toBe('we are going in circles');
  });

  it('applies the default maxTurns when stop fields are explicitly undefined', async () => {
    const a = makeParticipant('a', 'A', echo('alpha'));
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      // Idiomatic conditional construction — must not erase the 8-turn cap.
      stop: { maxTurns: undefined, stopWhen: undefined },
    });
    const result = await dialogue.run();
    expect(result.stoppedBy).toBe('maxTurns');
    expect(result.turns).toBe(8);
  });

  it('delivers a post() that lands while a turn is in flight to that speaker', async () => {
    const dialogueRef: { current?: Dialogue } = {};
    let posted = false;
    const a = makeParticipant('a', 'A', () => {
      if (!posted) {
        posted = true;
        // Human interjects while A is still "generating".
        dialogueRef.current!.post({
          participantId: 'human',
          displayName: 'Will',
          content: 'mid-turn note',
        });
      }
      return { content: 'alpha' };
    });
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 3 },
    });
    dialogueRef.current = dialogue;
    await dialogue.run();

    // A's next turn must include the interjection but never its own message.
    expect(a.received[1].map((e) => e.participantId)).toEqual(['human', 'b']);
  });

  it('calls onDialogueEnd on every participant when the dialogue stops', async () => {
    const ended: string[] = [];
    const withEnd = (p: ReturnType<typeof makeParticipant>) =>
      Object.assign(p, { onDialogueEnd: () => ended.push(p.id) });
    const a = withEnd(makeParticipant('a', 'A', echo('alpha')));
    const b = withEnd(makeParticipant('b', 'B', echo('beta')));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 2 },
    });
    await dialogue.run();
    expect(ended.sort()).toEqual(['a', 'b']);
  });

  it('post(kind: "event") flows to participants and persists as user input', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dialogue-event-test-'));
    const a = makeParticipant('a', 'Alice', echo('alpha'));
    const b = makeParticipant('b', 'Bob', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 2 },
      persistDir: dir,
    });
    await dialogue.step(); // Alice speaks
    dialogue.post({
      participantId: 'world',
      displayName: 'World',
      content: 'The lights flicker.',
      kind: 'event',
    });
    await dialogue.step(); // Bob perceives seed + Alice + the event
    expect(b.received[0].map((e) => e.kind)).toEqual(['seed', 'message', 'event']);

    await dialogue.run();
    const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
    const lines = transcript.trim().split('\n').map((l) => JSON.parse(l));
    const eventLine = lines.find((l) =>
      String(l.message.content).includes('lights flicker'),
    );
    expect(eventLine.type).toBe('user');
    expect(eventLine.message.content).toBe('(The lights flicker.)');
  });

  it('post() interjections appear in the next delta feed', async () => {
    const a = makeParticipant('a', 'A', echo('alpha'));
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
      stop: { maxTurns: 3 },
    });
    await dialogue.step(); // A speaks
    dialogue.post({ participantId: 'human', displayName: 'Will', content: 'louder please' });
    await dialogue.step(); // B speaks — sees seed, A, and Will
    expect(b.received[0].map((e) => e.participantId)).toEqual(['user', 'a', 'human']);
  });

  it('propagates participant errors after recording the stop', async () => {
    const a = makeParticipant('a', 'A', () => {
      throw new Error('model exploded');
    });
    const b = makeParticipant('b', 'B', echo('beta'));
    const dialogue = new Dialogue({
      participants: [a, b],
      seed: { content: 'topic' },
    });
    await expect(dialogue.run()).rejects.toThrow('model exploded');
    expect(await dialogue.step()).toBeNull();
  });

  it('persists transcript.jsonl and meta.json when persistDir is set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dialogue-test-'));
    const a = makeParticipant('a', 'Alice', echo('alpha'));
    const b = makeParticipant('b', 'Bob', echo('beta'));
    const dialogue = new Dialogue({
      id: 'dialogue-test-1',
      participants: [a, b],
      seed: { content: 'debate this' },
      stop: { maxTurns: 2 },
      persistDir: dir,
    });
    await dialogue.run();

    const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
    const lines = transcript.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].type).toBe('user');
    expect(lines[0].message.content).toBe('[User]: debate this');
    expect(lines[1].type).toBe('assistant');
    expect(lines[1].message.content).toBe('[Alice]: alpha 1');
    expect(lines[2].message.content).toBe('[Bob]: beta 2');

    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf-8'));
    expect(meta.sessionId).toBe('dialogue-test-1');
    expect(meta.type).toBe('dialogue');
    expect(meta.metadata.participants.map((p: { id: string }) => p.id)).toEqual(['a', 'b']);
    expect(meta.metadata.stoppedBy).toBe('maxTurns');
    expect(meta.metadata.turns).toBe(2);
  });
});
