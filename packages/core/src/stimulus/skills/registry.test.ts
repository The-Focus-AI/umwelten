import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillsRegistry } from './registry.js';
import type { SkillDefinition } from './types.js';

function makeSkill(name: string, description: string, instructions: string, path?: string): SkillDefinition {
  return { name, description, instructions, path: path ?? `/fake/${name}` };
}

describe('SkillsRegistry', () => {
  it('addSkills and listSkills', () => {
    const reg = new SkillsRegistry();
    reg.addSkills([
      makeSkill('a', 'Desc A', 'Do A'),
      makeSkill('b', 'Desc B', 'Do B'),
    ]);
    expect(reg.listSkills()).toHaveLength(2);
    expect(reg.hasSkills()).toBe(true);
  });

  it('later skill overwrites same name', () => {
    const reg = new SkillsRegistry();
    reg.addSkills([makeSkill('x', 'First', 'Instructions 1')]);
    reg.addSkills([makeSkill('x', 'Second', 'Instructions 2')]);
    expect(reg.listSkills()).toHaveLength(1);
    expect(reg.getSkill('x')!.description).toBe('Second');
  });

  it('getSkillsMetadataPrompt returns block when skills exist', () => {
    const reg = new SkillsRegistry();
    reg.addSkills([makeSkill('deploy', 'Deploy app', 'Run deploy script')]);
    const prompt = reg.getSkillsMetadataPrompt();
    expect(prompt).toContain('Available Skills');
    expect(prompt).toContain('deploy');
    expect(prompt).toContain('Deploy app');
  });

  it('getSkillsMetadataPrompt returns empty when no skills', () => {
    const reg = new SkillsRegistry();
    expect(reg.getSkillsMetadataPrompt()).toBe('');
  });

  it('activateSkill returns instructions and applies $ARGUMENTS', () => {
    const reg = new SkillsRegistry();
    reg.addSkills([
      makeSkill('greet', 'Greet user', 'Say hello to $ARGUMENTS and offer help.'),
    ]);
    const out = reg.activateSkill('greet', 'Alice');
    expect(out).toContain('Say hello to Alice and offer help.');
  });

  it('activateSkill returns null for unknown skill', () => {
    const reg = new SkillsRegistry();
    expect(reg.activateSkill('nonexistent')).toBeNull();
  });

  describe('getActivationPayload', () => {
    let tmp: string;

    beforeEach(async () => {
      tmp = join(tmpdir(), `umwelten-skills-activate-${Date.now()}`);
      await mkdir(tmp, { recursive: true });
    });

    afterEach(async () => {
      try {
        await rm(tmp, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('returns skillDir and empty resources when no scripts/references/assets exist', () => {
      const reg = new SkillsRegistry();
      reg.addSkills([makeSkill('a', 'Desc', 'Body', tmp)]);
      const payload = reg.getActivationPayload('a');
      expect(payload).not.toBeNull();
      expect(payload!.skillDir).toBe(tmp);
      expect(payload!.resources).toEqual([]);
      expect(payload!.instructions).toBe('Body');
    });

    it('enumerates files under scripts/, references/, assets/ as relative paths', async () => {
      await mkdir(join(tmp, 'scripts'), { recursive: true });
      await mkdir(join(tmp, 'references'), { recursive: true });
      await mkdir(join(tmp, 'assets', 'templates'), { recursive: true });
      await writeFile(join(tmp, 'scripts', 'run.sh'), '#!/bin/sh\n', 'utf-8');
      await writeFile(join(tmp, 'references', 'FORMAT.md'), '# Format\n', 'utf-8');
      await writeFile(join(tmp, 'assets', 'templates', 'report.md'), '# Report\n', 'utf-8');

      const reg = new SkillsRegistry();
      reg.addSkills([makeSkill('a', 'Desc', 'Body', tmp)]);
      const payload = reg.getActivationPayload('a');
      expect(payload!.resources.sort()).toEqual([
        join('assets', 'templates', 'report.md'),
        join('references', 'FORMAT.md'),
        join('scripts', 'run.sh'),
      ]);
    });

    it('ignores non-resource siblings like SKILL.md', async () => {
      await writeFile(join(tmp, 'SKILL.md'), '---\nname: a\ndescription: d\n---\nBody', 'utf-8');
      await mkdir(join(tmp, 'scripts'), { recursive: true });
      await writeFile(join(tmp, 'scripts', 'go.sh'), '#!/bin/sh\n', 'utf-8');

      const reg = new SkillsRegistry();
      reg.addSkills([makeSkill('a', 'Desc', 'Body', tmp)]);
      const payload = reg.getActivationPayload('a');
      expect(payload!.resources).toEqual([join('scripts', 'go.sh')]);
    });

    it('applies $ARGUMENTS substitution in the returned instructions', () => {
      const reg = new SkillsRegistry();
      reg.addSkills([makeSkill('greet', 'Greet', 'Hello $ARGUMENTS', tmp)]);
      const payload = reg.getActivationPayload('greet', 'World');
      expect(payload!.instructions).toBe('Hello World');
    });

    it('returns null for unknown skill', () => {
      const reg = new SkillsRegistry();
      expect(reg.getActivationPayload('missing')).toBeNull();
    });
  });
});
