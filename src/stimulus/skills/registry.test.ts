import { describe, it, expect } from 'vitest';
import { SkillsRegistry } from './registry.js';
import type { SkillDefinition } from './types.js';

function makeSkill(name: string, description: string, instructions: string): SkillDefinition {
  return { name, description, instructions, path: `/fake/${name}` };
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
});
