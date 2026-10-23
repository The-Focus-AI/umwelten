/**
 * Habitat.create loads tools from the cloned project dir (ADR 0004, rollout
 * phase 1): repo-backed habitats (config.gitUrl) ship `tools/` in their repo.
 * Project tools load first, work-dir tools load last — the work dir wins name
 * collisions (operator override). Exercises the real loader against a temp
 * dir with TOOL.md + handler.js (direct Tool export).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "ai";
import { Habitat } from "./habitat.js";
import { registerAiTool } from "./mcp-tool-bridge.js";
import type { HabitatConfig } from "./types.js";

// Temp fixtures have no node_modules; resolve the installed package without
// hard-coding its version. Real handlers must provision imports or use script tools.
const zodUrl = pathToFileURL(createRequire(import.meta.url).resolve("zod")).href;

async function writeTool(
	toolsBase: string,
	name: string,
	returnValue: string,
): Promise<void> {
	const dir = join(toolsBase, name);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "TOOL.md"),
		`---\nname: ${name}\ndescription: test tool ${name}\n---\n\nTest tool.\n`,
	);
	// Use the real MCP-compatible contract, not a loader-only plain-schema stub.
	await writeFile(
		join(dir, "handler.js"),
		[
			`import { z } from ${JSON.stringify(zodUrl)};`,
			"export default {",
			`	description: "test tool ${name}",`,
			"	inputSchema: z.object({}),",
			`	execute: async () => ${JSON.stringify(returnValue)},`,
			"};",
			"",
		].join("\n"),
	);
}

async function execute(tool: Tool): Promise<unknown> {
	// Loading and direct execution alone miss schemas that break every /mcp request.
	const server = new McpServer({ name: "project-tool-fixture", version: "1.0.0" });
	try {
		registerAiTool(server, "fixture", tool);
	} finally {
		await server.close();
	}
	// AI SDK tools take (input, options); ours ignore both.
	return (tool.execute as (a: unknown, b: unknown) => Promise<unknown>)(
		{},
		{ toolCallId: "t", messages: [] },
	);
}

function repoBackedConfig(): HabitatConfig {
	return { agents: [], gitUrl: "https://github.com/example/fake.git" };
}

describe("Habitat.create project-dir tools", () => {
	let workDir: string;

	beforeEach(async () => {
		workDir = await mkdtemp(join(tmpdir(), "umwl-habitat-project-tools-"));
	});

	afterEach(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it("picks up tools from <projectDir>/tools for repo-backed habitats", async () => {
		await writeTool(join(workDir, "project", "tools"), "greet", "from-project");

		const habitat = await Habitat.create({
			workDir,
			config: repoBackedConfig(),
			skipBuiltinTools: true,
			skipSkills: true,
		});

		const tools = habitat.getTools();
		expect(Object.keys(tools)).toContain("greet");
		expect(await execute(tools.greet)).toBe("from-project");
	});

	it("work-dir tool wins a name collision with a project tool", async () => {
		await writeTool(join(workDir, "project", "tools"), "clash", "from-project");
		await writeTool(join(workDir, "tools"), "clash", "from-workdir");

		const habitat = await Habitat.create({
			workDir,
			config: repoBackedConfig(),
			skipBuiltinTools: true,
			skipSkills: true,
		});

		expect(await execute(habitat.getTools().clash)).toBe("from-workdir");
	});

	it("does not load project tools for non-provisioned habitats (no gitUrl)", async () => {
		await writeTool(join(workDir, "project", "tools"), "ghost", "from-project");

		const habitat = await Habitat.create({
			workDir,
			config: { agents: [] },
			skipBuiltinTools: true,
			skipSkills: true,
		});

		expect(Object.keys(habitat.getTools())).not.toContain("ghost");
	});

	it.each([
		{
			failure: "syntax",
			code: "export default { this is not valid JavaScript",
			error: "failed to load handler",
		},
		{
			failure: "MCP registration",
			code: 'export default { inputSchema: { type: "object", properties: {} }, execute: async () => "broken" };',
			error: 'Tool "stable" failed MCP registration',
		},
		{
			failure: "MCP schema serialization",
			code: `import { z } from ${JSON.stringify(zodUrl)}; export default { inputSchema: z.object({ value: z.custom() }), execute: async () => "broken" };`,
			error: "MCP validation failed",
		},
	])("keeps the previous work-directory layer on $failure failure", async ({ code, error }) => {
		await writeTool(join(workDir, "tools"), "stable", "working");
		const habitat = await Habitat.create({
			workDir,
			config: { agents: [] },
			skipBuiltinTools: true,
			skipSkills: true,
		});

		await writeFile(
			join(workDir, "tools", "stable", "handler.js"),
			code,
		);

		await expect(habitat.reloadWorkDirTools()).rejects.toThrow(error);
		expect(await execute(habitat.getTools().stable)).toBe("working");

		await writeTool(join(workDir, "tools"), "stable", "repaired");
		await expect(habitat.reloadWorkDirTools()).resolves.toEqual(["stable"]);
		expect(await execute(habitat.getTools().stable)).toBe("repaired");
	});
});
