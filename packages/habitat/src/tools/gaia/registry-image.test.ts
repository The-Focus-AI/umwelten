/**
 * Registry round-trip tests for the per-entry image field (#115).
 * Real filesystem in a tmp dir — the registry is plain JSON on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GaiaRegistryManager } from './registry.js';

describe('GaiaRegistryManager — image field', () => {
  let dataDir: string;
  let registry: GaiaRegistryManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'umwl-gaia-reg-'));
    registry = new GaiaRegistryManager(dataDir);
    await registry.load();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('persists the image field when provided', async () => {
    const entry = await registry.create({
      id: 'coding-agent',
      name: 'Coding Agent',
      image: 'habitat-coding',
    });
    expect(entry.image).toBe('habitat-coding');

    const raw = JSON.parse(
      await readFile(join(dataDir, 'registry.json'), 'utf-8'),
    );
    expect(raw.habitats[0].image).toBe('habitat-coding');

    // Survives a reload from disk
    const fresh = new GaiaRegistryManager(dataDir);
    await fresh.load();
    expect(fresh.get('coding-agent')?.image).toBe('habitat-coding');
  });

  it('omits the image key entirely when not provided (no behavior change)', async () => {
    const entry = await registry.create({ id: 'plain', name: 'Plain' });
    expect(entry.image).toBeUndefined();
    expect('image' in entry).toBe(false);

    const raw = JSON.parse(
      await readFile(join(dataDir, 'registry.json'), 'utf-8'),
    );
    expect('image' in raw.habitats[0]).toBe(false);
  });

  it('loads pre-existing registries without an image field (back compat)', async () => {
    await registry.create({ id: 'old-style', name: 'Old Style' });
    const fresh = new GaiaRegistryManager(dataDir);
    await fresh.load();
    const entry = fresh.get('old-style');
    expect(entry).toBeDefined();
    expect(entry?.image).toBeUndefined();
  });

  it('allows updating the image after creation', async () => {
    await registry.create({ id: 'upgradeable', name: 'Upgradeable' });
    const updated = await registry.update('upgradeable', {
      image: 'habitat-oura',
    });
    expect(updated.image).toBe('habitat-oura');

    const fresh = new GaiaRegistryManager(dataDir);
    await fresh.load();
    expect(fresh.get('upgradeable')?.image).toBe('habitat-oura');
  });
});
