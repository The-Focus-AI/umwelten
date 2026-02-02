import { describe, it, expect } from 'vitest';
import { messagesToBeats, formatBeatToolSummary } from './conversation-beats.js';
import type { NormalizedMessage } from './normalized-types.js';

function user(id: string, content: string): NormalizedMessage {
  return { id, role: 'user', content };
}

function assistant(id: string, content: string): NormalizedMessage {
  return { id, role: 'assistant', content };
}

function tool(id: string, name: string, durationMs = 0): NormalizedMessage {
  return {
    id,
    role: 'tool',
    content: '',
    tool: { name, duration: durationMs },
  };
}

describe('messagesToBeats', () => {
  it('returns empty array for no messages', () => {
    expect(messagesToBeats([])).toEqual([]);
  });

  it('ignores leading non-user messages', () => {
    const messages = [
      assistant('a1', 'Hi'),
      tool('t1', 'read', 100),
    ];
    expect(messagesToBeats(messages)).toEqual([]);
  });

  it('creates one beat per user message', () => {
    const messages = [
      user('u1', 'Hello'),
      assistant('a1', 'Hi there'),
      user('u2', 'Help me fix this'),
      assistant('a2', 'Sure'),
      tool('t1', 'run', 50),
      assistant('a3', 'Done.'),
    ];
    const beats = messagesToBeats(messages);
    expect(beats).toHaveLength(2);
    expect(beats[0].userPreview).toContain('Hello');
    expect(beats[0].assistantPreview).toContain('Hi there');
    expect(beats[0].toolCount).toBe(0);
    expect(beats[0].messageIds).toEqual(['u1', 'a1']);
    expect(beats[1].userPreview).toContain('Help me fix');
    expect(beats[1].assistantPreview).toContain('Done');
    expect(beats[1].toolCount).toBe(1);
    expect(beats[1].toolDurationMs).toBe(50);
    expect(beats[1].messageIds).toEqual(['u2', 'a2', 't1', 'a3']);
  });

  it('truncates long user/assistant text in preview', () => {
    const long = 'x'.repeat(200);
    const messages = [user('u1', long), assistant('a1', 'Ok')];
    const beats = messagesToBeats(messages);
    expect(beats[0].userPreview.length).toBeLessThanOrEqual(123);
    expect(beats[0].userPreview).toMatch(/\.\.\.$/);
  });
});

describe('formatBeatToolSummary', () => {
  it('returns empty string for zero tools', () => {
    expect(formatBeatToolSummary(0, 0)).toBe('');
  });

  it('formats seconds when under 60s', () => {
    expect(formatBeatToolSummary(3, 15_000)).toBe('3 tools, 15s');
    expect(formatBeatToolSummary(1, 5_000)).toBe('1 tool, 5s');
  });

  it('formats minutes and seconds when over 60s', () => {
    expect(formatBeatToolSummary(17, 150_000)).toBe('17 tools, 2m 30s');
  });
});
