import { describe, it, expect } from 'vitest';
import { RoundRobinPolicy } from './round-robin.js';
import type { DialogueEvent, DialogueState, ParticipantInfo } from '../types.js';

function messageEvent(participantId: string, seq: number): DialogueEvent {
  return {
    seq,
    participantId,
    displayName: participantId.toUpperCase(),
    kind: 'message',
    content: `msg ${seq}`,
    timestamp: new Date().toISOString(),
  };
}

/** State whose event log records the given speakers, in order. */
function stateWith(
  participants: ParticipantInfo[],
  spoke: string[] = [],
  done: string[] = [],
): DialogueState {
  return {
    events: spoke.map((id, i) => messageEvent(id, i)),
    participants,
    turn: spoke.length,
    doneSignals: new Set(done),
  };
}

const roster: ParticipantInfo[] = [
  { id: 'a', displayName: 'A', kind: 'model' },
  { id: 'b', displayName: 'B', kind: 'model' },
  { id: 'c', displayName: 'C', kind: 'model' },
];

describe('RoundRobinPolicy', () => {
  it('cycles participants in roster order', () => {
    const policy = new RoundRobinPolicy();
    expect(policy.next(stateWith(roster))).toEqual({ speakerId: 'a' });
    expect(policy.next(stateWith(roster, ['a']))).toEqual({ speakerId: 'b' });
    expect(policy.next(stateWith(roster, ['a', 'b']))).toEqual({ speakerId: 'c' });
    expect(policy.next(stateWith(roster, ['a', 'b', 'c']))).toEqual({ speakerId: 'a' });
  });

  it('skips participants that signaled done', () => {
    const policy = new RoundRobinPolicy();
    expect(policy.next(stateWith(roster, [], ['b']))).toEqual({ speakerId: 'a' });
    expect(policy.next(stateWith(roster, ['a'], ['b']))).toEqual({ speakerId: 'c' });
    expect(policy.next(stateWith(roster, ['a', 'c'], ['b']))).toEqual({ speakerId: 'a' });
  });

  it('stops when everyone signaled done', () => {
    const policy = new RoundRobinPolicy();
    const next = policy.next(stateWith(roster, [], ['a', 'b', 'c']));
    expect(next).toHaveProperty('stop', true);
  });

  it('respects an explicit order', () => {
    const policy = new RoundRobinPolicy(['c', 'a']);
    expect(policy.next(stateWith(roster))).toEqual({ speakerId: 'c' });
    expect(policy.next(stateWith(roster, ['c']))).toEqual({ speakerId: 'a' });
    expect(policy.next(stateWith(roster, ['c', 'a']))).toEqual({ speakerId: 'c' });
  });

  it('continues the rotation from the log even when consulted intermittently', () => {
    // A moderator directed several turns without ever calling this policy;
    // the fallback must pick up from whoever spoke last, not roster[0].
    const policy = new RoundRobinPolicy();
    expect(policy.next(stateWith(roster, ['a', 'b', 'c', 'a']))).toEqual({
      speakerId: 'b',
    });
  });

  it('ignores non-roster speakers (e.g. human interjections) when rotating', () => {
    const policy = new RoundRobinPolicy();
    const state = stateWith(roster, ['a']);
    state.events.push(messageEvent('human-observer', 99));
    expect(policy.next(state)).toEqual({ speakerId: 'b' });
  });
});
