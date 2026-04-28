/**
 * Timeout diagnostics — when a watchdog fires, probe the local runtime
 * for in-flight generation state so we can tell *why* it timed out
 * (e.g. stuck in a thinking loop generating 19K hidden tokens).
 *
 * Currently probes llama-server's `/slots` endpoint (exposed by both
 * llama-swap child servers and standalone llama-server processes).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const LLAMASWAP_HOST = process.env.LLAMASWAP_HOST || 'http://localhost:8090/v1';

interface SlotInfo {
  id: number;
  is_processing: boolean;
  n_ctx: number;
  n_predict?: number;
  id_task?: number;
  next_token?: Array<{
    has_next_token: boolean;
    n_remain: number;
    n_decoded: number;
  }>;
  prompt?: string;
  params?: Record<string, unknown>;
}

export interface TimeoutDiagnostic {
  timestamp: string;
  model: string;
  provider: string;
  elapsedMs: number;
  /** Active llama-server slots at time of timeout. */
  activeSlots: SlotInfo[];
  /** Total tokens decoded across all active slots. */
  totalTokensDecoded: number;
  /** llama-swap /running state. */
  running: unknown;
  /** Human-readable summary. */
  summary: string;
}

/**
 * Query llama-swap's running models to find the backend port,
 * then hit that backend's /slots to get in-flight generation state.
 */
async function probeSlots(): Promise<{ slots: SlotInfo[]; running: unknown }> {
  const base = LLAMASWAP_HOST.replace(/\/v1\/?$/, '');

  // Get running models + their proxy ports
  let running: any = null;
  let backendPorts: number[] = [];
  try {
    const resp = await fetch(`${base}/running`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      running = await resp.json();
      const entries = Array.isArray(running) ? running : running?.running ?? [];
      for (const entry of entries) {
        const proxy = entry?.proxy ?? '';
        const portMatch = proxy.match(/:(\d+)/);
        if (portMatch) backendPorts.push(parseInt(portMatch[1], 10));
      }
    }
  } catch { /* swallow */ }

  // Also try Ollama
  try {
    const resp = await fetch('http://localhost:11434/api/ps', {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const data: any = await resp.json();
      if (!running) running = { ollama: data };
    }
  } catch { /* swallow */ }

  // Probe each backend's /slots
  const allSlots: SlotInfo[] = [];
  for (const port of backendPorts) {
    try {
      const resp = await fetch(`http://localhost:${port}/slots`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const slots: SlotInfo[] = await resp.json() as SlotInfo[];
        allSlots.push(...slots.filter(s => s.is_processing));
      }
    } catch { /* swallow */ }
  }

  return { slots: allSlots, running };
}

/**
 * Collect diagnostic info when a watchdog timeout fires.
 * Non-throwing — always returns a diagnostic, even if probes fail.
 */
export async function collectTimeoutDiagnostic(
  model: string,
  provider: string,
  elapsedMs: number,
): Promise<TimeoutDiagnostic> {
  const { slots, running } = await probeSlots();

  const totalTokensDecoded = slots.reduce((sum, s) => {
    const tokens = s.next_token?.[0]?.n_decoded ?? 0;
    return sum + tokens;
  }, 0);

  const slotSummaries = slots.map(s => {
    const decoded = s.next_token?.[0]?.n_decoded ?? '?';
    const remain = s.next_token?.[0]?.n_remain ?? '?';
    return `slot ${s.id}: ${decoded} tokens decoded, n_remain=${remain}, n_predict=${s.n_predict ?? s.params?.n_predict ?? '?'}`;
  });

  const summary = slots.length === 0
    ? `Timeout after ${(elapsedMs / 1000).toFixed(1)}s — no active slots found (request may have already been aborted).`
    : [
        `Timeout after ${(elapsedMs / 1000).toFixed(1)}s with ${slots.length} active slot(s):`,
        ...slotSummaries,
        '',
        totalTokensDecoded > 1000
          ? `⚠ ${totalTokensDecoded.toLocaleString()} tokens decoded — almost certainly stuck in a thinking/reasoning loop.`
          : `${totalTokensDecoded} tokens decoded.`,
        totalTokensDecoded > 5000
          ? `💡 Consider using the -nothink provider variant to disable hidden reasoning tokens.`
          : '',
      ].filter(Boolean).join('\n  ');

  return {
    timestamp: new Date().toISOString(),
    model,
    provider,
    elapsedMs,
    activeSlots: slots,
    totalTokensDecoded,
    running,
    summary,
  };
}

/**
 * Write diagnostic to disk for post-mortem analysis.
 */
export function saveDiagnostic(
  diag: TimeoutDiagnostic,
  outputDir = 'output/evaluations',
): string {
  const dir = path.join(outputDir, 'timeout-diagnostics');
  fs.mkdirSync(dir, { recursive: true });

  const ts = diag.timestamp.replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${ts}_${diag.provider}_${diag.model.replace(/[/:]/g, '-')}.json`;
  const filepath = path.join(dir, filename);

  fs.writeFileSync(filepath, JSON.stringify(diag, null, 2));
  return filepath;
}
