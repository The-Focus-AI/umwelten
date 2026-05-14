/**
 * Saved Exploration Store
 *
 * Persists and retrieves Saved Exploration manifests under
 * `.umwelten/explorations/`. Manifests are human-readable JSON with
 * a version field for forward compatibility.
 *
 * V1 uses reference members only. The schema allows future snapshot
 * members where session content is embedded directly.
 */
import { readFile, readdir, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { slugify } from './saved-reflection-writer.js';
import type { Exploration, SavedExploration, ExplorationMember } from '../types/domain-types.js';

// ── Constants ───────────────────────────────────────────────────────────

const EXPLORATIONS_DIR = '.umwelten/explorations';
const CURRENT_VERSION = 1 as const;

// ── Store ───────────────────────────────────────────────────────────────

export class SavedExplorationStore {
  constructor(private readonly projectRoot: string) {}

  /** Full path to the explorations directory. */
  private get storeDir(): string {
    return join(this.projectRoot, EXPLORATIONS_DIR);
  }

  /** Full path to a manifest file by slug. */
  private manifestPath(slug: string): string {
    return join(this.storeDir, `${slug}.json`);
  }

  /**
   * Ensure the explorations directory exists.
   */
  async ensureDir(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });
  }

  /**
   * Save an Exploration as a persisted Saved Exploration manifest.
   *
   * Generates a slug from the exploration name. If a manifest with
   * that slug already exists, appends a timestamp to disambiguate.
   *
   * Returns the slug used.
   */
  async save(
    exploration: Exploration,
    options?: { name?: string },
  ): Promise<{ slug: string; id: string }> {
    await this.ensureDir();

    const name = options?.name ?? exploration.name;
    let slug = slugify(name);

    // Disambiguate if slug already exists
    const existing = await this.list();
    if (existing.some((e) => e.slug === slug)) {
      slug = `${slug}-${Date.now()}`;
    }

    const saved: SavedExploration = {
      version: CURRENT_VERSION,
      id: exploration.id,
      name,
      saved: new Date().toISOString(),
      members: exploration.members.map((m) => ({
        kind: m.kind,
        sourceSessionId: m.sourceSessionId,
        source: m.source,
        ...(m.label ? { label: m.label } : {}),
      })),
    };

    await writeFile(this.manifestPath(slug), JSON.stringify(saved, null, 2) + '\n', 'utf-8');
    return { slug, id: saved.id };
  }

  /**
   * List all saved explorations, newest first.
   */
  async list(): Promise<SavedExplorationSummary[]> {
    try {
      await this.ensureDir();
      const files = await readdir(this.storeDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort().reverse();

      const results: SavedExplorationSummary[] = [];

      for (const file of jsonFiles) {
        const slug = file.replace(/\.json$/, '');
        const data = await this.openBySlug(slug);
        if (data) {
          results.push({
            slug,
            id: data.id,
            name: data.name,
            saved: data.saved,
            memberCount: data.members.length,
            version: data.version,
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Open a saved exploration by its display name (fuzzy match).
   * Returns the first manifest whose name includes the query.
   */
  async open(name: string): Promise<SavedExploration | null> {
    const list = await this.list();
    const lowerQuery = name.toLowerCase();
    const match = list.find(
      (e) => e.name.toLowerCase() === lowerQuery || e.name.toLowerCase().includes(lowerQuery),
    );
    if (!match) return null;
    return this.openBySlug(match.slug);
  }

  /**
   * Open a saved exploration by its slug.
   */
  async openBySlug(slug: string): Promise<SavedExploration | null> {
    try {
      const raw = await readFile(this.manifestPath(slug), 'utf-8');
      const parsed = JSON.parse(raw) as SavedExploration;

      // Validate version
      if (!parsed.version || typeof parsed.version !== 'number') {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Open a saved exploration by its unique ID.
   */
  async openById(id: string): Promise<SavedExploration | null> {
    const list = await this.list();
    const match = list.find((e) => e.id === id);
    if (!match) return null;
    return this.openBySlug(match.slug);
  }

  /**
   * Delete a saved exploration by slug.
   */
  async delete(slug: string): Promise<boolean> {
    try {
      await unlink(this.manifestPath(slug));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert a SavedExploration manifest back to an Exploration domain object.
   */
  toExploration(saved: SavedExploration): Exploration {
    return {
      id: saved.id,
      name: saved.name,
      kind: 'saved',
      members: saved.members,
      created: saved.saved,
      modified: saved.saved,
      memberCount: saved.members.length,
      savedPath: this.manifestPath(slugify(saved.name)),
    };
  }
}

// ── Types ───────────────────────────────────────────────────────────────

export interface SavedExplorationSummary {
  slug: string;
  id: string;
  name: string;
  saved: string;
  memberCount: number;
  version: number;
}
