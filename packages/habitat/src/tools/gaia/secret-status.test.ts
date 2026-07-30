import { describe, expect, it } from "vitest";
import {
	describeFleetSecretStatus,
	fleetSecretStatus,
	habitatSecretStatus,
	type SecretPresence,
} from "./secret-status.js";
import type { GaiaHabitatEntry } from "./types.js";

function vaultOf(secrets: Record<string, string>): SecretPresence {
	return {
		listNames: () => Object.keys(secrets),
		get: (name) => secrets[name],
	};
}

function entry(
	id: string,
	secretBindings: string[] = [],
): GaiaHabitatEntry {
	return {
		id,
		name: id,
		config: {} as GaiaHabitatEntry["config"],
		secretBindings,
		createdAt: "2026-07-01T00:00:00.000Z",
	} as GaiaHabitatEntry;
}

const KEY = "GOOGLE_GENERATIVE_AI_API_KEY";

describe("habitatSecretStatus", () => {
	it("separates bindings the vault can supply from ones it cannot", () => {
		const status = habitatSecretStatus(
			entry("upperhand", [KEY, "TAVILY_API_KEY"]),
			vaultOf({ [KEY]: "abc" }),
		);

		expect(status.satisfied).toEqual([KEY]);
		expect(status.missing).toEqual(["TAVILY_API_KEY"]);
	});

	/**
	 * The live failure this exists to catch: the habitat bound the key, the
	 * vault did not have it, the seeded secrets.json was empty, the container
	 * booted and health-checked fine, and the first real question failed.
	 */
	it("reports a binding the vault has never heard of", () => {
		const status = habitatSecretStatus(entry("upperhand", [KEY]), vaultOf({}));

		expect(status.satisfied).toEqual([]);
		expect(status.missing).toEqual([KEY]);
	});

	/** An empty string is not a usable credential — treating it as present
	 * would reproduce the same failure one layer down. */
	it("treats an empty value as missing, not satisfied", () => {
		const status = habitatSecretStatus(
			entry("upperhand", [KEY]),
			vaultOf({ [KEY]: "" }),
		);

		expect(status.missing).toEqual([KEY]);
	});

	it("handles a habitat that binds nothing", () => {
		const status = habitatSecretStatus(entry("bare"), vaultOf({ [KEY]: "x" }));
		expect(status).toMatchObject({ satisfied: [], missing: [] });
	});
});

describe("fleetSecretStatus", () => {
	it("flags gaps anywhere in the fleet", () => {
		const status = fleetSecretStatus(
			[entry("a", [KEY]), entry("b", ["MISSING_KEY"])],
			vaultOf({ [KEY]: "x" }),
		);

		expect(status.hasGaps).toBe(true);
		expect(status.habitats.find((h) => h.id === "b")?.missing).toEqual([
			"MISSING_KEY",
		]);
	});

	it("reports no gaps when every binding resolves", () => {
		const status = fleetSecretStatus(
			[entry("a", [KEY]), entry("b", [KEY])],
			vaultOf({ [KEY]: "x" }),
		);
		expect(status.hasGaps).toBe(false);
	});

	it("lists vault secrets no habitat binds", () => {
		const status = fleetSecretStatus(
			[entry("a", [KEY])],
			vaultOf({ [KEY]: "x", ORPHAN: "y" }),
		);
		expect(status.unbound).toEqual(["ORPHAN"]);
	});

	/**
	 * The flat master vault means one value per name for the whole fleet
	 * (ADR 0009 / #283). Two habitats binding the same name is therefore
	 * normal today, and must not read as a conflict.
	 */
	it("does not treat two habitats sharing a secret name as a problem", () => {
		const status = fleetSecretStatus(
			[entry("a", [KEY]), entry("b", [KEY])],
			vaultOf({ [KEY]: "x" }),
		);
		expect(status.unbound).toEqual([]);
		expect(status.hasGaps).toBe(false);
	});

	it("handles an empty fleet", () => {
		const status = fleetSecretStatus([], vaultOf({ [KEY]: "x" }));
		expect(status.habitats).toEqual([]);
		expect(status.unbound).toEqual([KEY]);
	});
});

describe("describeFleetSecretStatus", () => {
	it("leads with the gaps and explains why the container looks healthy", () => {
		const text = describeFleetSecretStatus(
			fleetSecretStatus([entry("upperhand", [KEY])], vaultOf({})),
		);

		expect(text.split("\n")[0]).toContain("MISSING");
		expect(text).toContain("upperhand");
		expect(text).toContain(KEY);
		expect(text).toContain("health-checks fine");
		expect(text).toContain("set_secret");
	});

	it("says nothing alarming when everything resolves", () => {
		const text = describeFleetSecretStatus(
			fleetSecretStatus([entry("upperhand", [KEY])], vaultOf({ [KEY]: "x" })),
		);

		expect(text).not.toContain("MISSING");
		expect(text).toContain(`OK upperhand: ${KEY}`);
	});

	it("is explicit about a habitat with no bindings at all", () => {
		const text = describeFleetSecretStatus(
			fleetSecretStatus([entry("bare")], vaultOf({})),
		);
		expect(text).toContain("(no secrets bound)");
	});

	it("handles an empty fleet", () => {
		expect(
			describeFleetSecretStatus(fleetSecretStatus([], vaultOf({}))),
		).toBe("No habitats registered.");
	});
});
