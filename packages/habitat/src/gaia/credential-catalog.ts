/**
 * Credential Catalog — stores metadata about every secret in Gaia's master vault.
 * Persisted as credentials.json in the Gaia data directory.
 *
 * No actual secret values are stored here — only metadata (name, provider,
 * capabilities, scopes, status, verification timestamps).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CredentialEntry, CredentialStatus } from "./types.js";

const CATALOG_FILE = "credentials.json";

export class CredentialCatalog {
  private entries: CredentialEntry[] = [];
  private loaded = false;

  constructor(private readonly dataDir: string) {}

  private get catalogPath(): string {
    return join(this.dataDir, CATALOG_FILE);
  }

  /** Load catalog from disk. Creates empty catalog if file doesn't exist. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.catalogPath, "utf-8");
      this.entries = JSON.parse(raw) as CredentialEntry[];
    } catch {
      this.entries = [];
    }
    this.loaded = true;
  }

  /** Save catalog to disk. */
  async save(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(
      this.catalogPath,
      JSON.stringify(this.entries, null, 2) + "\n",
    );
  }

  private ensureLoaded(): void {
    if (!this.loaded)
      throw new Error("Catalog not loaded — call load() first");
  }

  /** Add a credential entry. Rejects duplicate names. */
  async add(entry: CredentialEntry): Promise<void> {
    this.ensureLoaded();
    if (this.entries.some((e) => e.name === entry.name)) {
      throw new Error(`Credential "${entry.name}" already exists`);
    }
    this.entries.push(entry);
    await this.save();
  }

  /** Remove a credential by name. Returns true if it was removed. */
  async remove(name: string): Promise<boolean> {
    this.ensureLoaded();
    const idx = this.entries.findIndex((e) => e.name === name);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    await this.save();
    return true;
  }

  /** Get a credential by name. */
  get(name: string): CredentialEntry | undefined {
    this.ensureLoaded();
    return this.entries.find((e) => e.name === name);
  }

  /** List all credentials. */
  list(): CredentialEntry[] {
    this.ensureLoaded();
    return [...this.entries];
  }

  /** List credentials that grant a specific capability. */
  listByCapability(capability: string): CredentialEntry[] {
    this.ensureLoaded();
    return this.entries.filter((e) => e.capabilities.includes(capability));
  }

  /** List credentials for a specific provider. */
  listByProvider(provider: string): CredentialEntry[] {
    this.ensureLoaded();
    return this.entries.filter((e) => e.provider === provider);
  }

  /**
   * Mark a credential as verified: updates lastVerified timestamp and sets
   * status to "active". Returns the updated entry or undefined if not found.
   */
  async verify(name: string): Promise<CredentialEntry | undefined> {
    this.ensureLoaded();
    const entry = this.entries.find((e) => e.name === name);
    if (!entry) return undefined;
    entry.status = "active";
    entry.lastVerified = new Date().toISOString();
    await this.save();
    return entry;
  }
}
