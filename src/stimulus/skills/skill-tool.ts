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
      const payload = registry.getActivationPayload(skill, args);
      if (!payload) {
        return { error: `Skill '${skill}' not found` };
      }
      const resourceNote = payload.resources.length
        ? `\n\nBundled resources (relative to skillDir, read on demand):\n${payload.resources.map((r) => `- ${r}`).join('\n')}`
        : '';
      return {
        skill: payload.name,
        skillDir: payload.skillDir,
        resources: payload.resources,
        instructions: payload.instructions,
        message:
          `Skill '${payload.name}' activated. Follow the instructions above. ` +
          `Relative paths in the instructions resolve against skillDir: ${payload.skillDir}.` +
          resourceNote,
      };
    },
  });
}
