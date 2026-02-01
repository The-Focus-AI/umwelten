import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkillFromPath, loadSkillsFromDirectory } from './loader.js';

describe('skills loader', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `umwelten-skills-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('loadSkillFromPath returns null when SKILL.md is missing', async () => {
    await mkdir(join(tmpDir, 'empty-dir'), { recursive: true });
    const result = await loadSkillFromPath(join(tmpDir, 'empty-dir'));
    expect(result).toBeNull();
  });

  it('loadSkillFromPath returns skill when SKILL.md has name and description', async () => {
    const skillDir = join(tmpDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: Does something useful
---

# Instructions

Do step 1. Then step 2.
`,
      'utf-8'
    );
    const result = await loadSkillFromPath(skillDir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-skill');
    expect(result!.description).toBe('Does something useful');
    expect(result!.instructions).toContain('Do step 1');
    expect(result!.path).toBe(skillDir);
  });

  it('loadSkillFromPath returns null when name is missing', async () => {
    const skillDir = join(tmpDir, 'bad-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
description: No name here
---

Body
`,
      'utf-8'
    );
    const result = await loadSkillFromPath(skillDir);
    expect(result).toBeNull();
  });

  it('loadSkillsFromDirectory returns empty array for empty dir', async () => {
    const result = await loadSkillsFromDirectory(tmpDir);
    expect(result).toEqual([]);
  });

  it('loadSkillsFromDirectory loads all subdirs with SKILL.md', async () => {
    for (const name of ['skill-a', 'skill-b']) {
      const skillDir = join(tmpDir, name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: ${name}
description: ${name} description
---

Instructions for ${name}.
`,
        'utf-8'
      );
    }
    const result = await loadSkillsFromDirectory(tmpDir);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name).sort()).toEqual(['skill-a', 'skill-b']);
  });
});
