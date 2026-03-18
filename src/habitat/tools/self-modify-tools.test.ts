import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSelfModifyTools } from "./self-modify-tools.js";

describe("Self-Modify Tools", () => {
  let workDir: string;
  let tools: ReturnType<typeof createSelfModifyTools>;
  let addedTools: Record<string, unknown>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "self-modify-test-"));
    addedTools = {};

    const mockHabitat = {
      getWorkDir: () => workDir,
      addTools: (t: Record<string, unknown>) => {
        Object.assign(addedTools, t);
      },
      getStimulus: async () => ({
        getSkillsRegistry: () => ({
          addSkills: () => {},
        }),
      }),
    };

    tools = createSelfModifyTools(mockHabitat as any);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe("create_tool", () => {
    it("should create TOOL.md and handler.ts in the tools directory", async () => {
      const result = await tools.create_tool.execute(
        {
          name: "hello-world",
          description: "Says hello",
          handlerCode: `import { tool } from 'ai';
import { z } from 'zod';
export default tool({
  description: 'Says hello',
  inputSchema: z.object({ name: z.string() }),
  execute: async ({ name }) => ({ message: \`Hello \${name}\` }),
});`,
        },
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );

      expect(result.created).toBe("hello-world");

      const toolMd = await readFile(
        join(workDir, "tools", "hello-world", "TOOL.md"),
        "utf-8",
      );
      expect(toolMd).toContain("name: hello-world");
      expect(toolMd).toContain("Says hello");

      const handler = await readFile(
        join(workDir, "tools", "hello-world", "handler.ts"),
        "utf-8",
      );
      expect(handler).toContain("Says hello");
    });
  });

  describe("create_skill", () => {
    it("should create SKILL.md in the skills directory", async () => {
      const result = await tools.create_skill.execute(
        {
          name: "test-skill",
          description: "A test skill",
          instructions: "# Test\n\nDo the thing.",
        },
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );

      expect(result.created).toBe("test-skill");

      const skillMd = await readFile(
        join(workDir, "skills", "test-skill", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("name: test-skill");
      expect(skillMd).toContain("Do the thing.");
    });
  });

  describe("list_custom_tools", () => {
    it("should list tools and skills", async () => {
      // Create a tool and skill first
      await tools.create_tool.execute(
        {
          name: "my-tool",
          description: "test",
          handlerCode: "export default {}",
        },
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );
      await tools.create_skill.execute(
        {
          name: "my-skill",
          description: "test",
          instructions: "test",
        },
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );

      const result = await tools.list_custom_tools.execute(
        {},
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );

      expect(result.tools).toContain("my-tool");
      expect(result.skills).toContain("my-skill");
    });

    it("should return empty arrays when directories don't exist", async () => {
      const result = await tools.list_custom_tools.execute(
        {},
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );

      expect(result.tools).toEqual([]);
      expect(result.skills).toEqual([]);
    });
  });

  describe("remove_custom_tool", () => {
    it("should remove a tool directory", async () => {
      await tools.create_tool.execute(
        {
          name: "to-remove",
          description: "test",
          handlerCode: "export default {}",
        },
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );

      const result = await tools.remove_custom_tool.execute(
        { name: "to-remove", type: "tool" },
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );

      expect(result.removed).toBe("to-remove");

      // Verify it's gone
      const listing = await tools.list_custom_tools.execute(
        {},
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );
      expect(listing.tools).not.toContain("to-remove");
    });
  });

  describe("reload_tools", () => {
    it("should reload tools from the tools directory", async () => {
      // reload with empty dir should succeed
      const result = await tools.reload_tools.execute(
        {},
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      );

      expect(result.count).toBe(0);
      expect(result.reloaded).toEqual([]);
    });
  });
});
