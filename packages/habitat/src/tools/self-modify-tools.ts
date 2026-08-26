/**
 * Self-modification tools: let the agent create new tools and skills
 * in the habitat work directory, and hot-reload them into the current session.
 */

import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadToolsFromDirectory } from "@umwelten/core/stimulus/tools/loader.js";
import {
  discoverSkillsInDirectory,
} from "@umwelten/core/stimulus/skills/index.js";
import type { Habitat } from "../habitat.js";

export interface SelfModifyToolsContext {
  getWorkDir(): string;
  addTools(tools: Record<string, import("ai").Tool>): void;
  getStimulus(): Promise<import("@umwelten/core/stimulus/stimulus.js").Stimulus>;
}

export function createSelfModifyTools(habitat: SelfModifyToolsContext) {
  const workDir = habitat.getWorkDir();
  const toolsDir = join(workDir, "tools");
  const skillsDir = join(workDir, "skills");
  const componentsDir = join(workDir, "components");

  const create_tool = tool({
    description:
      "Create a new tool in the habitat tools directory. " +
      "Tools are executable TypeScript with access to process.env for API keys/secrets. " +
      "For API integrations: read keys from process.env, use fetch() for HTTP. " +
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
      "Skills are SKILL.md instructions that teach the agent how to accomplish tasks. " +
      "Skills can be instruction-only (workflows, checklists) or bundle scripts alongside the SKILL.md. " +
      "To bundle scripts: after create_skill, use write_file to add scripts to the skill directory " +
      "(e.g. skills/<name>/scripts/my-script.sh), then reference them in the instructions. " +
      "For API integrations that need auth, prefer creating a tool (handler.ts with process.env access) " +
      "or bundle a script that reads the env var — don't inline curl/wget with API key references.",
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

      // Analyze instructions for common anti-patterns and provide guidance
      const hints: string[] = [];
      if (/curl\s.*https?:\/\/|wget\s.*https?:\/\//.test(instructions)) {
        hints.push(
          "Skill instructions contain inline curl/wget commands. Consider creating a " +
            "script at skills/" +
            name +
            "/scripts/ and referencing it instead. " +
            "Scripts can read env vars directly (e.g. $MY_API_KEY in bash).",
        );
      }
      if (
        /\b[A-Z_]*(?:API[_-]?KEY|TOKEN)\b/.test(instructions) &&
        !/\buse the .* tool\b/i.test(instructions)
      ) {
        hints.push(
          "Skill mentions API keys but doesn't reference an existing tool. " +
            "Check if a tool already handles this API (use list_custom_tools). " +
            "If so, the skill should say 'use the <tool_name> tool' instead of " +
            "describing how to call the API directly.",
        );
      }

      return {
        created: name,
        path: skillDir,
        message: `Skill '${name}' created. It will be available after reload_skills or in the next session.`,
        ...(hints.length > 0 ? { hints } : {}),
      };
    },
  });

  const create_component = tool({
    description:
      "Create a UI component for this habitat's shell page (ADR 0031 — " +
      "interfaces compose on the substrate). The component appears in the " +
      "live page within seconds — no reload, no restart — and edits via " +
      "this tool (same name) hot-replace it; a broken edit leaves the " +
      "previous version running.\n\n" +
      "Write a plain ES module (no build step, no framework) that " +
      "default-exports a component spec:\n\n" +
      '  import { serviceKey } from "../substrate/index.js";\n' +
      '  const regionKey = serviceKey("shell:region");   // the HTMLElement to render into\n' +
      '  const baseKey = serviceKey("shell:base");       // URL for host endpoints\n' +
      '  const conversationKey = serviceKey("shell:conversation"); // { send(text), subscribe(fn), messages }\n' +
      "  export default {\n" +
      '    name: "my-widget",\n' +
      "    inject: [regionKey],                 // services you need; you activate when all exist\n" +
      "    apply(ctx, view, config) {\n" +
      '      const el = document.createElement("div");\n' +
      '      el.className = "shell-card";       // the shell\'s card styling\n' +
      "      view.get(regionKey).appendChild(el);\n" +
      "      const timer = setInterval(() => {}, 1000);\n" +
      "      ctx.effect(() => () => clearInterval(timer)); // every side effect supplies its undo\n" +
      "      return () => el.remove();          // your inverse: called on unmount\n" +
      "    },\n" +
      "  };\n\n" +
      "Custom elements: guard registration with " +
      "`if (!customElements.get(...))` since hot-reload re-evaluates the module.\n\n" +
      "Layout (ADR 0034): to rearrange the page, create a component named " +
      '"layout" — it replaces the stock layout (collapsible rail + main) ' +
      "while it exists, and removing it restores the stock one. Read " +
      "./components/layout.js on this host for the shape: a placement map " +
      "keyed by data-component, a style element, containers you create, and " +
      "a disposer that puts every adopted panel back. Never re-parent " +
      '[data-component="foreign"] elements — moving an iframe reloads it.',
    inputSchema: z.object({
      name: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/)
        .describe('Component name in kebab-case (e.g. "session-clock")'),
      moduleCode: z
        .string()
        .describe(
          "The complete ES module source. Must default-export a component " +
            "spec (apply function, optional inject array).",
        ),
    }),
    execute: async ({ name, moduleCode }) => {
      await mkdir(componentsDir, { recursive: true });
      const file = join(componentsDir, `${name}.js`);
      await writeFile(file, moduleCode);
      return {
        created: name,
        path: file,
        message:
          `Component '${name}' written. The shell page picks it up within ` +
          `a few seconds as 'custom:${name}' — check the page (or its ` +
          `status line, which reports load errors) to confirm it mounted.`,
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
        const allSkills: import("@umwelten/core/stimulus/skills/types.js").SkillDefinition[] = [];
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
      "List all custom tools, skills, and shell components in the habitat work directory.",
    inputSchema: z.object({}),
    execute: async () => {
      const tools: string[] = [];
      const skills: string[] = [];
      const components: string[] = [];

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

      try {
        const componentEntries = await readdir(componentsDir, {
          withFileTypes: true,
        });
        for (const entry of componentEntries) {
          if (entry.isFile() && entry.name.endsWith(".js"))
            components.push(entry.name.replace(/\.js$/, ""));
        }
      } catch {
        // components/ may not exist
      }

      return { tools, skills, components };
    },
  });

  const remove_custom_tool = tool({
    description:
      "Remove a custom tool, skill, or shell component from the habitat work directory.",
    inputSchema: z.object({
      name: z.string().describe("Name of the tool, skill, or component to remove"),
      type: z
        .enum(["tool", "skill", "component"])
        .describe("What kind of thing to remove"),
    }),
    execute: async ({ name, type }) => {
      const target =
        type === "tool"
          ? join(toolsDir, name)
          : type === "skill"
            ? join(skillsDir, name)
            : join(componentsDir, `${name}.js`);
      try {
        await rm(target, { recursive: true });
        return {
          removed: name,
          type,
          message:
            type === "component"
              ? `Removed component '${name}'. The shell page unmounts it within a few seconds.`
              : `Removed ${type} '${name}'. It will no longer be available after reload.`,
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
    create_component,
    reload_tools,
    reload_skills,
    list_custom_tools,
    remove_custom_tool,
  };
}
