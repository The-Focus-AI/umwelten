/**
 * System-state probes used by the local-providers harness.
 *
 * Pure read-only functions — no side effects, no eviction, no killing
 * processes. They exist so `preflight.ts` and `runner.ts` can decide
 * whether it's safe to start a new cell, and so the runner can
 * skip eviction when the right model is already loaded.
 *
 * macOS-only specifics: `pmset -g batt` for battery, `vmmap` for true
 * physical-footprint memory accounting (ps RSS understates once mmap'd
 * weights are paged out, leading to false "memory is free" readings).
 */

import { execSync } from 'node:child_process';

// ── Hosts ────────────────────────────────────────────────────────────────────

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const LLAMASWAP_HOST = process.env.LLAMASWAP_HOST || 'http://localhost:8090/v1';

// ── Battery ─────────────────────────────────────────────────────────────────

export interface BatteryState {
  /** Power source: AC adapter or internal battery. */
  source: 'AC' | 'Battery' | 'unknown';
  /** Charge level as a fraction 0–1, or null if unavailable. */
  level: number | null;
  /** Wall power draw if charging on AC, in watts (when reported). */
  chargingW?: number;
}

/**
 * Parse `pmset -g batt`. On macOS without a battery (Mac mini etc.) the
 * source comes back 'AC' with level=null, which is what callers want.
 *
 * Sample outputs:
 *   Now drawing from 'AC Power'
 *    -InternalBattery-0 (id=...)\t100%; charged; 0:00 remaining present: true
 *
 *   Now drawing from 'Battery Power'
 *    -InternalBattery-0 (id=...)\t73%; discharging; 4:12 remaining present: true
 */
export function getBatteryState(): BatteryState {
  if (process.platform !== 'darwin') {
    return { source: 'unknown', level: null };
  }
  try {
    const out = execSync('pmset -g batt', { encoding: 'utf8', timeout: 2000 });
    const source: BatteryState['source'] = /AC Power/i.test(out)
      ? 'AC'
      : /Battery Power/i.test(out)
        ? 'Battery'
        : 'unknown';
    const pctMatch = out.match(/(\d+)%/);
    const level = pctMatch ? Math.max(0, Math.min(1, parseInt(pctMatch[1], 10) / 100)) : null;
    return { source, level };
  } catch {
    return { source: 'unknown', level: null };
  }
}

// ── Memory ──────────────────────────────────────────────────────────────────

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
 * Sum RSS in bytes across every process currently hosting an LLM:
 *   - llama.cpp llama-server (LlamaBarn + llama-swap subprocesses)
 *   - Ollama's `ollama runner --ollama-engine ...` child
 *
 * On macOS we max(ps RSS, physical footprint) because ps understates
 * once weights are paged out — that's the bug that let the previous
 * harness think memory was free while a 25 GB model was still pinned.
 */
export function getModelMemoryBytes(): number {
  let raw: string;
  try {
    raw = execSync('ps -Ao pid,rss,command', { encoding: 'utf8' });
  } catch {
    return 0;
  }
  let total = 0;
  for (const line of raw.split('\n').slice(1)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const [, pidStr, rssStr, command] = m;
    const exe = (command.split(/\s+/)[0] ?? '').toLowerCase();
    const rest = command.slice(exe.length).toLowerCase();
    const isLlamaServer = exe.endsWith('/llama-server') || exe.endsWith('ollama_llama_server');
    const isOllamaRunner = exe.endsWith('/ollama') && /\brunner\b/.test(rest);
    if (!isLlamaServer && !isOllamaRunner) continue;
    const pid = parseInt(pidStr, 10);
    const psRss = parseInt(rssStr, 10) * 1024;
    const foot = physicalFootprintBytes(pid);
    const rss = Math.max(psRss, foot);
    // <100 MB processes are idle stubs (llama-swap parent, LlamaBarn
    // coordinator with no model loaded). A loaded model is always GB.
    if (rss < 100 * 1024 * 1024) continue;
    total += rss;
  }
  return total;
}

export function fmtBytes(b: number): string {
  const mb = b / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

// ── Loaded models ───────────────────────────────────────────────────────────

export interface LoadedModel {
  /** Runtime-specific model name, as the runtime reports it. */
  name: string;
  /** Which runtime currently has it loaded. */
  runtime: 'ollama' | 'llamaswap' | 'unknown';
  /** Optional resident size in bytes, when the runtime reports it. */
  bytes?: number;
}

async function getOllamaLoaded(): Promise<LoadedModel[]> {
  try {
    const resp = await fetch(`${OLLAMA_HOST}/api/ps`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const out: LoadedModel[] = [];
    for (const m of data.models ?? []) {
      const name = m.name ?? m.model;
      if (!name) continue;
      out.push({
        name,
        runtime: 'ollama',
        bytes: typeof m.size === 'number' ? m.size : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function getLlamaSwapLoaded(): Promise<LoadedModel[]> {
  // llama-swap exposes /v1/models — but that's the *catalog* (every
  // model it knows how to spawn), not what's actually loaded right now.
  // Loaded-state lives in /running. If /running isn't supported on this
  // version, fall back to "infer from running llama-server processes".
  const base = LLAMASWAP_HOST.replace(/\/v1\/?$/, '');
  try {
    const resp = await fetch(`${base}/running`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const data: any = await resp.json();
      const arr = Array.isArray(data) ? data : data?.running ?? [];
      return arr
        .map((entry: any): LoadedModel | null => {
          const name = entry?.model ?? entry?.name ?? entry;
          if (typeof name !== 'string') return null;
          return { name, runtime: 'llamaswap' };
        })
        .filter((m: LoadedModel | null): m is LoadedModel => m !== null);
    }
  } catch {
    /* fall through to process-table inference */
  }

  // Fallback: list child llama-server processes. We can't recover the
  // model name reliably, but a non-empty result still tells the harness
  // "something is loaded", which is enough to gate eviction decisions.
  try {
    const out = execSync('pgrep -af "llama-server -m " 2>/dev/null || true', {
      encoding: 'utf8',
    });
    if (!out.trim()) return [];
    return out
      .trim()
      .split('\n')
      .map((line) => {
        const m = line.match(/-m\s+(\S+)/);
        const path = m ? m[1] : 'unknown';
        const name = path.split('/').pop() ?? path;
        return { name, runtime: 'llamaswap' as const };
      });
  } catch {
    return [];
  }
}

/**
 * List every model currently held in memory, across every runtime we
 * can probe. Used to decide whether eviction is needed before starting
 * the next cell, and whether the model we're about to test is already
 * loaded (skip eviction if so).
 */
export async function getLoadedModels(): Promise<LoadedModel[]> {
  const [ollama, llamaswap] = await Promise.all([
    getOllamaLoaded(),
    getLlamaSwapLoaded(),
  ]);
  return [...ollama, ...llamaswap];
}

// ── Composite snapshot ──────────────────────────────────────────────────────

export interface SystemStateSnapshot {
  battery: BatteryState;
  modelMemoryBytes: number;
  loaded: LoadedModel[];
  /** Wall-clock time the snapshot was taken. */
  takenAt: Date;
}

/** One-call summary suitable for logging at the top of each cell. */
export async function getSystemState(): Promise<SystemStateSnapshot> {
  const [loaded] = await Promise.all([getLoadedModels()]);
  return {
    battery: getBatteryState(),
    modelMemoryBytes: getModelMemoryBytes(),
    loaded,
    takenAt: new Date(),
  };
}
