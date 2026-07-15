/**
 * Unit tests for the generic CLI runtime runner: spec resolution (presets),
 * arg templating + mise wrapping, scoped env building, credential-file
 * materialization, text + codex-json parsing, and the RuntimeRunner
 * adapter. The subprocess layer is stubbed via spawnFn — no real CLIs.
 */
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildConfiguredRuntimeRunners,
  buildInvocation,
  buildRuntimeEnv,
  createCliRuntimeRunner,
  materializeCredentialFiles,
  resolveRuntimeSpec,
  runCliAgent,
  RUNTIME_PRESETS,
  type CliProgress,
  type CliRunResult,
  type RuntimeSecretSource,
} from './cli-runner.js';
import type { RuntimeSpec } from './types.js';
import type { RuntimeContext } from './bridge/types.js';
import type { AgentEntry } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────

function secretSource(map: Record<string, string>): RuntimeSecretSource {
  return {
    getSecret: (name) => map[name],
    listSecretNames: () => Object.keys(map),
  };
}

interface FakeSpawnOptions {
  chunks: string[];
  exitCode?: number;
  stderr?: string;
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

const agent: AgentEntry = {
  id: 'workspace',
  name: 'Workspace',
  projectPath: '/data/workspace',
} as AgentEntry;

const ctx: RuntimeContext = {
  agent,
  sessionId: 'sess-1',
  sessionDir: '/data/sessions/sess-1',
  channelKey: 'web:test',
};

// ── Spec resolution ───────────────────────────────────────────────────

describe('resolveRuntimeSpec', () => {
  it('resolves the codex preset from `true`', () => {
    const spec = resolveRuntimeSpec('codex', true);
    expect(spec?.command).toBe('codex');
    expect(spec?.parser).toBe('codex-json');
    expect(spec?.secrets).toEqual(['OPENAI_API_KEY']);
    expect(spec?.args).toContain('--json');
  });

  it('merges overrides over the preset (explicit wins)', () => {
    const spec = resolveRuntimeSpec('codex', { secrets: ['MY_OPENAI_KEY'] });
    expect(spec?.command).toBe('codex');
    expect(spec?.secrets).toEqual(['MY_OPENAI_KEY']);
  });

  it('accepts an unknown name with a full spec', () => {
    const spec = resolveRuntimeSpec('opencode', {
      command: 'opencode',
      args: ['run', '{prompt}'],
    });
    expect(spec?.command).toBe('opencode');
  });

  it('returns undefined for an unknown name with no command', () => {
    expect(resolveRuntimeSpec('mystery', true)).toBeUndefined();
    expect(resolveRuntimeSpec('mystery', { secrets: ['X'] })).toBeUndefined();
  });
});

// ── Arg templating ────────────────────────────────────────────────────

describe('buildInvocation', () => {
  it('substitutes {prompt} and {cwd}', () => {
    const spec: RuntimeSpec = {
      command: 'codex',
      args: ['exec', '--cd', '{cwd}', '{prompt}'],
    };
    expect(buildInvocation(spec, 'fix the bug', '/proj')).toEqual({
      command: 'codex',
      args: ['exec', '--cd', '/proj', 'fix the bug'],
    });
  });

  it('appends the prompt when no arg references it', () => {
    const spec: RuntimeSpec = { command: 'opencode', args: ['run'] };
    expect(buildInvocation(spec, 'do it', '/proj').args).toEqual(['run', 'do it']);
  });

  it('wraps in mise x -- when mise is true', () => {
    const spec: RuntimeSpec = { command: 'aider', args: ['--message', '{prompt}'], mise: true };
    expect(buildInvocation(spec, 'refactor', '/proj')).toEqual({
      command: 'mise',
      args: ['x', '--', 'aider', '--message', 'refactor'],
    });
  });
});

// ── Env scoping ───────────────────────────────────────────────────────

describe('buildRuntimeEnv', () => {
  it('scrubs every habitat secret, re-adds only declared ones', () => {
    process.env.CLI_RUNNER_TEST_TAVILY = 'tavily-secret';
    process.env.CLI_RUNNER_TEST_OPENAI = 'stale-env-value';
    try {
      const secrets = secretSource({
        CLI_RUNNER_TEST_TAVILY: 'tavily-secret',
        CLI_RUNNER_TEST_OPENAI: 'openai-secret',
      });
      const env = buildRuntimeEnv(
        { command: 'codex', secrets: ['CLI_RUNNER_TEST_OPENAI'] },
        secrets,
        '/proj',
      );
      expect(env.CLI_RUNNER_TEST_TAVILY).toBeUndefined();
      expect(env.CLI_RUNNER_TEST_OPENAI).toBe('openai-secret');
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      delete process.env.CLI_RUNNER_TEST_TAVILY;
      delete process.env.CLI_RUNNER_TEST_OPENAI;
    }
  });

  it('omits declared secrets that are unset and applies spec.env with {cwd}', () => {
    const env = buildRuntimeEnv(
      { command: 'x', secrets: ['NOT_SET'], env: { WORKDIR_HINT: '{cwd}/src' } },
      secretSource({}),
      '/proj',
    );
    expect('NOT_SET' in env).toBe(false);
    expect(env.WORKDIR_HINT).toBe('/proj/src');
  });
});

// ── Credential files ──────────────────────────────────────────────────

describe('materializeCredentialFiles', () => {
  it('writes the secret to the path with 0600 and creates parents', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-runner-'));
    const target = join(dir, 'nested', 'auth.json');
    await materializeCredentialFiles(
      { command: 'codex', files: [{ path: target, secret: 'CODEX_AUTH_JSON' }] },
      secretSource({ CODEX_AUTH_JSON: '{"tokens":{}}' }),
      '/proj',
    );
    expect(readFileSync(target, 'utf8')).toBe('{"tokens":{}}');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('never overwrites an existing file (in-container login wins)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-runner-'));
    const target = join(dir, 'auth.json');
    writeFileSync(target, 'from-login');
    await materializeCredentialFiles(
      { command: 'codex', files: [{ path: target, secret: 'CODEX_AUTH_JSON' }] },
      secretSource({ CODEX_AUTH_JSON: 'from-secret' }),
      '/proj',
    );
    expect(readFileSync(target, 'utf8')).toBe('from-login');
  });

