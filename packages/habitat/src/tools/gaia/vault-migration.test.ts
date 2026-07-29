import { describe, expect, it } from "vitest";
import {
	describeVaultMigration,
	planVaultMigration,
	renderHabitatFnoxToml,
} from "./vault-migration.js";
import { mergeSecretsJson } from "./docker.js";
import { unmetBindings } from "./habitat-vault.js";

const master = new Set(["TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET"]);
const plan = (overrides: Partial<Parameters<typeof planVaultMigration>[0]> = {}) =>
	planVaultMigration({
		habitatId: "twitter",
		secretBindings: ["TWITTER_CLIENT_ID", "TWITTER_CLIENT_SECRET"],
		hasOwnVault: false,
		masterHas: (n) => master.has(n),
		...overrides,
	});

describe("planVaultMigration", () => {
	it("carries every declared binding into the habitat's own vault", () => {
		expect(plan().bindings.map((b) => b.name)).toEqual([
			"TWITTER_CLIENT_ID",
			"TWITTER_CLIENT_SECRET",
		]);
	});

	it("defaults the vault name to the habitat id, per the vault-per-project convention", () => {
		expect(plan().vaultName).toBe("twitter");
		expect(plan({ vaultName: "Twitter Prod" }).vaultName).toBe("Twitter Prod");
	});

	/**
	 * Migration does not cause this — it reveals it. Worth surfacing at the
	 * moment someone is looking, because afterwards the habitat refuses to
	 * start rather than starting without the value.
	 */
	it("flags bindings the master vault cannot satisfy today", () => {
		const p = plan({ secretBindings: ["TWITTER_CLIENT_ID", "MISSING_KEY"] });
		expect(p.unsatisfied).toEqual(["MISSING_KEY"]);
		expect(describeVaultMigration(p)).toContain("already misconfigured");
	});

	it("says there is nothing to do for a habitat that already has its own vault", () => {
		const text = describeVaultMigration(plan({ hasOwnVault: true }));
		expect(text).toContain("nothing to migrate");
	});

	it("handles a habitat that declares no secrets", () => {
		const text = describeVaultMigration(plan({ secretBindings: [] }));
		expect(text).toContain("nothing to migrate");
	});

	/** References, never values — so a plan is safe to review, commit and diff. */
	it("emits references rather than secret values", () => {
		const text = describeVaultMigration(plan());
		expect(text).toContain('value = "TWITTER_CLIENT_ID"');
		expect(text).not.toMatch(/[a-f0-9]{32}/);
	});

	it("tells you how to revert", () => {
		expect(describeVaultMigration(plan())).toContain("To revert");
	});
});

describe("renderHabitatFnoxToml", () => {
	it("errors on a missing secret rather than resolving a partial set", () => {
		expect(renderHabitatFnoxToml("twitter", "twitter", ["A"])).toContain(
			'if_missing = "error"',
		);
	});

	it("declares one entry per binding against the habitat's vault", () => {
		const toml = renderHabitatFnoxToml("twitter", "Twitter", ["A", "B"]);
		expect(toml).toContain('vault = "Twitter"');
		expect(toml).toContain("[secrets.A]");
		expect(toml).toContain("[secrets.B]");
	});
});

/**
 * The Twitter habitat is the meaningful migration because it exercises all
 * three credential tiers at once: operator keys from a vault, its own OAuth
 * minting a per-user token at its connect path, and a refresh token it
 * rotates and persists itself.
 *
 * The per-user tier must be untouched by migration. It is habitat-owned state
 * living in the same secrets.json the operator seeds, so the thing that has to
 * hold is the seed *merge* — and it has to hold identically whether the seeded
 * values came from the master vault or from the habitat's own.
 */
describe("the per-user OAuth tier survives migration", () => {
	const perUser = {
		"TWITTER_REFRESH_TOKEN:user-abc": "rotated-by-the-habitat",
		"TWITTER_REFRESH_TOKEN:user-xyz": "also-rotated",
	};

	const seedFrom = (values: Record<string, string>) =>
		JSON.stringify(values, null, 2) + "\n";

	it("keeps per-user tokens when re-seeded from the master vault", () => {
		const existing = JSON.stringify({
			TWITTER_CLIENT_ID: "old",
			...perUser,
		});
		const merged = JSON.parse(
			mergeSecretsJson(existing, seedFrom({ TWITTER_CLIENT_ID: "from-master" })),
		);

		expect(merged).toMatchObject(perUser);
		expect(merged.TWITTER_CLIENT_ID).toBe("from-master");
	});

	it("keeps them identically when re-seeded from the habitat's own vault", () => {
		const existing = JSON.stringify({
			TWITTER_CLIENT_ID: "from-master",
			...perUser,
		});
		const merged = JSON.parse(
			mergeSecretsJson(existing, seedFrom({ TWITTER_CLIENT_ID: "from-own-vault" })),
		);

		// The operator key moved vaults; everything the habitat owns is untouched.
		expect(merged).toMatchObject(perUser);
		expect(merged.TWITTER_CLIENT_ID).toBe("from-own-vault");
	});

	it("survives a migration and a revert in sequence", () => {
		let state = JSON.stringify({ TWITTER_CLIENT_ID: "master", ...perUser });
		// migrate
		state = mergeSecretsJson(state, seedFrom({ TWITTER_CLIENT_ID: "own" }));
		// revert
		state = mergeSecretsJson(state, seedFrom({ TWITTER_CLIENT_ID: "master" }));

		const merged = JSON.parse(state);
		expect(merged).toMatchObject(perUser);
		expect(merged.TWITTER_CLIENT_ID).toBe("master");
	});

	/**
	 * Per-user keys are habitat-owned and never declared, so they must not be
	 * counted against the vault — otherwise migrating a habitat with connected
	 * users would refuse to start on tokens the vault was never meant to hold.
	 */
	it("does not treat per-user tokens as unmet declared bindings", () => {
		expect(
			unmetBindings(["TWITTER_CLIENT_ID"], { TWITTER_CLIENT_ID: "v" }),
		).toEqual([]);
	});
});
