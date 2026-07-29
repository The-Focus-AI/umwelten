/**
 * The credential a habitat needs to *exist*, as opposed to the ones it
 * declares because of what it does.
 *
 * A habitat's `secretBindings` are its declared needs: Tavily because it
 * searches, a client's API token because it calls that client. Those belong in
 * `habitat.json` — the repo is the right place to say what its work requires.
 *
 * The model credential is not that. Every habitat needs one to think at all,
 * and which model it happens to be is fleet policy. Putting it in
 * `secretBindings` made `GOOGLE_GENERATIVE_AI_API_KEY` look like an UpperHand
 * requirement, which is what made the first client declaration read as
 * nonsense: the client repo does not care which model reads it.
 *
 * GitHub already solved this. `GITHUB_TOKEN` is never declared and never in
 * the vault's binding list — Gaia mints it per start, scoped to what that
 * habitat is allowed, and injects it as part of starting a container
 * (ADR 0004). The repo declares *mounts*; the platform derives the
 * credential. The model credential takes the same path.
 *
 * The practical payoff is that `secret_status` becomes meaningful: everything
 * left in it is a real declared need, so an unsatisfied one is genuinely that
 * habitat's problem rather than platform noise. And when the Exchange lands
 * (#301) only the resolution below changes — a habitat gets a per-habitat
 * service token instead of a shared provider key, and no declaration mentions
 * either.
 */

import type { GaiaHabitatEntry } from "./types.js";

/** What gets injected into the container at start. */
export interface RuntimeCredential {
	/** Env var name the provider reads, e.g. GOOGLE_GENERATIVE_AI_API_KEY. */
	envName: string;
	value: string;
}

/** Why there is no credential to inject — each needs a different fix. */
export type RuntimeCredentialGap =
	| { reason: "no-provider" }
	| { reason: "provider-needs-no-key"; provider: string }
	| { reason: "missing-value"; provider: string; envName: string };

export type RuntimeCredentialResult =
	| { ok: true; credential: RuntimeCredential; provider: string }
	| ({ ok: false } & RuntimeCredentialGap);

export interface RuntimeCredentialDeps {
	/** Provider name → the env var its key lives in (core provider registry). */
	providerEnvVar(provider: string): string | undefined;
	/** Master-vault lookup. */
	secret(name: string): string | undefined;
}

/**
 * Work out the model credential for a habitat, without injecting it.
 *
 * Separated from the injection so it can be reported before a container is
 * started — the whole reason the first client habitat failed was that this
 * was only discoverable by asking it a question.
 */
export function resolveRuntimeCredential(
	entry: Pick<GaiaHabitatEntry, "config">,
	deps: RuntimeCredentialDeps,
): RuntimeCredentialResult {
	const provider = entry.config?.defaultProvider;
	if (!provider) return { ok: false, reason: "no-provider" };

	const envName = deps.providerEnvVar(provider);
	// Local providers — ollama, lmstudio, llamabarn, llama-swap — register no
	// env var because they need no key. That is a complete answer, not a gap.
	if (!envName) return { ok: false, reason: "provider-needs-no-key", provider };

	const value = deps.secret(envName);
	if (!value) return { ok: false, reason: "missing-value", provider, envName };

	return { ok: true, provider, credential: { envName, value } };
}

/** One line for a human or an agent. Never includes the value. */
export function describeRuntimeCredential(
	result: RuntimeCredentialResult,
): string {
	if (result.ok) {
		return `Model credential: ${result.credential.envName} supplied by the platform for provider "${result.provider}".`;
	}
	switch (result.reason) {
		case "no-provider":
			return "Model credential: no provider set — this habitat cannot answer anything. Set one, or let it inherit Gaia's.";
		case "provider-needs-no-key":
			return `Model credential: provider "${result.provider}" needs no key.`;
		case "missing-value":
			return (
				`Model credential: MISSING. Provider "${result.provider}" needs ${result.envName}, ` +
				`which is not in the master vault. The container will start and health-check fine, ` +
				`then fail on its first question. This is platform config, not something the ` +
				`habitat's repo declares — add it to Gaia's fnox.toml (preferred, survives a ` +
				`rebuild) or via set_secret.`
			);
	}
}
