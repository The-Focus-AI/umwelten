import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GaiaRegistryManager } from "./registry.js";
import { applyHabitatDeclaration } from "./apply-declaration.js";
import { HabitatDeclarationError } from "./declaration.js";

let dir: string;
let registry: GaiaRegistryManager;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "umwelten-apply-decl-"));
	registry = new GaiaRegistryManager(dir);
	await registry.load();
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const OWNED = "https://github.com/The-Focus-AI/client-upperhand.git";
const API = "https://github.com/The-Focus-AI/uh-api.git";
const WEB = "https://github.com/The-Focus-AI/uh-web.git";

/** Stands in for cloning the Owned repo and reading habitat.json from it. */
const reads = (declaration: unknown) =>
	vi.fn().mockResolvedValue(
		declaration === undefined ? undefined : JSON.stringify(declaration),
	);

const apply = (readDeclaration: any, id = "upperhand") =>
	applyHabitatDeclaration(registry, { id, gitUrl: OWNED, readDeclaration });

describe("applying a declaration", () => {
	it("creates a habitat that did not exist", async () => {
		const result = await apply(reads({ name: "UpperHand", mounts: [{ gitRemote: API }] }));

		expect(result.action).toBe("created");
		expect(result.entry.config.gitUrl).toBe(OWNED);
		expect(result.entry.config.agents.map((a) => a.id)).toEqual(["uh-api"]);
	});

	it("derives the read scope from the declaration", async () => {
		const result = await apply(reads({ mounts: [{ gitRemote: API }] }));
		expect(result.entry.github?.read).toEqual(["client-upperhand", "uh-api"]);
	});

	it("takes write scope only from the declaration", async () => {
		const result = await apply(
			reads({ mounts: [{ gitRemote: API }], github: { write: ["client-upperhand"] } }),
		);
		expect(result.entry.github?.write).toEqual(["client-upperhand"]);
	});

	it("clones the Owned repo to find the declaration", async () => {
		const readDeclaration = reads({ name: "UpperHand" });
		await apply(readDeclaration);
		// Under ambient read — the narrowed scope cannot be known until the
		// declaration is in hand.
		expect(readDeclaration).toHaveBeenCalledWith(OWNED, undefined);
	});
});

describe("re-applying a changed declaration", () => {
	beforeEach(async () => {
		await apply(reads({ name: "UpperHand", mounts: [{ gitRemote: API }] }));
	});

	it("updates rather than duplicating", async () => {
		const result = await apply(reads({ name: "UpperHand", mounts: [{ gitRemote: API }] }));
		expect(result.action).toBe("updated");
		expect(registry.list()).toHaveLength(1);
	});

	it("is idempotent — the same declaration twice leaves the same entry", async () => {
		const first = registry.get("upperhand")!;
		await apply(reads({ name: "UpperHand", mounts: [{ gitRemote: API }] }));
		const second = registry.get("upperhand")!;

		expect(second.config.agents).toEqual(first.config.agents);
		expect(second.github).toEqual(first.github);
	});

	it("widens the scope when a mount is added in the repo", async () => {
		const result = await apply(
			reads({ mounts: [{ gitRemote: API }, { gitRemote: WEB }] }),
		);
		expect(result.entry.github?.read).toEqual(
			expect.arrayContaining(["client-upperhand", "uh-api", "uh-web"]),
		);
	});

	it("narrows the scope when a mount is removed from the repo", async () => {
		const result = await apply(reads({ mounts: [] }));
		expect(result.entry.github?.read).not.toContain("uh-api");
		expect(result.entry.github?.read).toContain("client-upperhand");
	});

	it("picks up a model change", async () => {
		const result = await apply(
			reads({ provider: "google", model: "gemini-3-flash-preview" }),
		);
		expect(result.entry.config.defaultModel).toBe("gemini-3-flash-preview");
	});

	/**
	 * An apply is a config change, not a restart. Clobbering the port or key
	 * would take a running container down for no reason.
	 */
	it("leaves runtime facts alone", async () => {
		await registry.update("upperhand", { containerPort: 7440 });
		const before = registry.get("upperhand")!;

		const result = await apply(reads({ mounts: [{ gitRemote: WEB }] }));

		expect(result.entry.containerPort).toBe(7440);
		expect(result.entry.apiKey).toBe(before.apiKey);
		expect(result.entry.createdAt).toBe(before.createdAt);
	});

	it("keeps agents the declaration does not describe", async () => {
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

		const result = await apply(reads({ mounts: [{ gitRemote: WEB }] }));
		// Remote peers are wired by another path and are not this file's to delete.
		expect(result.entry.config.agents.map((a) => a.id).sort()).toEqual([
			"gaia",
			"uh-web",
		]);
	});
});

describe("a declaration that cannot be applied", () => {
	it("refuses a repo with no declaration rather than defaulting one", async () => {
		await expect(apply(reads(undefined))).rejects.toThrow(HabitatDeclarationError);
		expect(registry.list()).toHaveLength(0);
	});

	it("names the file and the repo so the fix is obvious", async () => {
		await expect(apply(reads(undefined))).rejects.toThrow(
			/habitat\.json.*client-upperhand/s,
		);
	});

	it("registers nothing when the declaration is malformed", async () => {
		const readDeclaration = vi.fn().mockResolvedValue("{ not json");
		await expect(apply(readDeclaration)).rejects.toThrow(HabitatDeclarationError);
		expect(registry.list()).toHaveLength(0);
	});

	it("leaves an existing habitat untouched when a re-apply is malformed", async () => {
		await apply(reads({ name: "UpperHand", mounts: [{ gitRemote: API }] }));
		const before = registry.get("upperhand")!;

		await expect(apply(vi.fn().mockResolvedValue("{ bad"))).rejects.toThrow();

		const after = registry.get("upperhand")!;
		expect(after.config.agents).toEqual(before.config.agents);
		expect(after.github).toEqual(before.github);
	});

	it("surfaces a clone failure rather than swallowing it", async () => {
		const readDeclaration = vi.fn().mockRejectedValue(new Error("auth required"));
		await expect(apply(readDeclaration)).rejects.toThrow(/auth required/);
	});
});
