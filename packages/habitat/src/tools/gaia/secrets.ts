/**
 * Gaia Master Secret Vault + per-container secret filtering.
 *
 * Master vault lives at `<dataDir>/secrets.json` (mode 0600).
 * Per-container filtered secrets are written to `<dataDir>/habitats/<id>/secrets.json`.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { GaiaHabitatEntry } from "./types.js";

const SECRETS_FILE = "secrets.json";

export class GaiaSecretVault {
  private secrets: Record<string, string> = {};
  private loaded = false;

  constructor(private readonly dataDir: string) {}

  private get vaultPath(): string {
    return join(this.dataDir, SECRETS_FILE);
  }

  /** Load master vault from disk. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.vaultPath, "utf-8");
      this.secrets = JSON.parse(raw);
    } catch {
      this.secrets = {};
    }
    this.loaded = true;
  }

  /** Save master vault to disk (mode 0600). */
  async save(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(
      this.vaultPath,
      JSON.stringify(this.secrets, null, 2) + "\n",
      { mode: 0o600 },
    );
  }

  private ensureLoaded(): void {
    if (!this.loaded) throw new Error("Vault not loaded — call load() first");
  }

  /** List secret names (not values). */
  listNames(): string[] {
    this.ensureLoaded();
    return Object.keys(this.secrets);
  }

  /** Get a secret value. */
  get(name: string): string | undefined {
    this.ensureLoaded();
    return this.secrets[name];
  }

  /** Set a secret value. */
  async set(name: string, value: string): Promise<void> {
    this.ensureLoaded();
    this.secrets[name] = value;
    await this.save();
  }

  /** Remove a secret. */
  async remove(name: string): Promise<boolean> {
    this.ensureLoaded();
    if (!(name in this.secrets)) return false;
    delete this.secrets[name];
    await this.save();
    return true;
  }

}

/*
 * `writeFilteredSecrets` used to live here: it filtered the vault by a
 * habitat's bindings and wrote the result to that habitat's data dir. It had
 * no callers — every seeding path goes through `buildSeedFiles`, which does
 * the same filtering and hands the files to `docker.seedVolume`.
 *
 * Removed rather than left in place because it was a trap. It silently
 * dropped a bound name the vault had no value for, which is the bug that
 * cost three rebuilds on the first client habitat, and anyone finding it
 * would reasonably assume it was the live path and fix it here instead of in
 * `buildSeedFiles`. Two implementations of one rule, one of them dead, is
 * worse than one.
 *
 * See `secret-status.ts` for how a binding the vault cannot satisfy is
 * surfaced now.
 */
