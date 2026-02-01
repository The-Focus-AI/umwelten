import { tool } from 'ai';
import { z } from 'zod';
import type { SkillsRegistry } from './registry.js';

export function createSkillTool(registry: SkillsRegistry) {
  const list = registry
    .listSkills()
    .filter((s) => !s.disableModelInvocation)
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');
  const skillToolSchema = z.object({
    skill: z.string().describe('Name of the skill to activate'),
    arguments: z.string().optional().describe('Arguments to pass to the skill'),
  });
  return tool({
    description: `Activate a skill to get specialized instructions for a task. Available skills:\n${list || '(none)'}`,
    inputSchema: skillToolSchema,
    execute: async ({ skill, arguments: args }) => {
      const instructions = registry.activateSkill(skill, args);
      if (!instructions) {
        return { error: `Skill '${skill}' not found` };
      }
      return {
        skill,
        instructions,
        message: `Skill '${skill}' activated. Follow the instructions above.`,
      };
    },
  });
}
