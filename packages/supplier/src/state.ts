/**
 * What survives a restart.
 *
 * A machine that reboots should rejoin the pool on its own. Needing an operator
 * is the difference between a power cut and an outage, and the operator is
 * usually asleep.
 *
 * Three files, in `~/.umwelten/supplier/`:
 *
 *   config.json   what to serve and where to publish it
 *   credential    the Supplier credential, mode 0600, its own file
 *   state.json    the last probe result and the fingerprint that produced it
 *
 * The credential is separate rather than a field in `config.json` because the
 * config is the file an operator will read out loud, paste into an issue, and
 * copy between machines. Keeping the secret out of it is the difference between
 * that being fine and that being an incident. Same reasoning as the habitat's
 * `secrets.json` (mode 0600, never in the config).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ManagedOptions, ProbedOffer, ServingMode } from "./types.js";

export const STATE_VERSION = 1;

export interface PersistedConfig {
  exchangeUrl: string;
  guarantees: string[];
  servingMode: ServingMode;
  providers?: string[];
  modelFilter?: string;
  managed?: ManagedOptions;
  /** Re-probe interval, when the operator overrode the default. */
  reprobeIntervalMs?: number;
}

export interface PersistedState {
  version: number;
  fingerprint: string;
  probedAt: string;
  probed: ProbedOffer[];
  /** The inputs that produced the fingerprint, so staleness can name the layer. */
  inputs?: Record<string, unknown>;
}

export function supplierDir(): string {
  return process.env.UMWELTEN_SUPPLIER_DIR ?? path.join(os.homedir(), ".umwelten", "supplier");
}

const configPath = () => path.join(supplierDir(), "config.json");
const credentialPath = () => path.join(supplierDir(), "credential");
const statePath = () => path.join(supplierDir(), "state.json");
const pidPath = () => path.join(supplierDir(), "runtime.pid");

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    // Missing, unreadable, or corrupt all mean the same thing to every caller:
    // there is nothing to resume from, so probe. A corrupt state file must not
    // stop an agent from starting.
    return undefined;
  }
}

function writeJson(file: string, value: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename, so a crash mid-write leaves the previous file intact
  // rather than a truncated one that the next start has to recover from.
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), mode ? { mode } : undefined);
  fs.renameSync(temp, file);
}

export function saveConfig(config: PersistedConfig): void {
  writeJson(configPath(), config);
}

export function loadConfig(): PersistedConfig | undefined {
  return readJson<PersistedConfig>(configPath());
}

export function saveCredential(credential: string): void {
  const file = credentialPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, credential, { mode: 0o600 });
  // Set it again explicitly: an existing file keeps its old mode through a
  // plain write, so a credential written before this rule existed would stay
  // world-readable forever.
  fs.chmodSync(file, 0o600);
}

/** The environment wins, so a container can inject one without a file. */
export function loadCredential(): string | undefined {
  if (process.env.SUPPLIER_CREDENTIAL) return process.env.SUPPLIER_CREDENTIAL;
  try {
    return fs.readFileSync(credentialPath(), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function saveState(state: PersistedState): void {
  writeJson(statePath(), state);
}

export function loadState(): PersistedState | undefined {
  const state = readJson<PersistedState>(statePath());
  // A state file from a future version is not something to guess at. Probing
  // again costs minutes; misreading a snapshot publishes a wrong claim.
  if (!state || state.version !== STATE_VERSION) return undefined;
  return state;
}

// ── Orphan recovery ──────────────────────────────────────────────────────────

/**
 * Remember the runtime we started, so an unclean shutdown is recoverable.
 *
 * The exit hooks in `runtime.ts` cover every shutdown we get to observe. A
 * power cut is not one of those, and what it leaves behind is a llama-server
 * holding the GPU that the next start cannot use and did not create.
 */
export function recordRuntimePid(pid: number | undefined): void {
  if (pid === undefined) return;
  fs.mkdirSync(supplierDir(), { recursive: true });
  fs.writeFileSync(pidPath(), String(pid));
}

export function clearRuntimePid(): void {
  try {
    fs.unlinkSync(pidPath());
  } catch {
    /* already gone, which is the desired state */
  }
}

export interface OrphanEffects {
  isAlive: (pid: number) => boolean;
  kill: (pid: number) => void;
}

export const nodeOrphanEffects: OrphanEffects = {
  isAlive(pid) {
    try {
      // Signal 0 tests for existence without delivering anything.
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  kill(pid) {
    try {
      // The group, so llama-swap's children go too — it was started detached
      // precisely so this works.
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* gone between the check and the signal */
      }
    }
  },
};

/**
 * Take down a runtime left behind by a previous run.
 *
 * Returns what it did, so a start after a power cut can say so rather than
 * silently failing to bind a port.
 */
export function reapOrphanedRuntime(effects: OrphanEffects = nodeOrphanEffects): string | undefined {
  let pid: number;
  try {
    pid = Number(fs.readFileSync(pidPath(), "utf8").trim());
  } catch {
    return undefined;
  }
  if (!Number.isFinite(pid) || pid <= 0) {
    clearRuntimePid();
    return undefined;
  }

  if (!effects.isAlive(pid)) {
    clearRuntimePid();
    return undefined;
  }

  effects.kill(pid);
  clearRuntimePid();
  return `stopped a runtime left behind by a previous run (pid ${pid})`;
}
