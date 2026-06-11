/**
 * Unit tests for the pi runtime runner (#122): JSON-lines event parsing →
 * progress callbacks, native session ref extraction, error paths. The
 * subprocess layer is stubbed via spawnFn — no real pi, no network.
 */
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createPiRuntimeRunner,
  piNativeSessionPath,
  piProjectDirName,
  piSessionFileName,
  runPi,
  type PiProgress,
  type PiRunResult,
} from './pi-runner.js';
import type { RuntimeContext } from './bridge/types.js';
import type { AgentEntry } from './types.js';

// ── Stubbed subprocess ────────────────────────────────────────────────

interface FakeSpawnOptions {
  /** stdout payloads, emitted as separate data chunks. */
  chunks: string[];
  exitCode?: number;
  stderr?: string;
  /** Emit a spawn error (e.g. ENOENT) instead of running. */
  error?: Error;
}

function makeSpawnFn(opts: FakeSpawnOptions): {
  spawnFn: any;
  calls: Array<{ cmd: string; args: string[]; options: any }>;
} {
  const calls: Array<{ cmd: string; args: string[]; options: any }> = [];
  const spawnFn = (cmd: string, args: string[], options: any) => {
    calls.push({ cmd, args, options });
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      if (opts.error) {
        proc.emit('error', opts.error);
        return;
      }
      for (const chunk of opts.chunks) {
        proc.stdout.emit('data', Buffer.from(chunk));
      }
      if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
      proc.emit('close', opts.exitCode ?? 0);
    });
    return proc;
  };
  return { spawnFn, calls };
}

const SESSION_LINE = JSON.stringify({
  type: 'session',
  version: 3,
  id: '019eb2f1-6c1b-7188-8978-6ce07381931d',
  timestamp: '2026-06-10T19:10:26.843Z',
  cwd: '/data/agents/coder/repo',
});

function textDelta(delta: string): string {
  return JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta },
  });
}

function thinkingDelta(delta: string): string {
  return JSON.stringify({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta },
  });
}

const TOOL_START = JSON.stringify({
  type: 'tool_execution_start',
  toolCallId: 'tc-1',
  toolName: 'read',
  args: { path: 'note.txt' },
});

const TOOL_END = JSON.stringify({
  type: 'tool_execution_end',
  toolCallId: 'tc-1',
  toolName: 'read',
  result: { content: [{ type: 'text', text: 'hello from probe\n' }] },
  isError: false,
});

const ASSISTANT_END = JSON.stringify({
  type: 'message_end',
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'pondering' },
      { type: 'text', text: 'pi probe ok' },
    ],
  },
});

function happyPathChunks(): string[] {
  return [
    [
      SESSION_LINE,
      thinkingDelta('pond'),
      thinkingDelta('ering'),
      TOOL_START,
      TOOL_END,
      textDelta('pi probe'),
      textDelta(' ok'),
      ASSISTANT_END,
      JSON.stringify({ type: 'agent_end', messages: [] }),
      '',
    ].join('\n'),
  ];
}

