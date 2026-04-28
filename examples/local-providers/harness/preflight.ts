/**
 * Preflight checks. The harness calls these before starting a long
 * matrix run (and optionally between cells) to decide whether the
 * machine is in a good state to keep running.
 *
 * Failure modes we want to catch BEFORE we spend 30 minutes evaluating:
 *   - laptop unplugged + battery <50% → it'll die mid-run
 *   - rogue model still resident from a previous run → memory contention
 *   - disk too full to cache another set of responses
 */

import { statfsSync } from 'node:fs';
import {
  getBatteryState,
  getLoadedModels,
  getModelMemoryBytes,
  fmtBytes,
} from './system-state.js';

export interface PreflightOptions {
  /**
   * Minimum battery level (0–1) when on battery power. Default 0.5.
   * Only enforced when not on AC.
   */
  minBatteryLevel?: number;
  /** Require AC power. Default false on macs without batteries; true otherwise. */
  requireAC?: boolean;
  /**
   * Maximum bytes of LLM memory already resident before we start.
   * Set to 0 to require a clean slate. Default: no limit (warn only).
   */
  maxResidentBytes?: number;
  /**
   * Minimum free disk space in bytes. Default 5 GB.
   * Checked against the working directory's filesystem.
   */
  minFreeDiskBytes?: number;
  /** Path to check for free disk space. Defaults to cwd. */
  diskPath?: string;
}

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

function getFreeDiskBytes(path: string): number | null {
  try {
    const stat = statfsSync(path);
    // bavail = blocks available to non-superuser
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

/**
 * Throws `PreflightError` if any condition fails. Otherwise returns a
 * snapshot of the checks for logging.
 */
export async function assertCanRun(opts: PreflightOptions = {}): Promise<{
  battery: ReturnType<typeof getBatteryState>;
  loadedCount: number;
  modelMemoryBytes: number;
  freeDiskBytes: number | null;
}> {
  const {
    minBatteryLevel = 0.5,
    requireAC = false,
    maxResidentBytes,
    minFreeDiskBytes = 5 * 1024 ** 3,
    diskPath = process.cwd(),
  } = opts;

  const battery = getBatteryState();
  if (requireAC && battery.source !== 'AC') {
    throw new PreflightError(
      `requireAC=true but power source is '${battery.source}'`,
    );
  }
  if (battery.source === 'Battery' && battery.level !== null) {
    if (battery.level < minBatteryLevel) {
      throw new PreflightError(
        `battery at ${(battery.level * 100).toFixed(0)}% on battery power; ` +
          `minBatteryLevel=${(minBatteryLevel * 100).toFixed(0)}%`,
      );
    }
  }

  const modelMemoryBytes = getModelMemoryBytes();
  if (typeof maxResidentBytes === 'number' && modelMemoryBytes > maxResidentBytes) {
    throw new PreflightError(
      `${fmtBytes(modelMemoryBytes)} of LLM memory already resident; ` +
        `maxResidentBytes=${fmtBytes(maxResidentBytes)}`,
    );
  }

  const freeDiskBytes = getFreeDiskBytes(diskPath);
  if (freeDiskBytes !== null && freeDiskBytes < minFreeDiskBytes) {
    throw new PreflightError(
      `only ${fmtBytes(freeDiskBytes)} free on ${diskPath}; ` +
        `minFreeDiskBytes=${fmtBytes(minFreeDiskBytes)}`,
    );
  }

  const loaded = await getLoadedModels();

  return {
    battery,
    loadedCount: loaded.length,
    modelMemoryBytes,
    freeDiskBytes,
  };
}

/** Format a preflight snapshot for one-line console logging. */
export function formatPreflight(s: Awaited<ReturnType<typeof assertCanRun>>): string {
  const parts: string[] = [];
  parts.push(
    `battery=${s.battery.source}` +
      (s.battery.level !== null ? `@${(s.battery.level * 100).toFixed(0)}%` : ''),
  );
  parts.push(`loaded=${s.loadedCount}`);
  parts.push(`memory=${fmtBytes(s.modelMemoryBytes)}`);
  if (s.freeDiskBytes !== null) parts.push(`disk-free=${fmtBytes(s.freeDiskBytes)}`);
  return parts.join(' ');
}
