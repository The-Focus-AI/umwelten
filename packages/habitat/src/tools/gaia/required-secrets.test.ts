import { describe, expect, it } from "vitest";
import {
	describeSecretNeeds,
	isSelfMinted,
	secretNeeds,
	unmetNeeds,
} from "./required-secrets.js";
import type { HabitatConfig, RequiredSecret } from "../../types.js";

const cfg = (requiredSecrets?: RequiredSecret[]): Pick<HabitatConfig, "requiredSecrets"> =>
	requiredSecrets === undefined ? {} : { requiredSecrets };

const secret = (name: string, required = true): RequiredSecret =>
	({ name, required, type: "secret" }) as RequiredSecret;
const oauth = (name: string): RequiredSecret =>
	({ name, required: true, type: "oauth", connectPath: "/connect/x" }) as RequiredSecret;

describe("secretNeeds", () => {
	it("reads the habitat's own declaration when it has one", () => {
		const needs = secretNeeds(cfg([secret("DATABASE_URL")]), ["IGNORED"]);

		expect(needs.source).toBe("contract");
		expect(needs.fromVault).toEqual(["DATABASE_URL"]);
		// The hand-maintained list is not consulted once a contract exists.
		expect(needs.fromVault).not.toContain("IGNORED");
	});

	/**
	 * The distinction a bare name list cannot make. An OAuth credential is
	 * minted by the habitat at its connectPath when a user authorizes; it
	 * never enters a vault, so Gaia must supply nothing and check nothing.
	 */
	it("separates what Gaia supplies from what the habitat mints itself", () => {
		const needs = secretNeeds(
			cfg([secret("TWITTER_CLIENT_ID"), oauth("TWITTER_REFRESH_TOKEN")]),
		);

		expect(needs.fromVault).toEqual(["TWITTER_CLIENT_ID"]);
		expect(needs.selfMinted).toEqual(["TWITTER_REFRESH_TOKEN"]);
	});

	it("falls back to secretBindings for a habitat that has not migrated", () => {
		const needs = secretNeeds(cfg(undefined), ["A", "B"]);

		expect(needs.source).toBe("bindings");
		expect(needs.fromVault).toEqual(["A", "B"]);
	});

	/**
	 * "Declared nothing" and "declared nothing yet" must not look alike —
	 * otherwise an explicit empty contract silently reverts to the old list.
	 */
	it("takes an explicitly empty contract at its word", () => {
		const needs = secretNeeds(cfg([]), ["LEFTOVER"]);

		expect(needs.source).toBe("contract");
		expect(needs.fromVault).toEqual([]);
	});

	it("treats a declaration with no type as an operator secret", () => {
		const needs = secretNeeds(cfg([{ name: "K", required: true } as RequiredSecret]));
		expect(needs.fromVault).toEqual(["K"]);
	});
});

describe("isSelfMinted", () => {
	it("is true only for oauth", () => {
		expect(isSelfMinted(oauth("A"))).toBe(true);
		expect(isSelfMinted(secret("A"))).toBe(false);
		expect(isSelfMinted({ name: "A", required: true } as RequiredSecret)).toBe(false);
	});
});

describe("unmetNeeds", () => {
	it("names what the vault did not supply", () => {
		const needs = secretNeeds(cfg([secret("A"), secret("B")]));
		expect(unmetNeeds(needs, { A: "1" }).missing).toEqual(["B"]);
	});

	/**
	 * The bug this prevents: a habitat with connected users refusing to start
	 * because a token no vault was ever meant to hold looks "missing".
	 */
	it("never counts a self-minted credential as missing", () => {
		const needs = secretNeeds(cfg([secret("ID"), oauth("REFRESH")]));
		const { missing, missingRequired } = unmetNeeds(needs, { ID: "1" });

		expect(missing).toEqual([]);
		expect(missingRequired).toEqual([]);
	});

	it("does not block a start on an optional declaration", () => {
		const needs = secretNeeds(cfg([secret("A"), secret("OPTIONAL", false)]));
		const { missing, missingRequired } = unmetNeeds(needs, { A: "1" });

		expect(missing).toEqual(["OPTIONAL"]);
		expect(missingRequired).toEqual([]);
	});

	it("blocks on a required declaration the vault cannot supply", () => {
		const needs = secretNeeds(cfg([secret("A")]));
		expect(unmetNeeds(needs, {}).missingRequired).toEqual(["A"]);
	});

	/** A bare list carries no required/optional flag, so all of it is required. */
	it("treats every fallback binding as required", () => {
		const needs = secretNeeds(cfg(undefined), ["A"]);
		expect(unmetNeeds(needs, {}).missingRequired).toEqual(["A"]);
	});

	it("treats an empty value as unmet", () => {
		const needs = secretNeeds(cfg([secret("A")]));
		expect(unmetNeeds(needs, { A: "" }).missingRequired).toEqual(["A"]);
	});
});

describe("describeSecretNeeds", () => {
	it("says plainly when a habitat has not migrated to a contract", () => {
		const text = describeSecretNeeds("waffle", secretNeeds(cfg(undefined), ["A"]));
		expect(text).toContain("no declared contract");
		expect(text).toContain("requiredSecrets");
	});

	it("marks what the vault cannot supply", () => {
		const text = describeSecretNeeds(
			"upperhand",
			secretNeeds(cfg([secret("A"), secret("B")])),
			{ A: "1" },
		);
		expect(text).toContain("A  ok");
		expect(text).toContain("B  MISSING");
	});

	it("lists self-minted credentials apart, with Gaia's role stated", () => {
		const text = describeSecretNeeds("twitter", secretNeeds(cfg([oauth("REFRESH")])));
		expect(text).toContain("minted by the habitat");
		expect(text).toContain("Gaia supplies nothing");
	});

	it("never prints a value", () => {
		const text = describeSecretNeeds(
			"upperhand",
			secretNeeds(cfg([secret("A")])),
			{ A: "super-secret-value" },
		);
		expect(text).not.toContain("super-secret-value");
	});

	it("handles a habitat that declares nothing", () => {
		expect(describeSecretNeeds("bare", secretNeeds(cfg([])))).toContain(
			"declares no secrets",
		);
	});
});

/**
 * The failure this file's contract-wins rule introduced, and the guard for it.
 *
 * `requiredSecrets: []` means "I need nothing", so nothing is seeded — correct.
 * But `bind_secret` still appended to `secretBindings` and reported success,
 * so an operator could bind a key, be told it worked, rebuild, and watch the
 * container fail on a missing env var. Found live on the upperhand habitat.
 *
 * A write with no effect must not report success. These assert the condition
 * `bind_secret` checks.
 */
describe("a contract makes secretBindings inert", () => {
	it("ignores a bound name the contract does not declare", () => {
		const needs = secretNeeds(cfg([]), ["OPENROUTER_API_KEY"]);

		expect(needs.source).toBe("contract");
		expect(needs.fromVault).toEqual([]);
		// So nothing is seeded, and binding it changed nothing.
		expect(needs.fromVault).not.toContain("OPENROUTER_API_KEY");
	});

	it("still honours bindings for a habitat with no contract", () => {
		const needs = secretNeeds(cfg(undefined), ["OPENROUTER_API_KEY"]);

		expect(needs.source).toBe("bindings");
		expect(needs.fromVault).toEqual(["OPENROUTER_API_KEY"]);
	});

	it("uses the contract's own name when it declares one", () => {
		const needs = secretNeeds(cfg([secret("OPENROUTER_API_KEY")]), []);
		expect(needs.fromVault).toEqual(["OPENROUTER_API_KEY"]);
	});
});