describe('runPi (stubbed subprocess)', () => {
  it('spawns pi in JSON print mode in the agent cwd', async () => {
    const { spawnFn, calls } = makeSpawnFn({ chunks: happyPathChunks() });
    await runPi('do the thing', { cwd: '/data/agents/coder/repo', spawnFn });
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('pi');
    expect(calls[0].args).toContain('--mode');
    expect(calls[0].args).toContain('json');
    expect(calls[0].args).toContain('-p');
    expect(calls[0].args[calls[0].args.length - 1]).toBe('do the thing');
    expect(calls[0].options.cwd).toBe('/data/agents/coder/repo');
    // piped stdin makes pi wait for EOF and hang — must be ignored
    expect(calls[0].options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('extracts the native session id and computes its path', async () => {
    const { spawnFn } = makeSpawnFn({ chunks: happyPathChunks() });
    const result = await runPi('go', {
      cwd: '/data/agents/coder/repo',
      env: { PI_CODING_AGENT_DIR: '/data/pi-agent' },
      spawnFn,
    });
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('019eb2f1-6c1b-7188-8978-6ce07381931d');
    expect(result.sessionPath).toBe(
      '/data/pi-agent/sessions/--data-agents-coder-repo--/2026-06-10T19-10-26-843Z_019eb2f1-6c1b-7188-8978-6ce07381931d.jsonl',
    );
  });

  it('streams text, reasoning, and tool activity as progress', async () => {
    const { spawnFn } = makeSpawnFn({ chunks: happyPathChunks() });
    const updates: PiProgress[] = [];
    await runPi('go', {
      cwd: '/x',
      spawnFn,
      onProgress: (u) => updates.push(u),
    });
    expect(updates.map((u) => u.type)).toEqual([
      'reasoning',
      'reasoning',
      'tool_use',
      'tool_result',
      'text',
      'text',
    ]);
    expect(updates.filter((u) => u.type === 'text').map((u) => u.content)).toEqual([
      'pi probe',
      ' ok',
    ]);
    const toolUse = updates.find((u) => u.type === 'tool_use');
    expect(toolUse?.toolName).toBe('read');
    expect(toolUse?.input).toEqual({ path: 'note.txt' });
    const toolResult = updates.find((u) => u.type === 'tool_result');
    expect(toolResult?.toolName).toBe('read');
    expect(toolResult?.content).toBe('hello from probe\n');
    expect(toolResult?.isError).toBe(false);
  });

  it('takes the final content from the last assistant message_end', async () => {
    const { spawnFn } = makeSpawnFn({ chunks: happyPathChunks() });
    const result = await runPi('go', { cwd: '/x', spawnFn });
    expect(result.content).toBe('pi probe ok');
  });

  it('handles JSON lines split across stdout chunks', async () => {
    const whole = happyPathChunks()[0];
    const cut = Math.floor(whole.indexOf('pi probe') + 3);
    const { spawnFn } = makeSpawnFn({
      chunks: [whole.slice(0, cut), whole.slice(cut)],
    });
    const result = await runPi('go', { cwd: '/x', spawnFn });
    expect(result.success).toBe(true);
    expect(result.content).toBe('pi probe ok');
    expect(result.sessionId).toBe('019eb2f1-6c1b-7188-8978-6ce07381931d');
  });

  it('reports a clear error on non-zero exit, carrying stderr', async () => {
    const { spawnFn } = makeSpawnFn({
      chunks: [SESSION_LINE + '\n'],
      exitCode: 1,
      stderr: 'Error: no provider configured',
    });
    const result = await runPi('go', { cwd: '/x', spawnFn });
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('exited with code 1');
    expect(result.errors.join(' ')).toContain('no provider configured');
    // session id still carried for debugging
    expect(result.sessionId).toBe('019eb2f1-6c1b-7188-8978-6ce07381931d');
  });

  it('resolves (not hangs/throws) with a clear error when the binary is missing', async () => {
    const err = Object.assign(new Error('spawn pi ENOENT'), {
      code: 'ENOENT',
    });
    const { spawnFn } = makeSpawnFn({ chunks: [], error: err });
    const result = await runPi('go', { cwd: '/x', spawnFn });
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toMatch(/pi.*not found|not found.*pi/i);
  });

  it('ignores non-JSON stdout noise', async () => {
    const { spawnFn } = makeSpawnFn({
      chunks: [
        'Warning: No models match pattern "x"\n' + happyPathChunks()[0],
      ],
    });
    const result = await runPi('go', { cwd: '/x', spawnFn });
    expect(result.success).toBe(true);
    expect(result.content).toBe('pi probe ok');
  });
});

describe('pi native session path helpers', () => {
  it('encodes the cwd with pi dash convention', () => {
    expect(piProjectDirName('/private/tmp/pi-probe/proj')).toBe(
      '--private-tmp-pi-probe-proj--',
    );
  });

  it('builds the session file name from timestamp and id', () => {
    expect(
      piSessionFileName('2026-06-10T19:10:26.843Z', 'abc-123'),
    ).toBe('2026-06-10T19-10-26-843Z_abc-123.jsonl');
  });

  it('defaults to ~/.pi/agent/sessions/<encoded-cwd>/', () => {
    expect(piNativeSessionPath('/a/b', 'id1', '2026-06-10T19:10:26.843Z', {})).toBe(
      join(
        homedir(),
        '.pi',
        'agent',
        'sessions',
        '--a-b--',
        '2026-06-10T19-10-26-843Z_id1.jsonl',
      ),
    );
  });

  it('honors PI_CODING_AGENT_DIR (nested under sessions/<encoded-cwd>)', () => {
    expect(
      piNativeSessionPath('/a/b', 'id1', '2026-06-10T19:10:26.843Z', {
        PI_CODING_AGENT_DIR: '/data/pi-agent',
      }),
    ).toBe(
      '/data/pi-agent/sessions/--a-b--/2026-06-10T19-10-26-843Z_id1.jsonl',
    );
  });

  it('honors PI_CODING_AGENT_SESSION_DIR (flat, like --session-dir)', () => {
    expect(
      piNativeSessionPath('/a/b', 'id1', '2026-06-10T19:10:26.843Z', {
        PI_CODING_AGENT_SESSION_DIR: '/data/pi-sessions',
        PI_CODING_AGENT_DIR: '/ignored',
      }),
    ).toBe('/data/pi-sessions/2026-06-10T19-10-26-843Z_id1.jsonl');
  });
});

describe('createPiRuntimeRunner', () => {
  const ctx: RuntimeContext = {
    agent: {
      id: 'coder',
      name: 'Coder',
      projectPath: '/data/agents/coder/repo',
    } as AgentEntry,
    sessionId: 'sess-1',
    sessionDir: '/tmp/sessions/sess-1',
    channelKey: 'a2a:ctx-1',
  };

  it('returns content and the pi nativeSessionRef', async () => {
    const runFn = vi.fn(
      async (): Promise<PiRunResult> => ({
        content: 'done',
        success: true,
        errors: [],
        sessionId: 'pi-id-1',
        sessionPath: '/data/pi-agent/sessions/--x--/file.jsonl',
      }),
    );
    const runner = createPiRuntimeRunner(runFn as any);
    const result = await runner.run('task', ctx, { onDone: async () => {} });
    expect(runFn).toHaveBeenCalledWith(
      'task',
      expect.objectContaining({ cwd: '/data/agents/coder/repo' }),
    );
    expect(result.content).toBe('done');
    expect(result.success).toBe(true);
    expect(result.nativeSessionRef).toEqual({
      runtime: 'pi',
      nativeSessionId: 'pi-id-1',
      nativeSessionPath: '/data/pi-agent/sessions/--x--/file.jsonl',
    });
  });

  it('omits nativeSessionRef when pi reported no session', async () => {
    const runFn = vi.fn(
      async (): Promise<PiRunResult> => ({
        content: 'done',
        success: true,
        errors: [],
      }),
    );
    const runner = createPiRuntimeRunner(runFn as any);
    const result = await runner.run('task', ctx, { onDone: async () => {} });
    expect(result.nativeSessionRef).toBeUndefined();
  });

  it('forwards progress to bridge event handlers', async () => {
    const runFn = vi.fn(async (_prompt: string, opts: any): Promise<PiRunResult> => {
      opts.onProgress({ type: 'text', content: 'hi' });
      opts.onProgress({ type: 'reasoning', content: 'hmm' });
      opts.onProgress({
        type: 'tool_use',
        content: 'Using read',
        toolName: 'read',
        input: { path: 'x' },
      });
      opts.onProgress({
        type: 'tool_result',
        content: 'output',
        toolName: 'read',
        isError: true,
      });
      return { content: 'hi', success: true, errors: [] };
    });
    const onText = vi.fn();
    const onReasoning = vi.fn();
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const runner = createPiRuntimeRunner(runFn as any);
    await runner.run('task', ctx, {
      onText,
      onReasoning,
      onToolCall,
      onToolResult,
      onDone: async () => {},
    });
    expect(onText).toHaveBeenCalledWith('hi');
    expect(onReasoning).toHaveBeenCalledWith('hmm');
    expect(onToolCall).toHaveBeenCalledWith('read', { path: 'x' });
    expect(onToolResult).toHaveBeenCalledWith('read', 'output', true);
  });

  it('propagates failure with errors', async () => {
    const runFn = vi.fn(
      async (): Promise<PiRunResult> => ({
        content: '',
        success: false,
        errors: ['pi exited with code 1'],
      }),
    );
    const runner = createPiRuntimeRunner(runFn as any);
    const result = await runner.run('task', ctx, { onDone: async () => {} });
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['pi exited with code 1']);
  });
});
