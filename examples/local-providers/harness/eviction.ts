/**
 * Eviction policy for the local-providers harness.
 *
 * Builds on `system-state.ts` for read-only probing, and adds the
 * "kill what's resident" side of the story:
 *   - call each runtime's unload API
 *   - SIGKILL stragglers (llama-swap children, LlamaBarn subprocess)
 *   - poll until physical-footprint memory actually drops
 *   - skip eviction if the right model is already loaded
 */

import { execSync } from 'node:child_process';
import {
  fmtBytes,
  getLoadedModels,
  getModelMemoryBytes,
  type LoadedModel,
} from './system-state.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const LLAMASWAP_HOST = process.env.LLAMASWAP_HOST || 'http://localhost:8090/v1';

// ── Per-runtime eviction ────────────────────────────────────────────────────

async function evictOllamaByName(modelName: string): Promise<void> {
  try {
    await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelName, prompt: '', keep_alive: 0, stream: false }),
    });
  } catch {
    /* best effort */
  }
}

async function evictOllamaAll(): Promise<void> {
  try {
    const resp = await fetch(`${OLLAMA_HOST}/api/ps`);
    if (!resp.ok) return;
    const data: any = await resp.json();
    const loaded: string[] = (data.models ?? [])
      .map((m: any) => m.name ?? m.model)
      .filter(Boolean);
    await Promise.all(loaded.map(evictOllamaByName));
  } catch {
    /* best effort */
  }
}

function childLlamaServerRunning(): boolean {
  try {
    const out = execSync('pgrep -f "llama-server -m " 2>/dev/null || true', {
      encoding: 'utf8',
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function killChildLlamaServers(): void {
  try {
    execSync('pkill -9 -f "llama-server -m " 2>/dev/null || true', {
      stdio: 'ignore',
    });
  } catch {
    /* nothing to kill */
  }
}

async function evictLlamaSwap(): Promise<void> {
  const base = LLAMASWAP_HOST.replace(/\/v1\/?$/, '');
  try {
    await fetch(`${base}/unload`);
  } catch {
    /* fall through to kill */
  }

  // Phase 1: graceful — wait up to 5s for /unload to take effect.
  for (let i = 0; i < 10; i++) {
    if (!childLlamaServerRunning()) return;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Phase 2: SIGKILL. llama-swap respawns cleanly on the next request,
  // so this is safe. Without it, an in-flight request keeps the child
  // alive holding 20+ GB until generation completes — which can be
  // hours when the watchdog has already given up.
  killChildLlamaServers();

  for (let i = 0; i < 6; i++) {
    if (!childLlamaServerRunning()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

function evictLlamaBarn(): void {
  try {
    execSync(
      `pkill -9 -f "LlamaBarn.app/Contents/MacOS/llama-cpp/llama-server --host 127.0.0.1"`,
      { stdio: 'ignore' },
    );
  } catch {
    /* nothing to kill */
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Best-effort eviction of every runtime we can reach. Non-throwing —
 * callers should follow with `waitForMemoryBelow` to confirm release.
 */
export async function evictAll(): Promise<void> {
  evictLlamaBarn();
  await Promise.all([evictLlamaSwap(), evictOllamaAll()]);
}

/**
 * Poll until total model-hosting RSS drops at or below `targetBytes`,
 * or give up after `maxMs`.
 */
export async function waitForMemoryBelow(
  targetBytes: number,
  maxMs: number = 60_000,
): Promise<{ ok: boolean; elapsedMs: number; finalBytes: number }> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const now = getModelMemoryBytes();
    if (now <= targetBytes) {
      return { ok: true, elapsedMs: Date.now() - start, finalBytes: now };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, elapsedMs: Date.now() - start, finalBytes: getModelMemoryBytes() };
}

/**
 * Decide whether eviction can be skipped because the only thing
 * currently loaded is `model` on `provider`. We compare on the runtime
 * name (Ollama and llama-swap report different formats, so callers pass
 * the raw model name as the runtime sees it) and require that nothing
 * else is loaded.
 *
 * Returns null if eviction is needed, or the matching loaded entry if
 * we can skip.
 */
export function skipIfAlreadyLoaded(
  loaded: LoadedModel[],
  modelName: string,
  runtime: 'ollama' | 'llamaswap',
): LoadedModel | null {
  if (loaded.length !== 1) return null;
  const [only] = loaded;
  if (only.runtime !== runtime) return null;
  // Tolerate trailing tag differences (`gemma:latest` vs `gemma`).
  const a = only.name.replace(/:latest$/, '');
  const b = modelName.replace(/:latest$/, '');
  if (a !== b) return null;
  return only;
}

/**
 * Convenience: evict everything, wait for release, return the elapsed
 * time and final memory reading. Safe to call repeatedly.
 */
export async function evictAndWait(opts: {
  /** Bytes of LLM memory we tolerate after eviction. Default 500 MB. */
  targetBytes?: number;
  /** Max wait time. Default 60s. */
  maxMs?: number;
}): Promise<{ ok: boolean; elapsedMs: number; finalBytes: number }> {
  const { targetBytes = 500 * 1024 * 1024, maxMs = 60_000 } = opts;
  await evictAll();
  return waitForMemoryBelow(targetBytes, maxMs);
}

export { fmtBytes, getLoadedModels, getModelMemoryBytes };
