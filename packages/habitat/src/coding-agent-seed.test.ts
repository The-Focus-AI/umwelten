/**
 * Unit tests for the coding-agent config seeder (#123).
 *
 * The seeder (`coding-agent/seed-config.mjs`) must ensure the workspace +
 * standards-corpus agents and the codex runtime declaration exist WITHOUT
 * clobbering anything Gaia or an operator already wrote. We run the real
 * script against temp files and assert the config.json on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

const SEEDER = resolve(
	fileURLToPath(import.meta.url),
	"..",
	"..",
	"coding-agent",
	"seed-config.mjs",
);

async function seed(configPath: string) {
	await run("node", [SEEDER, configPath]);
}

describe("coding-agent seed-config.mjs", () => {
	let dir: string;
	let configPath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "coding-seed-"));
		configPath = join(dir, "config.json");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("creates a standalone config with agents and the codex runtime", async () => {
		await seed(configPath);
		const config = JSON.parse(await readFile(configPath, "utf8"));
		expect(config.agents.map((a: any) => a.id).sort()).toEqual([
			"standards-corpus",
			"workspace",
		]);
		expect(config.runtimes).toEqual({ codex: true });
	});

	it("declares CLAUDE_CODE_OAUTH_TOKEN so the card advertises the Configure field", async () => {
		await seed(configPath);
		const config = JSON.parse(await readFile(configPath, "utf8"));
		expect(config.requiredSecrets).toHaveLength(1);
		expect(config.requiredSecrets[0]).toMatchObject({
			name: "CLAUDE_CODE_OAUTH_TOKEN",
			required: false,
			type: "secret",
		});
	});

	it("never clobbers an operator-owned requiredSecrets block", async () => {
		await writeFile(
			configPath,
			JSON.stringify({
				agents: [],
				requiredSecrets: [{ name: "MY_KEY", required: true }],
			}),
		);
		await seed(configPath);
		const config = JSON.parse(await readFile(configPath, "utf8"));
		expect(config.requiredSecrets).toEqual([{ name: "MY_KEY", required: true }]);
	});

	it("respects an explicit empty requiredSecrets block", async () => {
		await writeFile(
			configPath,
			JSON.stringify({ agents: [], requiredSecrets: [] }),
		);
		await seed(configPath);
		const config = JSON.parse(await readFile(configPath, "utf8"));
		expect(config.requiredSecrets).toEqual([]);
	});

	it("preserves Gaia-seeded fields and existing agents", async () => {
		await writeFile(
			configPath,
			JSON.stringify({
				name: "My Coder",
				defaultProvider: "google",
				agents: [{ id: "workspace", name: "Custom WS", projectPath: "/data/x" }],
			}),
		);
		await seed(configPath);
		const config = JSON.parse(await readFile(configPath, "utf8"));
		expect(config.name).toBe("My Coder");
		expect(config.defaultProvider).toBe("google");
		// Existing workspace agent untouched; standards-corpus added.
		expect(config.agents.find((a: any) => a.id === "workspace").name).toBe(
			"Custom WS",
		);
		expect(config.agents.some((a: any) => a.id === "standards-corpus")).toBe(true);
		expect(config.runtimes).toEqual({ codex: true });
	});

	it("never clobbers an operator-owned runtimes block", async () => {
		await writeFile(
			configPath,
			JSON.stringify({ agents: [], runtimes: { opencode: { command: "opencode" } } }),
		);
		await seed(configPath);
		const config = JSON.parse(await readFile(configPath, "utf8"));
		expect(config.runtimes).toEqual({ opencode: { command: "opencode" } });
	});

	it("respects an explicit empty runtimes block (codex disabled)", async () => {
		await writeFile(configPath, JSON.stringify({ agents: [], runtimes: {} }));
		await seed(configPath);
		const config = JSON.parse(await readFile(configPath, "utf8"));
		expect(config.runtimes).toEqual({});
	});

	it("is idempotent", async () => {
		await seed(configPath);
		const first = await readFile(configPath, "utf8");
		await seed(configPath);
		expect(await readFile(configPath, "utf8")).toBe(first);
	});
});
