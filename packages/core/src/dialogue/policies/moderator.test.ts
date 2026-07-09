import { describe, it, expect } from 'vitest';
import { Interaction } from '../../interaction/core/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import type { ModelRunner } from '../../cognition/types.js';
import { ModeratorPolicy } from './moderator.js';
import type { DialogueState, ParticipantInfo } from '../types.js';

const mockModel = { name: 'test-model', provider: 'test' };

function makeModerator(decisions: Array<Record<string, unknown> | Error>) {
  let calls = 0;
  const interaction = new Interaction(
    mockModel,
    new Stimulus({ role: 'conversation moderator' }),
  );
  const runner = {
    async generateObject(target: Interaction) {
      const d = decisions[Math.min(calls, decisions.length - 1)];
      calls++;
      if (d instanceof Error) throw d;
      const content = JSON.stringify(d);
      target.addMessage({ role: 'assistant', content });
      return {
        content,
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          tokenUsage: { promptTokens: 0, completionTokens: 0, total: 0 },
          provider: 'test',
          model: 'test-model',
        },
      };
    },
  };
  (interaction as unknown as { runner: ModelRunner }).runner =
    runner as unknown as ModelRunner;
  return { policy: new ModeratorPolicy(interaction), interaction };
}

const roster: ParticipantInfo[] = [
  { id: 'a', displayName: 'Alice', kind: 'model' },
  { id: 'b', displayName: 'Bob', kind: 'model' },
];

function state(events: Array<{ id: string; name: string; content: string }>, done: string[] = []): DialogueState {
  return {
    events: events.map((e, i) => ({
      seq: i,
      participantId: e.id,
      displayName: e.name,
      kind: 'message' as const,
      content: e.content,
      timestamp: new Date().toISOString(),
    })),
    participants: roster,
    turn: events.length,
    doneSignals: new Set(done),
  };
}

describe('ModeratorPolicy', () => {
  it('picks the speaker the moderator chose (by id or display name)', async () => {
    const { policy } = makeModerator([
      { action: 'speak', speaker: 'b' },
      { action: 'speak', speaker: 'Alice' },
    ]);
    expect(await policy.next(state([]))).toEqual({ speakerId: 'b' });
    expect(await policy.next(state([]))).toEqual({ speakerId: 'a' });
  });

  it('stops with the moderator reason', async () => {
    const { policy } = makeModerator([
      { action: 'stop', reason: 'consensus reached' },
    ]);
    expect(await policy.next(state([]))).toEqual({
      stop: true,
      reason: 'consensus reached',
    });
  });

  it('feeds new labeled events to the moderator', async () => {
    const { policy, interaction } = makeModerator([{ action: 'speak', speaker: 'a' }]);
    await policy.next(state([{ id: 'a', name: 'Alice', content: 'hello there' }]));
    const userMessage = interaction
      .getMessages()
      .find((m) => m.role === 'user');
    expect(String(userMessage?.content)).toContain('[Alice]: hello there');
    expect(String(userMessage?.content)).toContain('a ("Alice"), b ("Bob")');
  });

  it('falls back to round-robin on an unusable decision', async () => {
    const { policy } = makeModerator([
      { action: 'speak', speaker: 'nobody-real' },
      new Error('model exploded'),
    ]);
    // Unknown speaker, empty log → round-robin picks first participant
    expect(await policy.next(state([]))).toEqual({ speakerId: 'a' });
    // Runner failure → round-robin continues from the log
    expect(
      await policy.next(state([{ id: 'a', name: 'Alice', content: 'hi' }])),
    ).toEqual({ speakerId: 'b' });
  });

  it('fallback continues the rotation after moderator-directed turns', async () => {
    const { policy } = makeModerator([
      { action: 'speak', speaker: 'b' },
      new Error('model exploded'),
    ]);
    // Moderator picks b without the fallback ever running…
    expect(await policy.next(state([]))).toEqual({ speakerId: 'b' });
    // …then fails right after b spoke: the fallback must NOT restart at
    // roster[0]-after-a-spoke logic detached from reality — it rotates past b.
    expect(
      await policy.next(
        state([
          { id: 'a', name: 'Alice', content: 'one' },
          { id: 'b', name: 'Bob', content: 'two' },
        ]),
      ),
    ).toEqual({ speakerId: 'a' });
  });

  it('never picks a done participant from the moderator decision', async () => {
    const { policy } = makeModerator([{ action: 'speak', speaker: 'a' }]);
    // 'a' signaled done → fall back to round-robin, which skips it
    expect(await policy.next(state([], ['a']))).toEqual({ speakerId: 'b' });
  });
});
