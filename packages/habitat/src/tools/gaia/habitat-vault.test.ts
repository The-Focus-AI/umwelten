import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	HABITAT_VAULT_FILE,
	resolveHabitatVault,
	unmetBindings,
	VaultResolutionError,
	type VaultAuditEvent,
} from "./habitat-vault.js";

const TOML = '[secrets.DATABASE_URL]\nprovider = "onepass"\n';

describe("resolveHabitatVault", () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "umwl-vault-"));
	});
	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("resolves the habitat's own secrets", async () => {
		const result = await resolveHabitatVault(
			{ id: "upperhand", vaultToml: TOML },
			{
				dataDir,
				exportVault: async () => JSON.stringify({ DATABASE_URL: "postgres://a" }),
			},
		);

		expect(result.secrets).toEqual({ DATABASE_URL: "postgres://a" });
		expect(result.names).toEqual(["DATABASE_URL"]);
	});

	/**
	 * The collision per-habitat vaults exist to remove: a flat namespace whose
	 * keys double as env var names means two habitats can never both see
	 * DATABASE_URL with different values.
	 */
	it("gives two habitats different values for the same name", async () => {
		const values: Record<string, string> = {
			upperhand: "postgres://upperhand",
			trinity: "postgres://trinity",
		};
		const resolve = (id: string) =>
			resolveHabitatVault(
				{ id, vaultToml: TOML },
				{
					dataDir,
					exportVault: async () =>
						JSON.stringify({ DATABASE_URL: values[id] }),
				},
			);

		const [a, b] = await Promise.all([resolve("upperhand"), resolve("trinity")]);

		expect(a.secrets.DATABASE_URL).toBe("postgres://upperhand");
		expect(b.secrets.DATABASE_URL).toBe("postgres://trinity");
	});

	it("passes a profile through so dev and prod can differ", async () => {
		const exportVault = vi.fn().mockResolvedValue(JSON.stringify({ K: "v" }));
		const result = await resolveHabitatVault(
			{ id: "upperhand", vaultToml: TOML, profile: "prod" },
			{ dataDir, exportVault },
		);

		expect(exportVault).toHaveBeenCalledWith(expect.any(String), "prod");
		expect(result.profile).toBe("prod");
	});

	it("writes the declaration where fnox will find it, then cleans up", async () => {
		let seenCwd = "";
		await resolveHabitatVault(
			{ id: "upperhand", vaultToml: TOML },
			{
				dataDir,
				exportVault: async (cwd) => {
					seenCwd = cwd;
					const { readFile } = await import("node:fs/promises");
					const written = await readFile(join(cwd, HABITAT_VAULT_FILE), "utf-8");
					expect(written).toBe(TOML);
					return JSON.stringify({ K: "v" });
				},
			},
		);

		// Removed afterwards: an on-disk copy would be a second source of
		// truth that could drift from the repo.
		const { access } = await import("node:fs/promises");
		await expect(access(join(seenCwd, HABITAT_VAULT_FILE))).rejects.toThrow();
	});

	describe("failures", () => {
		it("throws rather than returning a partial set when fnox fails", async () => {
			await expect(
				resolveHabitatVault(
					{ id: "upperhand", vaultToml: TOML },
					{
						dataDir,
						exportVault: async () => {
							throw new Error("1password: item not found");
						},
					},
				),
			).rejects.toThrow(/item not found/);
		});

		it("throws on output that is not JSON", async () => {
			await expect(
				resolveHabitatVault(
					{ id: "upperhand", vaultToml: TOML },
					{ dataDir, exportVault: async () => "not json" },
				),
			).rejects.toThrow(VaultResolutionError);
		});

		it("throws on JSON that is not an object", async () => {
			await expect(
				resolveHabitatVault(
					{ id: "upperhand", vaultToml: TOML },
					{ dataDir, exportVault: async () => "[1,2]" },
				),
			).rejects.toThrow(/expected an object/);
		});

		/** An empty value is not a credential. */
		it("drops empty values rather than passing them on", async () => {
			const result = await resolveHabitatVault(
				{ id: "upperhand", vaultToml: TOML },
				{
					dataDir,
					exportVault: async () => JSON.stringify({ GOOD: "v", EMPTY: "" }),
				},
			);
			expect(result.names).toEqual(["GOOD"]);
		});
	});

	describe("audit", () => {
		it("records a success with names but never values", async () => {
			const events: VaultAuditEvent[] = [];
			await resolveHabitatVault(
				{ id: "upperhand", vaultToml: TOML },
				{
					dataDir,
					audit: (e) => events.push(e),
					exportVault: async () => JSON.stringify({ DATABASE_URL: "secret-v" }),
				},
			);

			expect(events).toEqual([
				{
					habitatId: "upperhand",
					ok: true,
					names: ["DATABASE_URL"],
					profile: undefined,
				},
			]);
			expect(JSON.stringify(events)).not.toContain("secret-v");
		});

		it("records failures too", async () => {
			const events: VaultAuditEvent[] = [];
			await resolveHabitatVault(
				{ id: "upperhand", vaultToml: TOML },
				{
					dataDir,
					audit: (e) => events.push(e),
					exportVault: async () => {
						throw new Error("vault unreachable");
					},
				},
			).catch(() => {});

			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ ok: false, names: [] });
			expect(events[0].error).toContain("vault unreachable");
		});
	});
});

describe("unmetBindings", () => {
	/**
	 * This is what turns "starts, health-checks green, fails on the first
	 * real question" into "does not start".
	 */
	it("names what the habitat declared that its vault did not supply", () => {
		expect(unmetBindings(["A", "B", "C"], { A: "1", C: "3" })).toEqual(["B"]);
	});

	it("treats an empty value as unmet", () => {
		expect(unmetBindings(["A"], { A: "" })).toEqual(["A"]);
	});

	it("is empty when everything resolves", () => {
		expect(unmetBindings(["A"], { A: "1" })).toEqual([]);
	});

	it("is empty when the habitat declares nothing", () => {
		expect(unmetBindings([], {})).toEqual([]);
	});
});
