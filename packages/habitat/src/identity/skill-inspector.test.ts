import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	inspectSkill,
	mergeRequirements,
	type InspectorCatalog,
} from "./skill-inspector.js";

describe("inspectSkill", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "skill-inspect-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function write(rel: string, content: string): Promise<void> {
		const abs = join(dir, rel);
		await mkdir(join(abs, ".."), { recursive: true });
		await writeFile(abs, content);
	}

	it("returns empty requirements for an empty directory", async () => {
		const r = await inspectSkill(dir);
		expect(r.envVars).toEqual([]);
		expect(r.cliTools).toEqual([]);
		expect(r.sourceHash).toBeDefined();
	});

	it("discovers process.env references in TypeScript", async () => {
		await write(
			"scripts/run.ts",
			`
      const key = process.env.GEMINI_API_KEY;
      const explicit = process.env["TAVILY_API_KEY"];
      console.log(process.env.HOME);  // noise, filtered
    `,
		);
		const r = await inspectSkill(dir);
		const names = r.envVars.map((e) => e.name).sort();
		expect(names).toContain("GEMINI_API_KEY");
		expect(names).toContain("TAVILY_API_KEY");
		expect(names).not.toContain("HOME");
	});

	it("discovers shell env vars and CLI invocations", async () => {
		await write(
			"scripts/install.sh",
			[
				"#!/bin/sh",
				"set -e",
				'echo "using ${GITHUB_TOKEN}"',
				"curl -sSL https://example.com/install.sh | bash",
				"cargo build --release",
			].join("\n"),
		);
		const r = await inspectSkill(dir);
		expect(r.envVars.find((e) => e.name === "GITHUB_TOKEN")).toBeDefined();
		expect(r.cliTools.find((c) => c.name === "curl")).toBeDefined();
		expect(r.cliTools.find((c) => c.name === "cargo")).toBeDefined();
		// builtins filtered
		expect(r.cliTools.find((c) => c.name === "echo")).toBeUndefined();
		expect(r.cliTools.find((c) => c.name === "set")).toBeUndefined();
	});

	it("discovers Python os.environ references", async () => {
		await write(
			"scripts/main.py",
			`
      import os
      key = os.environ["OPENAI_API_KEY"]
      sec = os.getenv("ANTHROPIC_API_KEY")
    `,
		);
		const r = await inspectSkill(dir);
		const names = r.envVars.map((e) => e.name).sort();
		expect(names).toContain("OPENAI_API_KEY");
		expect(names).toContain("ANTHROPIC_API_KEY");
	});

	it("picks up vars declared in SKILL.md 'Required environment variables' section", async () => {
		await write(
			"SKILL.md",
			[
				"# My Skill",
				"",
				"## Required environment variables",
				"",
				"- `MY_DECLARED_VAR` — used by the skill",
				"- ANOTHER_VAR — required",
				"",
				"## Other section",
				"",
				"- IGNORED_VAR — outside the env section",
			].join("\n"),
		);
		const r = await inspectSkill(dir);
		const names = r.envVars.map((e) => e.name);
		expect(names).toContain("MY_DECLARED_VAR");
		expect(names).toContain("ANOTHER_VAR");
		expect(names).not.toContain("IGNORED_VAR");
	});

	it("hash is stable across runs", async () => {
		await write("scripts/run.ts", "const k = process.env.FOO_KEY;");
		const r1 = await inspectSkill(dir);
		const r2 = await inspectSkill(dir);
		expect(r1.sourceHash).toBe(r2.sourceHash);
	});

	it("without catalog, returns no capabilityHints", async () => {
		await write("scripts/run.ts", "const k = process.env.QUICKBOOKS_API_KEY;");
		const r = await inspectSkill(dir);
		expect(r.envVars).toHaveLength(1);
		expect(r.envVars[0].name).toBe("QUICKBOOKS_API_KEY");
		expect(r.capabilityHints).toBeUndefined();
	});

	it("with catalog, maps discovered env vars to capability hints", async () => {
		await write("scripts/run.ts", "const k = process.env.QUICKBOOKS_API_KEY;");
		const catalog: InspectorCatalog = {
			get(name: string) {
				if (name === "QUICKBOOKS_API_KEY") {
					return {
						name: "quickbooks-read-key",
						capabilities: ["quickbooks:read"],
					};
				}
				return undefined;
			},
		};
		const r = await inspectSkill(dir, { catalog });
		expect(r.envVars).toHaveLength(1);
		expect(r.capabilityHints).toBeDefined();
		expect(r.capabilityHints).toHaveLength(1);
		expect(r.capabilityHints![0]).toMatchObject({
			envVar: "QUICKBOOKS_API_KEY",
			capability: "quickbooks:read",
			credential: "quickbooks-read-key",
		});
	});

	it("with catalog, maps multiple env vars from multiple sources", async () => {
		await write("scripts/run.ts", "const a = process.env.GITHUB_TOKEN;");
		await write(
			"scripts/query.py",
			'import os\nkey = os.environ["QUICKBOOKS_API_KEY"]',
		);
		const catalog: InspectorCatalog = {
			get(name: string) {
				if (name === "GITHUB_TOKEN") {
					return { name: "org-readonly-key", capabilities: ["github:read"] };
				}
				if (name === "QUICKBOOKS_API_KEY") {
					return {
						name: "quickbooks-read-key",
						capabilities: ["quickbooks:read", "quickbooks:write"],
					};
				}
				return undefined;
			},
		};
		const r = await inspectSkill(dir, { catalog });
		expect(r.envVars).toHaveLength(2);
		expect(r.capabilityHints).toBeDefined();
		expect(r.capabilityHints).toHaveLength(3); // 1 + 2 capabilities
		const caps = r
			.capabilityHints!.map((h) => `${h.envVar}:${h.capability}`)
			.sort();
		expect(caps).toEqual([
			"GITHUB_TOKEN:github:read",
			"QUICKBOOKS_API_KEY:quickbooks:read",
			"QUICKBOOKS_API_KEY:quickbooks:write",
		]);
	});

	it("with catalog, env vars not in catalog produce no hints", async () => {
		await write("scripts/run.ts", "const k = process.env.UNKNOWN_KEY;");
		const catalog: InspectorCatalog = {
			get(_name: string) {
				return undefined;
			},
		};
		const r = await inspectSkill(dir, { catalog });
		expect(r.envVars).toHaveLength(1);
		expect(r.capabilityHints).toBeUndefined();
	});

	it("with catalog, picks up hints from SKILL.md declared vars too", async () => {
		await write(
			"SKILL.md",
			[
				"# My Skill",
				"",
				"## Required environment variables",
				"",
				"- `QUICKBOOKS_API_KEY` — accounting access",
			].join("\n"),
		);
		const catalog: InspectorCatalog = {
			get(name: string) {
				if (name === "QUICKBOOKS_API_KEY") {
					return {
						name: "quickbooks-read-key",
						capabilities: ["quickbooks:read"],
					};
				}
				return undefined;
			},
		};
		const r = await inspectSkill(dir, { catalog });
		expect(r.envVars).toHaveLength(1);
		expect(r.capabilityHints).toHaveLength(1);
		expect(r.capabilityHints![0].capability).toBe("quickbooks:read");
	});
});