  it('skips when the secret is unset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-runner-'));
    const target = join(dir, 'auth.json');
    await materializeCredentialFiles(
      { command: 'codex', files: [{ path: target, secret: 'MISSING' }] },
      secretSource({}),
      '/proj',
    );
    expect(existsSync(target)).toBe(false);
  });

  it('substitutes {cwd} in the file path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-runner-'));
    await materializeCredentialFiles(
      { command: 'x', files: [{ path: '{cwd}/token.txt', secret: 'T' }] },
      secretSource({ T: 'tok' }),
      dir,
    );
    expect(readFileSync(join(dir, 'token.txt'), 'utf8')).toBe('tok');
  });
});

// ── runCliAgent: text parser ──────────────────────────────────────────

describe('runCliAgent (text parser)', () => {
  it('returns trimmed stdout as content and streams lines', async () => {
    const { spawnFn, calls } = makeSpawnFn({ chunks: ['hello\nwor', 'ld\n'] });
    const progress: CliProgress[] = [];
    const result = await runCliAgent('do it', {
      spec: { command: 'opencode', args: ['run', '{prompt}'] },
      cwd: '/proj',
      spawnFn,
      onProgress: (u) => progress.push(u),
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe('hello\nworld');
    expect(progress.map((p) => p.content)).toEqual(['hello', 'world']);
    expect(calls[0].cmd).toBe('opencode');
    expect(calls[0].args).toEqual(['run', 'do it']);
    expect(calls[0].options.cwd).toBe('/proj');
  });

  it('reports non-zero exit with stderr tail', async () => {
    const { spawnFn } = makeSpawnFn({ chunks: [], exitCode: 2, stderr: 'boom' });
    const result = await runCliAgent('x', {
      spec: { command: 'tool' },
      cwd: '/proj',
      spawnFn,
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('exited with code 2');
    expect(result.errors[0]).toContain('boom');
  });

  it('gives a mise hint on ENOENT', async () => {
    const err = Object.assign(new Error('spawn tool ENOENT'), { code: 'ENOENT' });
    const { spawnFn } = makeSpawnFn({ chunks: [], error: err });
    const result = await runCliAgent('x', {
      spec: { command: 'tool' },
      cwd: '/proj',
      spawnFn,
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('mise.toml');
  });
});

// ── runCliAgent: codex-json parser ────────────────────────────────────

const codexLines = [
  JSON.stringify({ type: 'thread.started', thread_id: 'thread-abc' }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({
    type: 'item.started',
    item: { type: 'command_execution', command: 'npm test' },
  }),
  JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', command: 'npm test', aggregated_output: 'ok', exit_code: 0 },
  }),
  JSON.stringify({
    type: 'item.completed',
    item: { type: 'reasoning', text: 'thinking about it' },
  }),
  JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'All tests pass.' },
  }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10 } }),
].join('\n');

