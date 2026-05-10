/**
 * AgentVault — single-method abstraction over per-agent credential stores.
 *
 * Backends:
 *  - InlineVault  : /data/agents/<id>/secrets.json (mode 0600), per-agent isolation
 *  - HabitatVault : /data/secrets.json (the container-level store), shared
 *  - OnePasswordVault: deferred (resolved via host-side `op` CLI)
 *
 * Resolution order in Habitat.resolveAgentSecret() is:
 *   1. The agent's vault (per identity.vault.backend)
 *   2. Habitat-level secrets (process.env + /data/secrets.json)
 *
 * Step (2) is the existing behavior; vaults add an opt-in per-agent layer
 * on top of it without changing the default.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileExists } from "../config.js";
import { loadSecrets } from "../secrets.js";

/** Single-method vault interface. */
export interface AgentVault {
  /** Return the secret value for `name`, or undefined if not in this vault. */
  resolve(name: string): Promise<string | undefined>;
  /** Store/overwrite a secret. Backend may reject (read-only vaults). */
  set?(name: string, value: string): Promise<void>;
  /** Remove a secret. Backend may reject. */
  remove?(name: string): Promise<void>;
  /** List secret names (not values). */
  list?(): Promise<string[]>;
}

const SECRETS_FILE = "secrets.json";

/**
 * Per-agent JSON file at /data/agents/<id>/secrets.json (mode 0600).
 * The simplest, fully-isolated backend; tests use this exclusively.
 */
export class InlineVault implements AgentVault {
  constructor(private readonly agentDir: string) {}

  private get path(): string {
    return join(this.agentDir, SECRETS_FILE);
  }

  private async load(): Promise<Record<string, string>> {
    if (!(await fileExists(this.path))) return {};
    try {
      const raw = await readFile(this.path, "utf-8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private async save(map: Record<string, string>): Promise<void> {
    await mkdir(this.agentDir, { recursive: true });
    await writeFile(this.path, JSON.stringify(map, null, 2) + "\n", { mode: 0o600 });
  }

  async resolve(name: string): Promise<string | undefined> {
    const map = await this.load();
    return map[name];
  }

  async set(name: string, value: string): Promise<void> {
    const map = await this.load();
    map[name] = value;
    await this.save(map);
  }

  async remove(name: string): Promise<void> {
    const map = await this.load();
    if (!(name in map)) return;
    delete map[name];
    await this.save(map);
  }

  async list(): Promise<string[]> {
    const map = await this.load();
    return Object.keys(map);
  }
}

/**
 * The container-level secrets file at /data/secrets.json. Shared across the
 * whole habitat — no per-agent isolation. This is the existing behavior, just
 * presented through the AgentVault interface.
 */
export class HabitatVault implements AgentVault {
  constructor(private readonly workDir: string) {}

  async resolve(name: string): Promise<string | undefined> {
    const map = await loadSecrets(this.workDir);
    return map[name] ?? process.env[name];
  }

  async list(): Promise<string[]> {
    const map = await loadSecrets(this.workDir);
    return Object.keys(map);
  }

  // set/remove deliberately omitted — habitat-level mutations go through
  // Habitat.setSecret() so the in-memory copy stays in sync.
}

/**
 * Stub for the future 1Password backend. Returns undefined for every lookup
 * so callers fall through to the habitat-level vault. Implementations will
 * shell out to `op read <ref>` against the host (out of scope here).
 */
export class OnePasswordVault implements AgentVault {
  constructor(private readonly _itemRef: string | undefined) {}

  async resolve(_name: string): Promise<string | undefined> {
    return undefined;
  }
}