describe("mergeRequirements", () => {
	it("dedups by name and promotes required:true", () => {
		const merged = mergeRequirements([
			{
				envVars: [{ name: "A", reason: "from skill1", required: false }],
				cliTools: [],
			},
			{
				envVars: [{ name: "A", reason: "from skill2", required: true }],
				cliTools: [],
			},
		]);
		expect(merged.envVars).toHaveLength(1);
		expect(merged.envVars[0].name).toBe("A");
		expect(merged.envVars[0].required).toBe(true);
	});

	it("dedups capability hints by envVar:capability key", () => {
		const merged = mergeRequirements([
			{
				envVars: [],
				cliTools: [],
				capabilityHints: [
					{
						envVar: "GITHUB_TOKEN",
						capability: "github:read",
						credential: "org-key",
						source: "scripts/a.ts",
					},
				],
			},
			{
				envVars: [],
				cliTools: [],
				capabilityHints: [
					{
						envVar: "GITHUB_TOKEN",
						capability: "github:read",
						credential: "org-key",
						source: "scripts/b.ts",
					},
					{
						envVar: "QUICKBOOKS_API_KEY",
						capability: "quickbooks:read",
						credential: "qb-key",
						source: "scripts/c.py",
					},
				],
			},
		]);
		expect(merged.capabilityHints).toBeDefined();
		expect(merged.capabilityHints).toHaveLength(2);
		const keys = merged
			.capabilityHints!.map((h) => `${h.envVar}:${h.capability}`)
			.sort();
		expect(keys).toEqual([
			"GITHUB_TOKEN:github:read",
			"QUICKBOOKS_API_KEY:quickbooks:read",
		]);
	});

	it("returns no capabilityHints when none of the parts have them", () => {
		const merged = mergeRequirements([
			{ envVars: [], cliTools: [] },
			{ envVars: [], cliTools: [] },
		]);
		expect(merged.capabilityHints).toBeUndefined();
	});
});
