import type { SkillDefinition } from './types.js';

export class SkillsRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private activatedSkills: Set<string> = new Set();

  /** Add one or more skills; later same name overwrites. */
  addSkills(definitions: SkillDefinition[]): void {
    for (const s of definitions) {
      this.skills.set(s.name, s);
    }
  }

  /** Get skill metadata block for system prompt (progressive disclosure). */
  getSkillsMetadataPrompt(): string {
    const available = Array.from(this.skills.values()).filter((s) => !s.disableModelInvocation);
    if (available.length === 0) return '';
    const lines = ['# Available Skills', ''];
    for (const skill of available) {
      lines.push(`- **${skill.name}**: ${skill.description}`);
    }
    lines.push('');
    lines.push('To use a skill, invoke it by name. Skills provide specialized instructions.');
    return lines.join('\n');
  }

  /** Activate a skill and return its instructions (with $ARGUMENTS substitution). */
  activateSkill(name: string, args?: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) return null;
    this.activatedSkills.add(name);
    let instructions = skill.instructions;
    if (args) {
      if (instructions.includes('$ARGUMENTS')) {
        instructions = instructions.replace(/\$ARGUMENTS/g, args);
      } else {
        instructions += `\n\nARGUMENTS: ${args}`;
      }
      const argParts = args.split(/\s+/);
      for (let i = 0; i < argParts.length; i++) {
        instructions = instructions.replace(new RegExp(`\\$ARGUMENTS\\[${i}\\]|\\$${i}`, 'g'), argParts[i]);
      }
    }
    return instructions;
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  listUserInvocableSkills(): SkillDefinition[] {
    return this.listSkills().filter((s) => s.userInvocable !== false);
  }

  hasSkills(): boolean {
    return this.skills.size > 0;
  }
}
