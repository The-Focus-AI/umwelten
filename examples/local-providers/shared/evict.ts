/**
 * Eviction helpers for local LLM runtimes.
 *
 * Ensures only one model is resident in memory at a time when benchmarking
 * across Ollama / LlamaBarn / llama-swap serially. On macOS, physical
 * footprint is measured via `vmmap --summary` (ps RSS understates once the
 * OS pages mmap'd weights out).
 */

import { execSync } from 'node:child_process';

// ── Hosts ────────────────────────────────────────────────────────────────────

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const LLAMASWAP_HOST = process.env.LLAMASWAP_HOST || 'http://localhost:8090/v1';

// ── Memory sampling ──────────────────────────────────────────────────────────

function physicalFootprintBytes(pid: number): number {
  if (process.platform !== 'darwin') return 0;
  try {
    const out = execSync(`vmmap --summary ${pid}`, { encoding: 'utf8', timeout: 2000 });
    const m = out.match(/Physical footprint:\s+([\d.]+)([KMGT])?/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = m[2] ?? '';
    const mult = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : unit === 'K' ? 1024 : 1;
    return Math.round(n * mult);
  } catch {
    return 0;
  }
}

/**
 * Sum RSS (in bytes) across every process currently hosting an LLM:
 *   - llama.cpp llama-server (LlamaBarn + llama-swap subprocesses)
 *   - Ollama's `ollama runner --ollama-engine ...` child
 */
export function sampleModelRssBytes(): number {
  const raw = execSync('ps -Ao pid,rss,command', { encoding: 'utf8' });
  let total = 0;
  for (const line of raw.split('\n').slice(1)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, pidStr, rssStr, command] = m;
    const exe = (command.split(/\s+/)[0] ?? '').toLowerCase();
    const rest = command.slice(exe.length).toLowerCase();
    const isLlamaServer = exe.endsWith('/llama-server') || exe.endsWith('ollama_llama_server');
    const isOllamaRunner = exe.endsWith('/ollama') && /\brunner\b/.test(rest);
    if (isLlamaServer || isOllamaRunner) {
      const pid = parseInt(pidStr, 10);
      const psRss = parseInt(rssStr, 10) * 1024;
      const foot = physicalFootprintBytes(pid);
      const rss = Math.max(psRss, foot);
      // Ignore idle-stub processes (llama-swap's parent managerial
      // llama-server holding no model, or LlamaBarn's coordinator
      // subprocess). These sit at <100 MB; a loaded model is always GB.
      if (rss < 100 * 1024 * 1024) continue;
      total += rss;
    }
  }
  return total;
}

// ── Per-runtime eviction ─────────────────────────────────────────────────────

async function evictOllamaByName(modelName: string): Promise<void> {
  try {
    await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelName, prompt: '', keep_alive: 0, stream: false }),
    });
  } catch { /* best effort */ }
}

/**
 * Evict all currently-loaded Ollama models by iterating `/api/ps` and
 * sending keep_alive=0 to each.
 */
async function evictOllamaAll(): Promise<void> {
  try {
    const resp = await fetch(`${OLLAMA_HOST}/api/ps`);
    if (!resp.ok) return;
    const data: any = await resp.json();
    const loaded: string[] = (data.models ?? []).map((m: any) => m.name ?? m.model).filter(Boolean);
    await Promise.all(loaded.map(evictOllamaByName));
  } catch { /* best effort */ }
}

async function evictLlamaSwap(): Promise<void> {
  const base = LLAMASWAP_HOST.replace(/\/v1\/?$/, '');
  // `/unload` has been observed to return OK before the subprocess actually
  // exits. Poll up to 5s for the child llama-server to disappear so downstream
  // logic sees a clean state.
  try {
    await fetch(`${base}/unload`);
  } catch { return; }
  for (let i = 0; i < 10; i++) {
    const stillUp = childLlamaServerRunning();
    if (!stillUp) return;
    await new Promise(r => setTimeout(r, 500));
  }
}

/** Returns true if any standalone /opt/homebrew-style llama-server (the ones
 *  llama-swap spawns as children) is currently running. Used to gate eviction
 *  completion since /unload returns before SIGCHLD. */
function childLlamaServerRunning(): boolean {
  try {
    const out = execSync('pgrep -f "llama-server -m " 2>/dev/null || true', { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * LlamaBarn has no unload API. Kill its model-hosting llama-server
 * subprocess directly with SIGKILL — SIGTERM is ignored (the process
 * stays alive, keeping weights resident). SIGKILL is safe because
 * LlamaBarn's coordinator respawns cleanly on the next request.
 */
function evictLlamaBarn(): void {
  try {
    execSync(
      `pkill -9 -f "LlamaBarn.app/Contents/MacOS/llama-cpp/llama-server --host 127.0.0.1"`,
      { stdio: 'ignore' },
    );
  } catch { /* nothing to kill */ }
}

/**
 * Evict every runtime we can reach. Best-effort and non-throwing —
 * callers should follow up with `waitForMemoryBelow` to confirm release.
 */
export async function evictAll(): Promise<void> {
  evictLlamaBarn();
  await Promise.all([evictLlamaSwap(), evictOllamaAll()]);
}

// ── Wait for release ─────────────────────────────────────────────────────────

export function fmtBytes(b: number): string {
  const mb = b / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

/**
 * Poll until total model-hosting RSS drops at or below `targetBytes`,
 * or give up after `maxMs`. Returns { ok, elapsedMs, finalBytes }.
 */
export async function waitForMemoryBelow(
  targetBytes: number,
  maxMs: number = 60_000,
): Promise<{ ok: boolean; elapsedMs: number; finalBytes: number }> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const now = sampleModelRssBytes();
    if (now <= targetBytes) {
      return { ok: true, elapsedMs: Date.now() - start, finalBytes: now };
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return { ok: false, elapsedMs: Date.now() - start, finalBytes: sampleModelRssBytes() };
}
