import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GaiaRegistryManager } from "./registry.js";

let dir: string;
let registry: GaiaRegistryManager;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "umwelten-registry-mounts-"));
	registry = new GaiaRegistryManager(dir);
	await registry.load();
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const OWNED = "https://github.com/The-Focus-AI/client-upperhand.git";
const API = "https://github.com/The-Focus-AI/uh-api.git";
const WEB = "https://github.com/The-Focus-AI/uh-web.git";

describe("creating a habitat with mounts", () => {
	it("stands one up in a single call", async () => {
		const entry = await registry.create({
			id: "upperhand",
			name: "UpperHand",
			gitUrl: OWNED,
			mounts: [{ gitRemote: API }, { gitRemote: WEB }],
		});

		expect(entry.config.gitUrl).toBe(OWNED);
		expect(entry.config.agents.map((a) => a.id)).toEqual(["uh-api", "uh-web"]);
	});

	it("derives the read scope from the Owned repo plus the mounts", async () => {
		const entry = await registry.create({
			id: "upperhand",
			name: "UpperHand",
			gitUrl: OWNED,
			mounts: [{ gitRemote: API }],
		});
		// No separate grant call — this is the drift ADR 0006 removes.
		expect(entry.github?.read).toEqual(["client-upperhand", "uh-api"]);
	});

	it("never derives a write scope, however many repos are mounted", async () => {
		const entry = await registry.create({
			id: "upperhand",
			name: "UpperHand",
			gitUrl: OWNED,
			mounts: [{ gitRemote: API }, { gitRemote: WEB }],
		});
		expect(entry.github?.write).toBeUndefined();
	});

	it("keeps an explicitly declared write scope untouched", async () => {
		const entry = await registry.create({
			id: "upperhand",
			name: "UpperHand",
			gitUrl: OWNED,
			mounts: [{ gitRemote: API }],
			github: { write: ["client-upperhand"] },
		});
		expect(entry.github?.write).toEqual(["client-upperhand"]);
	});

	it("keeps a declared read repo the habitat does not mount", async () => {
		const entry = await registry.create({
			id: "upperhand",
			name: "UpperHand",
			gitUrl: OWNED,
			mounts: [{ gitRemote: API }],
			github: { read: ["standards"] },
		});
		expect(entry.github?.read).toContain("standards");
		expect(entry.github?.read).toContain("uh-api");
	});

	it("marks every mount read-only", async () => {
		const entry = await registry.create({
			id: "upperhand",
			name: "UpperHand",
			mounts: [{ gitRemote: API }],
		});
		expect(entry.config.agents[0]).toMatchObject({ mode: "read", kind: "repo" });
	});

	it("creates a habitat with no mounts exactly as before", async () => {
		const entry = await registry.create({ id: "plain", name: "Plain" });
		expect(entry.config.agents).toEqual([]);
	});

	/** A half-registered habitat is worse than a rejected create call. */
	it("registers nothing when the mount declaration is bad", async () => {
		await expect(
			registry.create({
				id: "broken",
				name: "Broken",
				mounts: [{ gitRemote: "wat" }],
			}),
		).rejects.toThrow();

		expect(registry.get("broken")).toBeUndefined();
		expect(registry.list()).toHaveLength(0);
	});

	it("persists mounts across a reload", async () => {
		await registry.create({
			id: "upperhand",
			name: "UpperHand",
			gitUrl: OWNED,
			mounts: [{ gitRemote: API }],
		});

		const reloaded = new GaiaRegistryManager(dir);
		await reloaded.load();
		expect(reloaded.get("upperhand")?.config.agents.map((a) => a.id)).toEqual([
			"uh-api",
		]);
	});
});

describe("changing mounts on an existing habitat", () => {
	beforeEach(async () => {
		await registry.create({
			id: "upperhand",
			name: "UpperHand",
			gitUrl: OWNED,
			mounts: [{ gitRemote: API }],
		});
	});

	it("widens the read scope when a mount is added", async () => {
		const entry = await registry.setMounts("upperhand", [
			{ gitRemote: API },
			{ gitRemote: WEB },
		]);
		expect(entry.github?.read).toEqual(
			expect.arrayContaining(["client-upperhand", "uh-api", "uh-web"]),
		);
	});

	it("narrows the read scope when a mount is removed", async () => {
		const entry = await registry.setMounts("upperhand", []);
		expect(entry.github?.read).not.toContain("uh-api");
		// The Owned repo is still readable — it did not go anywhere.
		expect(entry.github?.read).toContain("client-upperhand");
	});

	it("keeps a separately declared read repo through a mount change", async () => {
		await registry.update("upperhand", {
			github: { read: ["client-upperhand", "uh-api", "standards"] },
		});
		const entry = await registry.setMounts("upperhand", []);
		expect(entry.github?.read).toContain("standards");
	});

	it("leaves non-repo agents alone", async () => {
		const existing = registry.get("upperhand")!;
		await registry.update("upperhand", {
			config: {
				...existing.config,
				agents: [
					...existing.config.agents,
					{ id: "gaia", name: "Gaia", projectPath: "agents/gaia", kind: "remote-habitat" },
				],
			},
		});

		const entry = await registry.setMounts("upperhand", [{ gitRemote: WEB }]);
		expect(entry.config.agents.map((a) => a.id).sort()).toEqual(["gaia", "uh-web"]);
	});

	it("refuses for a habitat that does not exist", async () => {
		await expect(registry.setMounts("nope", [])).rejects.toThrow(/not found/);
	});
});
