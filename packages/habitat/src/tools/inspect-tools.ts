/**
 * Inspection tools — discovery without mutation.
 *
 *   inspect_skill         scan a skill directory for env vars + CLI tools
 *   compute_requirements  aggregate requirements across all skills + agents
 *
 * Skill requirements are *discovered* (regex-scanned) rather than declared in
 * SkillDefinition. The SkillDefinition spec is fixed.
 */

import { tool } from "ai";
import type { Tool } from "ai";
import { z } from "zod";
import type { SkillDefinition } from "@umwelten/core/stimulus/skills/types.js";
import {
  inspectSkill,
  mergeRequirements,
} from "../identity/skill-inspector.js";
import type { AgentRequirements } from "../types.js";

export interface InspectToolsContext {
  /** All loaded skills (with absolute `path`). */
  getSkills(): SkillDefinition[];
  /** Aggregate requirements across skills + agents (the same shape as Habitat.computeRequirements). */
  computeRequirements(): Promise<{
    skills: { name: string; path: string; requirements: AgentRequirements }[];
    agents: { id: string; requirements: AgentRequirements }[];
    aggregate: AgentRequirements;
  }>;
}

export function createInspectTools(ctx: InspectToolsContext): Record<string, Tool> {
  const inspectSkillTool = tool({
    description:
      "Inspect a loaded skill and return the environment variables and CLI tools it references. Used to discover requirements without modifying the SKILL.md spec.",
    inputSchema: z.object({
      skillName: z
        .string()
        .describe("Name of a loaded skill to inspect"),
    }),
    execute: async ({ skillName }) => {
      const skill = ctx.getSkills().find((s) => s.name === skillName);
      if (!skill) {
        const available = ctx.getSkills().map((s) => s.name);
        return {
          error: "SKILL_NOT_FOUND",
          message: `No loaded skill named "${skillName}". Available: ${available.join(", ") || "(none)"}`,
        };
      }
      const requirements = await inspectSkill(skill.path);
      return {
        skill: skill.name,
        path: skill.path,
        requirements,
      };
    },
  });

  const computeRequirementsTool = tool({
    description:
      "Aggregate the env vars and CLI tools required by every loaded skill and configured agent. Use to produce a provisioning manifest before exporting or deploying a habitat.",
    inputSchema: z.object({}),
    execute: async () => {
      return await ctx.computeRequirements();
    },
  });

  return {
    inspect_skill: inspectSkillTool,
    compute_requirements: computeRequirementsTool,
  };
}

// Re-export for callers wanting to merge externally.
export { mergeRequirements };