describe('runCliAgent (codex-json parser)', () => {
  it('extracts final text, session id, and tool events', async () => {
    const { spawnFn } = makeSpawnFn({ chunks: [codexLines + '\n'] });
    const progress: CliProgress[] = [];
    const result = await runCliAgent('run tests', {
      spec: resolveRuntimeSpec('codex', true)!,
      cwd: '/proj',
      env: { CODEX_HOME: '/nonexistent-codex-home' },
      spawnFn,
      onProgress: (u) => progress.push(u),
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe('All tests pass.');
    expect(result.sessionId).toBe('thread-abc');
    // Session file doesn't exist in the stubbed env — path stays undefined.
    expect(result.sessionPath).toBeUndefined();
    const kinds = progress.map((p) => p.type);
    expect(kinds).toContain('tool_use');
    expect(kinds).toContain('tool_result');
    expect(kinds).toContain('reasoning');
    expect(progress.find((p) => p.type === 'text')?.content).toBe('All tests pass.');
  });

  it('treats turn.failed as an error even on exit 0', async () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.failed', error: { message: 'rate limited' } }),
    ].join('\n');
    const { spawnFn } = makeSpawnFn({ chunks: [lines + '\n'], exitCode: 0 });
    const result = await runCliAgent('x', {
      spec: resolveRuntimeSpec('codex', true)!,
      cwd: '/proj',
      env: { CODEX_HOME: '/nonexistent-codex-home' },
      spawnFn,
    });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('rate limited');
  });

  it('finds the codex session rollout under CODEX_HOME', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    const day = join(home, 'sessions', '2026', '07', '15');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(day, { recursive: true });
    const rollout = join(day, 'rollout-2026-07-15T10-00-00-thread-abc.jsonl');
    writeFileSync(rollout, '');
    const { spawnFn } = makeSpawnFn({ chunks: [codexLines + '\n'] });
    const result = await runCliAgent('run tests', {
      spec: resolveRuntimeSpec('codex', true)!,
      cwd: '/proj',
      env: { CODEX_HOME: home },
      spawnFn,
    });
    expect(result.sessionPath).toBe(rollout);
  });
});

// ── RuntimeRunner adapter + config wiring ─────────────────────────────

describe('createCliRuntimeRunner', () => {
  it('passes a scoped env, forwards events, returns nativeSessionRef', async () => {
    process.env.CLI_RUNNER_ADAPTER_LEAK = 'leak';
    try {
      const secrets = secretSource({
        CLI_RUNNER_ADAPTER_LEAK: 'leak',
        OPENAI_API_KEY: 'sk-test',
      });
      let seen: { env?: Record<string, string | undefined> } = {};
      const runFn = async (_prompt: string, opts: any): Promise<CliRunResult> => {
        seen = { env: opts.env };
        return {
          content: 'done',
          success: true,
          errors: [],
          sessionId: 'thread-1',
          sessionPath: '/data/codex/sessions/2026/07/15/rollout-thread-1.jsonl',
        };
      };
      const runner = createCliRuntimeRunner(
        'codex',
        resolveRuntimeSpec('codex', true)!,
        secrets,
        runFn as any,
      );
      const texts: string[] = [];
      const result = await runner.run('go', ctx, { onText: (t) => texts.push(t) });
      expect(result.content).toBe('done');
      expect(result.nativeSessionRef).toEqual({
        runtime: 'codex',
        nativeSessionId: 'thread-1',
        nativeSessionPath: '/data/codex/sessions/2026/07/15/rollout-thread-1.jsonl',
      });
      expect(seen.env?.OPENAI_API_KEY).toBe('sk-test');
      expect(seen.env?.CLI_RUNNER_ADAPTER_LEAK).toBeUndefined();
    } finally {
      delete process.env.CLI_RUNNER_ADAPTER_LEAK;
    }
  });
});

describe('buildConfiguredRuntimeRunners', () => {
  it('registers valid runtimes and skips invalid or reserved ones', () => {
    const habitat = {
      getConfig: () => ({
        runtimes: {
          codex: true as const,
          opencode: { command: 'opencode', args: ['run', '{prompt}'] },
          mystery: true as const, // no preset, no command → skipped
          default: { command: 'nope' }, // reserved → skipped
        },
      }),
      getSecret: () => undefined,
      listSecretNames: () => [],
    };
    const runners = buildConfiguredRuntimeRunners(habitat);
    expect(Object.keys(runners).sort()).toEqual(['codex', 'opencode']);
  });

  it('returns empty when no runtimes are declared', () => {
    const habitat = {
      getConfig: () => ({}),
      getSecret: () => undefined,
      listSecretNames: () => [],
    };
    expect(buildConfiguredRuntimeRunners(habitat)).toEqual({});
  });
});

describe('RUNTIME_PRESETS', () => {
  it('codex preset declares its auth file seed', () => {
    expect(RUNTIME_PRESETS.codex.files?.[0].secret).toBe('CODEX_AUTH_JSON');
    expect(RUNTIME_PRESETS.codex.files?.[0].path.endsWith('auth.json')).toBe(true);
  });
});
