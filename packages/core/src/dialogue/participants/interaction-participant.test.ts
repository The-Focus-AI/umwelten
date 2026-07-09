import { describe, it, expect } from 'vitest';
import { Interaction } from '../../interaction/core/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import type { ModelRunner } from '../../cognition/types.js';
import {
  InteractionParticipant,
  BOW_OUT_TOOL,
  CONTINUE_NUDGE,
} from './interaction-participant.js';
import type { DialogueEvent, TurnContext } from '../types.js';

const mockModel = { name: 'test-model', provider: 'test' };

/** Fake runner that replays scripted responses and appends the assistant
 *  message to the interaction, mimicking the real runner. */
function makeFakeRunner(
  responses: Array<{ content: string; toolCalls?: Array<{ toolName: string; input?: unknown }> }>,
) {
  let calls = 0;
  const runner = {
    calls: () => calls,
    async streamText(interaction: Interaction) {
      const r = responses[Math.min(calls, responses.length - 1)];
      calls++;
      interaction.addMessage({ role: 'assistant', content: r.content });
      return {
        content: r.content,
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          tokenUsage: { promptTokens: 0, completionTokens: 0, total: 0 },
          provider: 'test',
          model: 'test-model',
          ...(r.toolCalls ? { toolCalls: r.toolCalls } : {}),
        },
      };
    },
  };
  return runner;
}

function makeParticipant(
  responses: Array<{ content: string; toolCalls?: Array<{ toolName: string; input?: unknown }> }>,
  opts?: { displayName?: string; historyWindow?: number },
) {
  const stimulus = new Stimulus({ role: 'debater' });
  const interaction = new Interaction(mockModel, stimulus);
  const runner = makeFakeRunner(responses);
  (interaction as unknown as { runner: ModelRunner }).runner =
    runner as unknown as ModelRunner;
  const participant = new InteractionParticipant({
    id: 'p1',
    displayName: opts?.displayName ?? 'Alice',
    interaction,
    ...(opts?.historyWindow !== undefined
      ? { historyWindow: opts.historyWindow }
      : {}),
  });
  return { participant, interaction, runner };
}

function event(
  participantId: string,
  displayName: string,
  content: string,
  kind: DialogueEvent['kind'] = 'message',
): DialogueEvent {
  return {
    seq: 0,
    participantId,
    displayName,
    kind,
    content,
    timestamp: new Date().toISOString(),
  };
}

const ctx: TurnContext = { dialogueId: 'd1', turn: 1 };

