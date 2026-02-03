import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkillFromPath, loadSkillsFromDirectory, discoverSkillsInDirectory } from './loader.js';

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

  it('loadSkillFromPath uses dir basename when name is missing in frontmatter', async () => {
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
    expect(result).not.toBeNull();
    expect(result!.name).toBe('bad-skill');
    expect(result!.description).toBe('No name here');
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

  it('discoverSkillsInDirectory returns root SKILL.md plus subdir skills', async () => {
    await writeFile(
      join(tmpDir, 'SKILL.md'),
      `---
name: root-skill
description: Root skill
---

Root instructions.
`,
      'utf-8'
    );
    const subDir = join(tmpDir, 'sub-skill');
    await mkdir(subDir, { recursive: true });
    await writeFile(
      join(subDir, 'SKILL.md'),
      `---
name: sub-skill
description: Sub skill
---

Sub instructions.
`,
      'utf-8'
    );
    const result = await discoverSkillsInDirectory(tmpDir);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name).sort()).toEqual(['root-skill', 'sub-skill']);
  });

  it('discoverSkillsInDirectory finds nested SKILL.md (e.g. .claude/skills/browser-automation)', async () => {
    const nestedDir = join(tmpDir, '.claude', 'skills', 'browser-automation');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(
      join(nestedDir, 'SKILL.md'),
      `---
description: Nested skill with no name (uses dir basename)
---

Nested instructions.
`,
      'utf-8'
    );
    const result = await discoverSkillsInDirectory(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('browser-automation');
    expect(result[0].description).toContain('Nested skill');
  });
});
