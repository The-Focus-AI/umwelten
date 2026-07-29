import { describe, expect, it } from "vitest";
import {
	describeModelCredential,
	resolveModelCredential,
} from "./model-credentials.js";

const MAP = {
	openrouter: "OPENROUTER_API_KEY",
	google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

const deps = (secrets: Record<string, string> = {}, map = MAP) => ({
	map,
	secret: (n: string) => secrets[n],
});

describe("resolveModelCredential", () => {
	it("supplies the credential Gaia's config maps for that provider", () => {
		const r = resolveModelCredential(
			"openrouter",
			deps({ OPENROUTER_API_KEY: "sk-or-1" }),
		);

		expect(r).toEqual({
			ok: true,
			provider: "openrouter",
			credential: { envName: "OPENROUTER_API_KEY", value: "sk-or-1" },
		});
	});

	it("follows the habitat's provider, not a fixed one", () => {
		const r = resolveModelCredential(
			"google",
			deps({ GOOGLE_GENERATIVE_AI_API_KEY: "g-1", OPENROUTER_API_KEY: "or-1" }),
		);
		expect(r).toMatchObject({
			credential: { envName: "GOOGLE_GENERATIVE_AI_API_KEY", value: "g-1" },
		});
	});

	/**
	 * The whole reason this is a declared map rather than a lookup against
	 * core's provider registry: deriving it means Gaia inventing a requirement
	 * nobody wrote down, and an invented requirement is indistinguishable from
	 * one a habitat asked for.
	 */
	it("supplies nothing for a provider the operator has not declared", () => {
		const r = resolveModelCredential("deepinfra", deps({ DEEPINFRA_API_KEY: "d-1" }));

		expect(r).toEqual({ ok: false, reason: "not-declared", provider: "deepinfra" });
	});

	it("supplies nothing when no map is configured at all", () => {
		const r = resolveModelCredential("openrouter", {
			secret: () => "value",
		});
		expect(r).toMatchObject({ ok: false, reason: "not-declared" });
	});

	it("distinguishes declared-but-absent from not declared", () => {
		const r = resolveModelCredential("openrouter", deps({}));
		expect(r).toEqual({
			ok: false,
			reason: "no-value",
			provider: "openrouter",
			envName: "OPENROUTER_API_KEY",
		});
	});

	it("treats an empty value as absent", () => {
		const r = resolveModelCredential("openrouter", deps({ OPENROUTER_API_KEY: "" }));
		expect(r).toMatchObject({ ok: false, reason: "no-value" });
	});

	it("reports a habitat with no provider rather than guessing one", () => {
		expect(resolveModelCredential(undefined, deps())).toEqual({
			ok: false,
			reason: "no-provider",
		});
	});
});

describe("describeModelCredential", () => {
	it("never prints the value", () => {
		const text = describeModelCredential(
			resolveModelCredential("openrouter", deps({ OPENROUTER_API_KEY: "sk-secret" })),
		);
		expect(text).not.toContain("sk-secret");
		expect(text).toContain("OPENROUTER_API_KEY");
		expect(text).toContain("supplied by Gaia");
	});

	/** Each gap needs a different fix, so each must say which one it is. */
	it("points an undeclared provider at Gaia's config", () => {
		const text = describeModelCredential(
			resolveModelCredential("deepinfra", deps()),
		);
		expect(text).toContain("NOT CONFIGURED");
		expect(text).toContain("modelCredentials");
		expect(text).toContain("not something the habitat's repo declares");
	});

	it("points a declared-but-missing value at Gaia's vault", () => {
		const text = describeModelCredential(
			resolveModelCredential("openrouter", deps({})),
		);
		expect(text).toContain("NOT AVAILABLE");
		expect(text).toContain("fnox.toml");
	});

	it("says plainly when the habitat has no provider", () => {
		const text = describeModelCredential(resolveModelCredential(undefined, deps()));
		expect(text).toContain("cannot answer anything");
	});
});
