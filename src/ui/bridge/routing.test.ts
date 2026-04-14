import { describe, it, expect } from 'vitest';
import {
  resolveChannelRoute,
  routeSignature,
  coerceChannelBinding,
} from './routing.js';
import type { RoutingConfig } from './types.js';

describe('routing', () => {
  describe('coerceChannelBinding', () => {
    it('returns null for undefined', () => {
      expect(coerceChannelBinding(undefined)).toBeNull();
    });

    it('coerces a string to a binding', () => {
      expect(coerceChannelBinding('ops')).toEqual({
        agentId: 'ops',
        runtime: 'default',
      });
    });

    it('returns null for empty string', () => {
      expect(coerceChannelBinding('')).toBeNull();
    });

    it('normalizes a partial binding object', () => {
      expect(coerceChannelBinding({ agentId: 'coding', runtime: 'claude-sdk' }))
        .toEqual({ agentId: 'coding', runtime: 'claude-sdk' });
    });

    it('defaults runtime to default', () => {
      expect(coerceChannelBinding({ agentId: 'ops' }))
        .toEqual({ agentId: 'ops', runtime: 'default' });
    });
  });

  describe('resolveChannelRoute', () => {
    const routing: RoutingConfig = {
      channels: {
        'discord:111': 'ops',
        'telegram:222': { agentId: 'coding', runtime: 'claude-sdk' },
        'discord:parent-333': 'jeeves',
      },
      defaultAgentId: 'fallback',
      platformDefaults: {
        slack: { agentId: 'slack-default' },
      },
    };

    it('resolves exact channel match', () => {
      expect(resolveChannelRoute('discord:111', routing)).toEqual({
        kind: 'agent',
        agentId: 'ops',
        runtime: 'default',
      });
    });

    it('resolves exact match with runtime', () => {
      expect(resolveChannelRoute('telegram:222', routing)).toEqual({
        kind: 'agent',
        agentId: 'coding',
        runtime: 'claude-sdk',
      });
    });

    it('inherits from parent channel', () => {
      expect(resolveChannelRoute('discord:thread-444', routing, 'discord:parent-333')).toEqual({
        kind: 'agent',
        agentId: 'jeeves',
        runtime: 'default',
      });
    });

    it('uses platform default when no channel match', () => {
      expect(resolveChannelRoute('slack:C999', routing)).toEqual({
        kind: 'agent',
        agentId: 'slack-default',
        runtime: 'default',
      });
    });

    it('uses global default when no platform match', () => {
      expect(resolveChannelRoute('teams:T999', routing)).toEqual({
        kind: 'agent',
        agentId: 'fallback',
        runtime: 'default',
      });
    });

    it('returns main when no match at all', () => {
      const empty: RoutingConfig = { channels: {} };
      expect(resolveChannelRoute('web:abc', empty)).toEqual({
        kind: 'main',
      });
    });
  });

  describe('routeSignature', () => {
    it('returns main for main route', () => {
      expect(routeSignature({ kind: 'main' })).toBe('main');
    });

    it('returns agent signature', () => {
      expect(routeSignature({ kind: 'agent', agentId: 'ops', runtime: 'default' }))
        .toBe('agent:ops:default');
    });

    it('includes runtime in signature', () => {
      expect(routeSignature({ kind: 'agent', agentId: 'ops', runtime: 'claude-sdk' }))
        .toBe('agent:ops:claude-sdk');
    });
  });
});