describe('InteractionParticipant', () => {
  it('batches all new events into one labeled user message', async () => {
    const { participant, interaction } = makeParticipant([{ content: 'my reply' }]);
    await participant.takeTurn(
      [
        event('user', 'User', 'debate this', 'seed'),
        event('b', 'Bob', 'I disagree'),
      ],
      ctx,
    );
    const messages = interaction.getMessages();
    // system + one user + one assistant
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('[User]: debate this\n\n[Bob]: I disagree');
    expect(messages[2].role).toBe('assistant');
  });

  it('injects the continue nudge when there are no new events', async () => {
    const { participant, interaction } = makeParticipant([{ content: 'continuing' }]);
    await participant.takeTurn([], ctx);
    expect(interaction.getMessages()[1].content).toBe(CONTINUE_NUDGE);
  });

  it('skips empty-content events (e.g. a human done turn)', async () => {
    const { participant, interaction } = makeParticipant([{ content: 'ok' }]);
    await participant.takeTurn(
      [event('h', 'Will', ''), event('b', 'Bob', 'hello')],
      ctx,
    );
    expect(interaction.getMessages()[1].content).toBe('[Bob]: hello');
  });

  it('strips an echoed self-prefix from the reply', async () => {
    const { participant } = makeParticipant([{ content: '[Alice]: I think so' }]);
    const result = await participant.takeTurn([event('b', 'Bob', 'hi')], ctx);
    expect(result.content).toBe('I think so');
  });

  it('detects and strips a trailing done marker', async () => {
    const { participant } = makeParticipant([
      { content: 'Nothing more to add. <done/>' },
    ]);
    const result = await participant.takeTurn([event('b', 'Bob', 'hi')], ctx);
    expect(result.done).toBe(true);
    expect(result.content).toBe('Nothing more to add.');
  });

  it('ignores an inline done-marker mention (only trailing counts)', async () => {
    const { participant } = makeParticipant([
      { content: 'You can end your message with <done/> when finished.' },
    ]);
    const result = await participant.takeTurn([event('b', 'Bob', 'hi')], ctx);
    expect(result.done).toBeFalsy();
    expect(result.content).toBe(
      'You can end your message with <done/> when finished.',
    );
  });

  it('retries once when a tool-only turn produced no text', async () => {
    const { participant, runner } = makeParticipant([
      { content: '', toolCalls: [{ toolName: 'ripgrep', input: { q: 'x' } }] },
      { content: 'found it' },
    ]);
    const result = await participant.takeTurn([event('b', 'Bob', 'search')], ctx);
    expect(runner.calls()).toBe(2);
    expect(result.content).toBe('found it');
    expect(result.toolCalls).toEqual([{ toolName: 'ripgrep', input: { q: 'x' } }]);
  });

  it('onDialogueStart adds the group preamble and the bow_out tool', async () => {
    const { participant, interaction } = makeParticipant([{ content: 'x' }]);
    participant.onDialogueStart({
      participants: [
        { id: 'p1', displayName: 'Alice', kind: 'model' },
        { id: 'b', displayName: 'Bob', kind: 'model' },
        { id: 'c', displayName: 'Carol', kind: 'model' },
      ],
    });
    const system = String(interaction.getMessages()[0].content);
    expect(system).toContain('You are Alice in a conversation with Bob, Carol');
    expect(system).toContain(BOW_OUT_TOOL);
    expect(system).not.toContain('conversation with Alice');
    expect(Object.keys(interaction.getStimulus().getTools())).toContain(
      BOW_OUT_TOOL,
    );
  });

  it('treats a bow_out tool call as a structured done signal (silent exit, no retry)', async () => {
    const { participant, runner } = makeParticipant([
      { content: '', toolCalls: [{ toolName: BOW_OUT_TOOL, input: {} }] },
      { content: 'should never be requested' },
    ]);
    const result = await participant.takeTurn([event('b', 'Bob', 'hi')], ctx);
    expect(result.done).toBe(true);
    expect(result.content).toBe('');
    // No tool-only follow-up retry for a deliberate exit…
    expect(runner.calls()).toBe(1);
    // …and the protocol tool is not reported as conversational tool use.
    expect(result.toolCalls).toBeUndefined();
  });

  it('bow_out alongside a goodbye keeps the goodbye text', async () => {
    const { participant } = makeParticipant([
      { content: 'It was a pleasure — farewell.', toolCalls: [{ toolName: BOW_OUT_TOOL }] },
    ]);
    const result = await participant.takeTurn([event('b', 'Bob', 'bye')], ctx);
    expect(result.done).toBe(true);
    expect(result.content).toBe('It was a pleasure — farewell.');
  });

  it('renders ambient events as unattributed parentheticals', async () => {
    const { participant, interaction } = makeParticipant([{ content: 'ok' }]);
    await participant.takeTurn(
      [
        event('b', 'Bob', 'hello'),
        event('world', 'World', 'The lights flicker.', 'event'),
      ],
      ctx,
    );
    expect(interaction.getMessages()[1].content).toBe(
      '[Bob]: hello\n\n(The lights flicker.)',
    );
  });

  it('historyWindow stores own turns as self-narration and bounds the view', async () => {
    const { participant, interaction } = makeParticipant(
      [{ content: 'reply one' }, { content: 'reply two' }, { content: 'reply three' }],
      { historyWindow: 4 },
    );
    await participant.takeTurn([event('b', 'Bob', 'one')], ctx);
    await participant.takeTurn([event('b', 'Bob', 'two')], ctx);
    await participant.takeTurn([event('b', 'Bob', 'three')], ctx);

    const messages = interaction.getMessages();
    const nonSystem = messages.filter((m) => m.role !== 'system');
    expect(nonSystem.length).toBeLessThanOrEqual(4);
    // Window starts on a user turn, and own turns are narration, not raw output.
    expect(nonSystem[0].role).toBe('user');
    const lastAssistant = [...nonSystem].reverse().find((m) => m.role === 'assistant');
    expect(lastAssistant?.content).toBe('[You said: "reply three"]');
  });

  it('onDialogueEnd restores the pre-dialogue stimulus (no leak, no stacking)', async () => {
    const { participant, interaction } = makeParticipant([{ content: 'x' }]);
    const before = String(interaction.getMessages()[0].content);
    const roster = {
      participants: [
        { id: 'p1', displayName: 'Alice', kind: 'model' as const },
        { id: 'b', displayName: 'Bob', kind: 'model' as const },
      ],
    };

    participant.onDialogueStart(roster);
    expect(String(interaction.getMessages()[0].content)).toContain(BOW_OUT_TOOL);
    participant.onDialogueEnd();
    expect(String(interaction.getMessages()[0].content)).toBe(before);
    expect(Object.keys(interaction.getStimulus().getTools())).not.toContain(
      BOW_OUT_TOOL,
    );

    // A second dialogue must not stack a duplicate preamble.
    participant.onDialogueStart(roster);
    const system = String(interaction.getMessages()[0].content);
    expect(system.match(/You are Alice in a conversation/g)).toHaveLength(1);
    participant.onDialogueEnd();
    expect(String(interaction.getMessages()[0].content)).toBe(before);
  });

  it('exposes provider/model for session metadata', () => {
    const { participant } = makeParticipant([{ content: 'x' }]);
    expect(participant.model).toBe('test/test-model');
  });
});
