import { describe, it, expect } from 'vitest';
import {
  parseJSONLLine,
  extractConversation,
  extractToolCalls,
  calculateTokenUsage,
  calculateCost,
  summarizeSession,
  extractTextContent,
} from './session-parser.js';
import type {
  SessionMessage,
  UserMessageEntry,
  AssistantMessageEntry,
  TokenUsage,
} from './types.js';

describe('SessionParser', () => {
  describe('parseJSONLLine', () => {
    it('should parse valid JSON line', () => {
      const line = JSON.stringify({ type: 'summary', summary: 'Test', leafUuid: '123' });
      const result = parseJSONLLine(line);

      expect(result).toEqual({ type: 'summary', summary: 'Test', leafUuid: '123' });
    });

    it('should return null for empty line', () => {
      const result = parseJSONLLine('');
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const result = parseJSONLLine('invalid json');
      expect(result).toBeNull();
    });
  });

  describe('extractConversation', () => {
    it('should separate user and assistant messages', () => {
      const messages: SessionMessage[] = [
        {
          type: 'user',
          message: { role: 'user', content: 'Hello' },
          uuid: '1',
          timestamp: '2026-01-20T10:00:00.000Z',
        } as UserMessageEntry,
        {
          type: 'assistant',
          message: { role: 'assistant', content: 'Hi' },
          uuid: '2',
          timestamp: '2026-01-20T10:00:01.000Z',
        } as AssistantMessageEntry,
        {
          type: 'progress',
          data: { type: 'test' },
        } as SessionMessage,
      ];

      const result = extractConversation(messages);

      expect(result.user).toHaveLength(1);
      expect(result.assistant).toHaveLength(1);
      expect(result.user[0].message.content).toBe('Hello');
      expect(result.assistant[0].message.content).toBe('Hi');
    });
  });

  describe('extractToolCalls', () => {
    it('should extract tool calls from assistant messages', () => {
      const messages: SessionMessage[] = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me help' },
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'calculator',
                input: { operation: 'add', numbers: [1, 2] },
              },
            ],
          },
          uuid: 'msg-1',
          timestamp: '2026-01-20T10:00:00.000Z',
        } as AssistantMessageEntry,
      ];

      const toolCalls = extractToolCalls(messages);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].id).toBe('tool-1');
      expect(toolCalls[0].name).toBe('calculator');
      expect(toolCalls[0].input).toEqual({ operation: 'add', numbers: [1, 2] });
    });

    it('should handle messages with no tool calls', () => {
      const messages: SessionMessage[] = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello' }],
          },
          uuid: 'msg-1',
          timestamp: '2026-01-20T10:00:00.000Z',
        } as AssistantMessageEntry,
      ];

      const toolCalls = extractToolCalls(messages);
      expect(toolCalls).toHaveLength(0);
    });
  });

  describe('calculateTokenUsage', () => {
    it('should sum token usage from assistant messages', () => {
      const messages: SessionMessage[] = [
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: 'Response 1',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 5,
              cache_creation: {
                ephemeral_5m_input_tokens: 10,
                ephemeral_1h_input_tokens: 0,
              },
            },
          },
          uuid: 'msg-1',
          timestamp: '2026-01-20T10:00:00.000Z',
        } as AssistantMessageEntry,
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: 'Response 2',
            usage: {
              input_tokens: 200,
              output_tokens: 100,
              cache_creation_input_tokens: 20,
              cache_read_input_tokens: 10,
            },
          },
          uuid: 'msg-2',
          timestamp: '2026-01-20T10:00:01.000Z',
        } as AssistantMessageEntry,
      ];

      const usage = calculateTokenUsage(messages);

      expect(usage.input_tokens).toBe(300);
      expect(usage.output_tokens).toBe(150);
      expect(usage.cache_creation_input_tokens).toBe(30);
      expect(usage.cache_read_input_tokens).toBe(15);
    });

    it('should handle messages without usage', () => {
      const messages: SessionMessage[] = [
        {
          type: 'user',
          message: { role: 'user', content: 'Hello' },
          uuid: 'msg-1',
          timestamp: '2026-01-20T10:00:00.000Z',
        } as UserMessageEntry,
      ];

      const usage = calculateTokenUsage(messages);

      expect(usage.input_tokens).toBe(0);
      expect(usage.output_tokens).toBe(0);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost correctly', () => {
      const usage: TokenUsage = {
        input_tokens: 1_000_000, // $3
        output_tokens: 1_000_000, // $15
        cache_creation_input_tokens: 1_000_000, // $3.75
        cache_read_input_tokens: 1_000_000, // $0.30
      };

      const cost = calculateCost(usage);

      // $3 + $15 + $3.75 + $0.30 = $22.05
      expect(cost).toBeCloseTo(22.05, 2);
    });

    it('should handle zero tokens', () => {
      const usage: TokenUsage = {
        input_tokens: 0,
        output_tokens: 0,
      };

      const cost = calculateCost(usage);
      expect(cost).toBe(0);
    });
  });

  describe('summarizeSession', () => {
    it('should create session summary', () => {
      const messages: SessionMessage[] = [
        {
          type: 'user',
          message: { role: 'user', content: 'First message' },
          uuid: 'msg-1',
          timestamp: '2026-01-20T10:00:00.000Z',
        } as UserMessageEntry,
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Response' },
              { type: 'tool_use', id: 'tool-1', name: 'test', input: {} },
            ],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          },
          uuid: 'msg-2',
          timestamp: '2026-01-20T10:00:01.000Z',
        } as AssistantMessageEntry,
        {
          type: 'user',
          message: { role: 'user', content: 'Last message' },
          uuid: 'msg-3',
          timestamp: '2026-01-20T10:01:00.000Z',
        } as UserMessageEntry,
      ];

      const summary = summarizeSession(messages);

      expect(summary.totalMessages).toBe(3);
      expect(summary.userMessages).toBe(2);
      expect(summary.assistantMessages).toBe(1);
      expect(summary.toolCalls).toBe(1);
      expect(summary.firstMessage).toBe('First message');
      expect(summary.lastMessage).toBe('Last message');
      expect(summary.duration).toBe(60000); // 1 minute
    });
  });

  describe('extractTextContent', () => {
    it('should extract text from string content', () => {
      const result = extractTextContent('Hello world');
      expect(result).toEqual(['Hello world']);
    });

    it('should extract text from content blocks', () => {
      const content = [
        { type: 'text', text: 'First text' },
        { type: 'tool_use', id: '1', name: 'test', input: {} },
        { type: 'text', text: 'Second text' },
      ];

      const result = extractTextContent(content);
      expect(result).toEqual(['First text', 'Second text']);
    });
  });
});
