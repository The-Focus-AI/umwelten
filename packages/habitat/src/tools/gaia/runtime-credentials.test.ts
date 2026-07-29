import { describe, expect, it } from "vitest";
import {
	describeRuntimeCredential,
	resolveRuntimeCredential,
	type RuntimeCredentialDeps,
} from "./runtime-credentials.js";
import type { GaiaHabitatEntry } from "./types.js";

const ENV = "GOOGLE_GENERATIVE_AI_API_KEY";

function entry(defaultProvider?: string): Pick<GaiaHabitatEntry, "config"> {
	return { config: { defaultProvider } as GaiaHabitatEntry["config"] };
}

function deps(
	envVars: Record<string, string | undefined>,
	secrets: Record<string, string> = {},
): RuntimeCredentialDeps {
	return {
		providerEnvVar: (p) => envVars[p],
		secret: (n) => secrets[n],
	};
}

describe("resolveRuntimeCredential", () => {
	it("resolves the provider's key from the vault", () => {
		const result = resolveRuntimeCredential(
			entry("google"),
			deps({ google: ENV }, { [ENV]: "abc" }),
		);

		expect(result).toEqual({
			ok: true,
			provider: "google",
			credential: { envName: ENV, value: "abc" },
		});
	});

	/**
	 * This is the failure that took several rebuilds to find on the first
	 * client habitat: the container starts, health-checks fine (health does
	 * not call a model), and fails on the first real question.
	 */
	it("reports a provider whose key the vault cannot supply", () => {
		const result = resolveRuntimeCredential(
			entry("google"),
			deps({ google: ENV }, {}),
		);

		expect(result).toEqual({
			ok: false,
			reason: "missing-value",
			provider: "google",
			envName: ENV,
		});
	});

	/** Local providers need no key. A complete answer, not a gap. */
	it("distinguishes a provider that needs no key from one that is missing it", () => {
		const result = resolveRuntimeCredential(
			entry("ollama"),
			deps({ ollama: undefined }),
		);

		expect(result).toEqual({
			ok: false,
			reason: "provider-needs-no-key",
			provider: "ollama",
		});
	});

	it("reports a habitat with no provider at all", () => {
		expect(resolveRuntimeCredential(entry(undefined), deps({}))).toEqual({
			ok: false,
			reason: "no-provider",
		});
	});

	it("treats an empty value as missing, not as a credential", () => {
		const result = resolveRuntimeCredential(
			entry("google"),
			deps({ google: ENV }, { [ENV]: "" }),
		);
		expect(result.ok).toBe(false);
	});

	it("follows the habitat's own provider, not a fixed one", () => {
		const result = resolveRuntimeCredential(
			entry("openrouter"),
			deps(
				{ google: ENV, openrouter: "OPENROUTER_API_KEY" },
				{ OPENROUTER_API_KEY: "or-1", [ENV]: "g-1" },
			),
		);

		expect(result).toMatchObject({
			ok: true,
			credential: { envName: "OPENROUTER_API_KEY", value: "or-1" },
		});
	});
});

describe("describeRuntimeCredential", () => {
	it("never includes the value", () => {
		const text = describeRuntimeCredential(
			resolveRuntimeCredential(
				entry("google"),
				deps({ google: ENV }, { [ENV]: "super-secret" }),
			),
		);
		expect(text).not.toContain("super-secret");
		expect(text).toContain(ENV);
	});

	it("says a missing key is platform config, not the repo's business", () => {
		const text = describeRuntimeCredential(
			resolveRuntimeCredential(entry("google"), deps({ google: ENV }, {})),
		);
		expect(text).toContain("MISSING");
		expect(text).toContain("health-check fine");
		expect(text).toContain("not something the");
		expect(text).toContain("fnox.toml");
	});

	it("is not alarming for a provider that needs no key", () => {
		const text = describeRuntimeCredential(
			resolveRuntimeCredential(entry("ollama"), deps({ ollama: undefined })),
		);
		expect(text).toContain("needs no key");
		expect(text).not.toContain("MISSING");
	});

	it("says plainly when no provider is set", () => {
		const text = describeRuntimeCredential(
			resolveRuntimeCredential(entry(undefined), deps({})),
		);
		expect(text).toContain("cannot answer anything");
	});
});
