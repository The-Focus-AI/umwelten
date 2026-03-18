/**
 * Self-modification tools: let the agent create new tools and skills
 * in the habitat work directory, and hot-reload them into the current session.
 */

import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadToolsFromDirectory } from "../../stimulus/tools/loader.js";
import {
  discoverSkillsInDirectory,
} from "../../stimulus/skills/index.js";
import type { Habitat } from "../habitat.js";

export interface SelfModifyToolsContext {
  getWorkDir(): string;
  addTools(tools: Record<string, import("ai").Tool>): void;
  getStimulus(): Promise<import("../../stimulus/stimulus.js").Stimulus>;
}

export function createSelfModifyTools(habitat: SelfModifyToolsContext) {
  const workDir = habitat.getWorkDir();
  const toolsDir = join(workDir, "tools");
  const skillsDir = join(workDir, "skills");

  const create_tool = tool({
    description:
      "Create a new tool in the habitat tools directory. " +
      "Write a TOOL.md with frontmatter (name, description) and a handler.ts " +
      "that default-exports a Vercel AI SDK Tool. " +
      "After creation, call reload_tools to make it available immediately.",
    inputSchema: z.object({
      name: z
        .string()
        .describe('Tool name in kebab-case (e.g. "pdf-reader")'),
      description: z.string().describe("What the tool does"),
      handlerCode: z
        .string()
        .describe(
          "TypeScript code for handler.ts. Must default-export a Vercel AI SDK Tool " +
            "(using `tool()` from 'ai' and `z` from 'zod') " +
            "or a factory function (context) => Tool.",
        ),
    }),
    execute: async ({ name, description, handlerCode }) => {
      const toolDir = join(toolsDir, name);
      await mkdir(toolDir, { recursive: true });

      const toolMd = [
        "---",
        `name: ${name}`,
        `description: "${description.replace(/"/g, '\\"')}"`,
        "---",
        "",
        description,
        "",
      ].join("\n");
      await writeFile(join(toolDir, "TOOL.md"), toolMd);
      await writeFile(join(toolDir, "handler.ts"), handlerCode);

      return {
        created: name,
        path: toolDir,
        message: `Tool '${name}' created at ${toolDir}. Call reload_tools to use it now.`,
      };
    },
  });

  const create_skill = tool({
    description:
      "Create a new skill in the habitat skills directory. " +
      "Skills are markdown instructions the agent can activate via the skill tool.",
    inputSchema: z.object({
      name: z.string().describe("Skill name in kebab-case"),
      description: z.string().describe("When to use this skill (shown in skill list)"),
      instructions: z
        .string()
        .describe("The full skill instructions in markdown"),
    }),
    execute: async ({ name, description, instructions }) => {
      const skillDir = join(skillsDir, name);
      await mkdir(skillDir, { recursive: true });

      const content = [
        "---",
        `name: ${name}`,
        `description: "${description.replace(/"/g, '\\"')}"`,
        "---",
        "",
        instructions,
        "",
      ].join("\n");
      await writeFile(join(skillDir, "SKILL.md"), content);

      return {
        created: name,
        path: skillDir,
        message: `Skill '${name}' created. It will be available after reload_skills or in the next session.`,
      };
    },
  });

  const reload_tools = tool({
    description:
      "Reload all tools from the habitat tools directory. " +
      "Use after create_tool to make newly created tools available immediately.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const tools = await loadToolsFromDirectory(workDir, "tools");
        if (Object.keys(tools).length > 0) {
          habitat.addTools(tools);
        }
        return {
          reloaded: Object.keys(tools),
          count: Object.keys(tools).length,
          message: `Reloaded ${Object.keys(tools).length} tool(s): ${Object.keys(tools).join(", ") || "(none)"}`,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          message: "Failed to reload tools.",
        };
      }
    },
  });

  const reload_skills = tool({
    description:
      "Reload all skills from the habitat skills directory. " +
      "Use after create_skill to make newly created skills available immediately.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const stimulus = await habitat.getStimulus();
        const skillsDirs = [skillsDir];
        const allSkills: import("../../stimulus/skills/types.js").SkillDefinition[] = [];
        for (const dir of skillsDirs) {
          const skills = await discoverSkillsInDirectory(dir);
          allSkills.push(...skills);
        }
        const registry = stimulus.getSkillsRegistry();
        if (registry) {
          registry.addSkills(allSkills);
        }
        return {
          reloaded: allSkills.map((s) => s.name),
          count: allSkills.length,
          message: `Reloaded ${allSkills.length} skill(s): ${allSkills.map((s) => s.name).join(", ") || "(none)"}`,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          message: "Failed to reload skills.",
        };
      }
    },
  });

  const list_custom_tools = tool({
    description:
      "List all custom tools and skills in the habitat work directory.",
    inputSchema: z.object({}),
    execute: async () => {
      const tools: string[] = [];
      const skills: string[] = [];

      try {
        const toolEntries = await readdir(toolsDir, { withFileTypes: true });
        for (const entry of toolEntries) {
          if (entry.isDirectory()) tools.push(entry.name);
        }
      } catch {
        // tools/ may not exist
      }

      try {
        const skillEntries = await readdir(skillsDir, { withFileTypes: true });
        for (const entry of skillEntries) {
          if (entry.isDirectory()) skills.push(entry.name);
        }
      } catch {
        // skills/ may not exist
      }

      return { tools, skills };
    },
  });

  const remove_custom_tool = tool({
    description:
      "Remove a custom tool or skill from the habitat work directory.",
    inputSchema: z.object({
      name: z.string().describe("Name of the tool or skill to remove"),
      type: z
        .enum(["tool", "skill"])
        .describe("Whether to remove a tool or skill"),
    }),
    execute: async ({ name, type }) => {
      const dir = type === "tool" ? join(toolsDir, name) : join(skillsDir, name);
      try {
        await rm(dir, { recursive: true });
        return {
          removed: name,
          type,
          message: `Removed ${type} '${name}'. It will no longer be available after reload.`,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          message: `Failed to remove ${type} '${name}'.`,
        };
      }
    },
  });

  return {
    create_tool,
    create_skill,
    reload_tools,
    reload_skills,
    list_custom_tools,
    remove_custom_tool,
  };
}
