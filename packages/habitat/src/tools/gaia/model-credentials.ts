/**
 * The credential a habitat needs to reach a model — supplied by the platform.
 *
 * A habitat declares what *its work* needs: a client API token, a database.
 * The model it thinks with is not that. Every habitat needs one, Gaia chose
 * which provider each habitat runs on, and no client repo has an opinion about
 * it. So Gaia supplies it, the way it already supplies GitHub tokens: minted
 * or read at start, injected as env, never written to the volume, never named
 * in the habitat's own repo (ADR 0004 decision 3 is the same shape).
 *
 * **The mapping is declared, not inferred.** An earlier attempt derived the
 * env var name from core's provider registry, which meant Gaia invented a
 * requirement nobody had written down anywhere — and once invented, it looked
 * indistinguishable from something a habitat had asked for. Here the operator
 * states it once, in Gaia's own config:
 *
 *   {
 *     "name": "Gaia Orchestrator",
 *     "modelCredentials": {
 *       "openrouter": "OPENROUTER_API_KEY",
 *       "google":     "GOOGLE_GENERATIVE_AI_API_KEY"
 *     }
 *   }
 *
 * That is the platform declaring its own infrastructure, in the same place it
 * declares the rest of it. A provider with no entry gets nothing, and that is
 * reported rather than guessed at — an unconfigured fleet should say so, not
 * silently work for the providers someone happened to think of.
 *
 * Values come from Gaia's own vault, because Gaia is the broker (ADR 0009).
 * The habitat's vault holds the habitat's secrets; the model credential is not
 * one of them.
 */

/** Provider name → the env var its key is read from. Declared in Gaia's config. */
export type ModelCredentialMap = Record<string, string>;

export interface ModelCredential {
	envName: string;
	value: string;
}

export type ModelCredentialResult =
	| { ok: true; provider: string; credential: ModelCredential }
	/** The habitat has no provider, so there is nothing to supply for. */
	| { ok: false; reason: "no-provider" }
	/** Gaia's config declares no credential for this provider. */
	| { ok: false; reason: "not-declared"; provider: string }
	/** Declared, but Gaia's vault has no value under that name. */
	| { ok: false; reason: "no-value"; provider: string; envName: string };

export interface ModelCredentialDeps {
	/** From Gaia's own config. Absent or empty ⇒ nothing is supplied to anyone. */
	map?: ModelCredentialMap;
	/** Gaia's own vault. */
	secret(name: string): string | undefined;
}

export function resolveModelCredential(
	provider: string | undefined,
	deps: ModelCredentialDeps,
): ModelCredentialResult {
	if (!provider) return { ok: false, reason: "no-provider" };

	const envName = deps.map?.[provider];
	if (!envName) return { ok: false, reason: "not-declared", provider };

	const value = deps.secret(envName);
	// An empty string is not a credential; letting it through would reproduce
	// the failure downstream, where the message is far less useful.
	if (!value) return { ok: false, reason: "no-value", provider, envName };

	return { ok: true, provider, credential: { envName, value } };
}

/** One line, for a human or an agent. Never contains the value. */
export function describeModelCredential(result: ModelCredentialResult): string {
	if (result.ok) {
		return `Model access: ${result.credential.envName} supplied by Gaia for provider "${result.provider}".`;
	}
	switch (result.reason) {
		case "no-provider":
			return "Model access: this habitat has no provider set, so it cannot answer anything.";
		case "not-declared":
			return (
				`Model access: NOT CONFIGURED. Gaia's config declares no credential for provider ` +
				`"${result.provider}", so nothing is injected and the container will fail on its first ` +
				`model call. Add it to "modelCredentials" in Gaia's own config.json — this is platform ` +
				`config, not something the habitat's repo declares.`
			);
		case "no-value":
			return (
				`Model access: NOT AVAILABLE. Gaia's config maps provider "${result.provider}" to ` +
				`${result.envName}, but Gaia's vault has no value under that name. Add it to Gaia's ` +
				`fnox.toml, or set it in the master vault.`
			);
	}
}
