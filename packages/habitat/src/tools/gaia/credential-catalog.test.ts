import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CredentialCatalog } from "./credential-catalog.js";
import type { CredentialEntry } from "./types.js";

function makeEntry(overrides: Partial<CredentialEntry> = {}): CredentialEntry {
	return {
		name: "test-key",
		label: "Test Key",
		provider: "github",
		capabilities: ["github:read"],
		scopes: ["repo:read"],
		status: "unknown",
		...overrides,
	};
}

describe("CredentialCatalog", () => {
	let dataDir: string;
	let catalog: CredentialCatalog;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "credential-catalog-"));
		catalog = new CredentialCatalog(dataDir);
		await catalog.load();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	// ── load / save ────────────────────────────────────────────────────

	it("starts with an empty catalog", () => {
		expect(catalog.list()).toEqual([]);
	});

	it("persists and reloads entries", async () => {
		await catalog.add(makeEntry({ name: "persist-me" }));
		const catalog2 = new CredentialCatalog(dataDir);
		await catalog2.load();
		expect(catalog2.list().length).toBe(1);
		expect(catalog2.get("persist-me")?.name).toBe("persist-me");
	});

	it("creates credentials.json on first save", async () => {
		await catalog.add(makeEntry({ name: "first" }));
		const raw = await readFile(join(dataDir, "credentials.json"), "utf-8");
		const parsed = JSON.parse(raw);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBe(1);
	});

	// ── add ────────────────────────────────────────────────────────────

	it("adds a credential entry", async () => {
		const entry = makeEntry({ name: "my-key", provider: "openrouter" });
		await catalog.add(entry);
		expect(catalog.get("my-key")).toEqual(entry);
	});

	it("rejects duplicate credential names", async () => {
		await catalog.add(makeEntry({ name: "dup" }));
		await expect(catalog.add(makeEntry({ name: "dup" }))).rejects.toThrow(
			'Credential "dup" already exists',
		);
	});

	it("accepts entries with different names", async () => {
		await catalog.add(makeEntry({ name: "alpha" }));
		await catalog.add(makeEntry({ name: "beta" }));
		expect(catalog.list().length).toBe(2);
	});

	// ── remove ─────────────────────────────────────────────────────────

	it("removes a credential by name", async () => {
		await catalog.add(makeEntry({ name: "remove-me" }));
		const result = await catalog.remove("remove-me");
		expect(result).toBe(true);
		expect(catalog.get("remove-me")).toBeUndefined();
	});

	it("returns false when removing non-existent credential", async () => {
		const result = await catalog.remove("nope");
		expect(result).toBe(false);
	});

	// ── get ────────────────────────────────────────────────────────────

	it("gets a credential by name", async () => {
		const entry = makeEntry({ name: "find-me" });
		await catalog.add(entry);
		expect(catalog.get("find-me")).toEqual(entry);
	});

	it("returns undefined for unknown name", () => {
		expect(catalog.get("nobody")).toBeUndefined();
	});

	// ── listByCapability ───────────────────────────────────────────────

	it("lists credentials by capability", async () => {
		await catalog.add(
			makeEntry({ name: "gh-read", capabilities: ["github:read"] }),
		);
		await catalog.add(
			makeEntry({ name: "gh-write", capabilities: ["github:write"] }),
		);
		await catalog.add(
			makeEntry({ name: "qb-read", capabilities: ["quickbooks:read"] }),
		);

		const readers = catalog.listByCapability("github:read");
		expect(readers.length).toBe(1);
		expect(readers[0].name).toBe("gh-read");
	});

	it("returns empty array for unmatched capability", () => {
		expect(catalog.listByCapability("nonexistent")).toEqual([]);
	});

	// ── listByProvider ─────────────────────────────────────────────────

	it("lists credentials by provider", async () => {
		await catalog.add(makeEntry({ name: "gh-key", provider: "github" }));
		await catalog.add(
			makeEntry({ name: "qb-key", provider: "intuit/quickbooks" }),
		);
		await catalog.add(makeEntry({ name: "gh-key2", provider: "github" }));

		const gh = catalog.listByProvider("github");
		expect(gh.length).toBe(2);
		expect(gh.map((e) => e.name).sort()).toEqual(["gh-key", "gh-key2"]);
	});

	it("returns empty array for unknown provider", () => {
		expect(catalog.listByProvider("nonexistent")).toEqual([]);
	});

	// ── verify ─────────────────────────────────────────────────────────

	it("updates lastVerified and status on verify", async () => {
		await catalog.add(makeEntry({ name: "verify-me", status: "unknown" }));
		const before = Date.now();
		const entry = await catalog.verify("verify-me");
		const after = Date.now();

		expect(entry).toBeDefined();
		expect(entry!.status).toBe("active");
		expect(entry!.lastVerified).toBeDefined();
		const ts = new Date(entry!.lastVerified!).getTime();
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after + 1000);
	});

	it("returns undefined when verifying non-existent credential", async () => {
		const result = await catalog.verify("nope");
		expect(result).toBeUndefined();
	});

	it("verify is idempotent — can be called multiple times without error", async () => {
		await catalog.add(makeEntry({ name: "reverify" }));
		await catalog.verify("reverify");
		// Second verify should succeed and keep status active
		const result = await catalog.verify("reverify");
		expect(result!.status).toBe("active");
		expect(result!.lastVerified).toBeDefined();
	});

	// ── Secret value safety ────────────────────────────────────────────

	it("never stores secret values in credentials.json", async () => {
		// The CredentialEntry type has no value field — this is a type-level
		// guarantee. But let's verify the on-disk file doesn't contain stray
		// secret-like data.
		await catalog.add(
			makeEntry({
				name: "safe-key",
				provider: "google",
				capabilities: ["gemini:generate"],
			}),
		);

		const raw = await readFile(join(dataDir, "credentials.json"), "utf-8");
		const parsed = JSON.parse(raw);

		for (const entry of parsed) {
			// No secret value fields should exist
			expect(entry).not.toHaveProperty("value");
			expect(entry).not.toHaveProperty("secret");
			expect(entry).not.toHaveProperty("key");
			expect(entry).not.toHaveProperty("token");
			expect(entry).not.toHaveProperty("apiKey");
		}
	});
});
