import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processBridgeCommand } from './commands.js';
import type { ChannelBridge } from './channel-bridge.js';
import type { RouteResolution } from './types.js';

function makeMockBridge(overrides?: Partial<ChannelBridge>): ChannelBridge {
  return {
    resetChannel: vi.fn(),
    resetAll: vi.fn(),
    listAgents: vi.fn(() => [
      { id: 'ops', name: 'Operations' },
      { id: 'coding', name: 'Coding Agent' },
    ]),
    switchAgent: vi.fn(async () => ({ kind: 'main' } as RouteResolution)),
    resolveRoute: vi.fn(async () => ({ kind: 'main' } as RouteResolution)),
    handleMessage: vi.fn(),
    getChannelSessionId: vi.fn(),
    ...overrides,
  } as unknown as ChannelBridge;
}

describe('processBridgeCommand', () => {
  it('returns handled: false for non-commands', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', 'hello world');
    expect(result.handled).toBe(false);
  });

  it('returns handled: false for unknown commands', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/foobar');
    expect(result.handled).toBe(false);
  });

  it('handles /reset', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/reset');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('cleared');
    expect(bridge.resetChannel).toHaveBeenCalledWith('web:123');
  });

  it('handles /start as alias for /reset', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'telegram:456', '/start');
    expect(result.handled).toBe(true);
    expect(bridge.resetChannel).toHaveBeenCalledWith('telegram:456');
  });

  it('handles /agents', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/agents');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('ops');
    expect(result.text).toContain('coding');
    expect(result.text).toContain('2');
  });

  it('handles /switch with an agent id', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'discord:999', '/switch ops');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('ops');
    expect(bridge.switchAgent).toHaveBeenCalledWith('discord:999', 'ops');
  });

  it('handles /switch main', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/switch main');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('main');
    expect(bridge.switchAgent).toHaveBeenCalledWith('web:123', null);
  });

  it('handles /switch with unknown agent', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/switch nonexistent');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('not found');
    expect(bridge.switchAgent).not.toHaveBeenCalled();
  });

  it('handles /switch without arg', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/switch');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('Usage');
  });

  it('handles /switch-claude', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/switch-claude coding');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('Claude SDK');
    expect(bridge.switchAgent).toHaveBeenCalledWith('web:123', 'coding', 'claude-sdk');
  });

  it('handles /status for main route', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/status');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('main');
  });

  it('handles /status for agent route', async () => {
    const bridge = makeMockBridge({
      resolveRoute: vi.fn(async () => ({ kind: 'agent', agentId: 'ops', runtime: 'default' } as RouteResolution)),
    });
    const result = await processBridgeCommand(bridge, 'web:123', '/status');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('ops');
  });

  it('handles /help', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/help');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('reset');
    expect(result.text).toContain('agents');
    expect(result.text).toContain('switch');
    expect(result.text).toContain('status');
  });

  it('is case-insensitive', async () => {
    const bridge = makeMockBridge();
    const result = await processBridgeCommand(bridge, 'web:123', '/AGENTS');
    expect(result.handled).toBe(true);
    expect(result.text).toContain('ops');
  });
});
