import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { SkillDefinition } from './types.js';

/** Subfolders conventionally enumerated at skill activation per Agent Skills spec. */
const RESOURCE_DIRS = ['scripts', 'references', 'assets'];

/** Payload returned on skill activation. Matches spec's <skill_content> recommendation: body + dir + resources. */
export interface SkillActivation {
  name: string;
  instructions: string;
  /** Absolute path to the skill directory. Relative paths inside `instructions` resolve against this. */
  skillDir: string;
  /** Relative paths (from `skillDir`) to files under scripts/, references/, assets/. */
  resources: string[];
}

function listResources(skillDir: string): string[] {
  const found: string[] = [];
  for (const sub of RESOURCE_DIRS) {
    const root = join(skillDir, sub);
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    const stack: string[] = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          found.push(relative(skillDir, full));
        }
      }
    }
  }
  return found.sort();
}

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
    const payload = this.getActivationPayload(name, args);
    return payload ? payload.instructions : null;
  }

  /**
   * Full activation payload per Agent Skills spec: body + skill dir + resource list.
   * The skill dir lets the model resolve relative paths like `scripts/run.sh` referenced in the body.
   */
  getActivationPayload(name: string, args?: string): SkillActivation | null {
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
    return {
      name: skill.name,
      instructions,
      skillDir: skill.path,
      resources: listResources(skill.path),
    };
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
