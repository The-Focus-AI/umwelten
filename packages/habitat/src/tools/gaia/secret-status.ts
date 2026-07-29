/**
 * Who needs which secret, and can the vault actually supply it.
 *
 * Gaia already tracks which habitat gets which secret — that is what
 * `entry.secretBindings` is, and `buildSeedFiles` writes only the bound names
 * into a habitat's volume. What was missing is any way to see whether a
 * binding can be *satisfied*.
 *
 * `buildSeedFiles` drops a bound name the vault has no value for, silently and
 * by design — there is nothing to write. The cost of that silence, found while
 * standing up the first client habitat: a habitat bound
 * `GOOGLE_GENERATIVE_AI_API_KEY`, the vault did not have it, the volume was
 * seeded with an empty secrets file, the container booted, and the health check
 * passed — because health does not call a model. The first real question failed
 * with `GOOGLE_GENERATIVE_AI_API_KEY environment variable is required`, three
 * rebuilds away from the cause.
 *
 * A missing binding is knowable before the container starts. This makes it
 * knowable, and the check is deliberately pure so it can run at bind time, at
 * start time, and on demand without a Docker daemon anywhere near it.
 */

import type { GaiaHabitatEntry } from "./types.js";

/** The vault surface this needs — names and presence, never values. */
export interface SecretPresence {
	listNames(): string[];
	get(name: string): string | undefined;
}

export interface HabitatSecretStatus {
	id: string;
	name: string;
	/** Bound names the vault can supply. */
	satisfied: string[];
	/**
	 * Bound names the vault has no value for. These are silently absent from
	 * the container's secrets.json, so the habitat starts and then fails on
	 * first use of whatever needed them.
	 */
	missing: string[];
}

export interface FleetSecretStatus {
	habitats: HabitatSecretStatus[];
	/** Vault secrets no habitat binds. Not a problem — but worth seeing. */
	unbound: string[];
	/** True when at least one habitat has an unsatisfiable binding. */
	hasGaps: boolean;
}

export function habitatSecretStatus(
	entry: GaiaHabitatEntry,
	vault: SecretPresence,
): HabitatSecretStatus {
	const satisfied: string[] = [];
	const missing: string[] = [];
	for (const name of entry.secretBindings ?? []) {
		// An empty string is not a usable credential. Treating it as satisfied
		// would reproduce the failure this exists to catch, one layer down.
		if (vault.get(name)) satisfied.push(name);
		else missing.push(name);
	}
	return { id: entry.id, name: entry.name, satisfied, missing };
}

export function fleetSecretStatus(
	entries: GaiaHabitatEntry[],
	vault: SecretPresence,
): FleetSecretStatus {
	const habitats = entries.map((e) => habitatSecretStatus(e, vault));
	const boundAnywhere = new Set(
		entries.flatMap((e) => e.secretBindings ?? []),
	);
	return {
		habitats,
		unbound: vault.listNames().filter((n) => !boundAnywhere.has(n)),
		hasGaps: habitats.some((h) => h.missing.length > 0),
	};
}

/** One line per habitat, gaps first — the answer to "who gets what". */
export function describeFleetSecretStatus(status: FleetSecretStatus): string {
	if (status.habitats.length === 0) return "No habitats registered.";

	const lines: string[] = [];
	const gaps = status.habitats.filter((h) => h.missing.length > 0);
	const ok = status.habitats.filter((h) => h.missing.length === 0);

	if (gaps.length) {
		lines.push("MISSING — bound but the master vault has no value:");
		for (const h of gaps) {
			lines.push(
				`  ${h.id}: ${h.missing.join(", ")}` +
					(h.satisfied.length ? `  (has: ${h.satisfied.join(", ")})` : ""),
			);
		}
		lines.push(
			"  These are dropped from the habitat's secrets.json rather than failing the start,",
			"  so the container boots and health-checks fine and then fails on first use.",
			"  Fix with set_secret (adds the value to the master vault), then rebuild.",
			"",
		);
	}

	for (const h of ok) {
		lines.push(
			`OK ${h.id}: ${h.satisfied.length ? h.satisfied.join(", ") : "(no secrets bound)"}`,
		);
	}

	if (status.unbound.length) {
		lines.push("", `In the vault, bound to nothing: ${status.unbound.join(", ")}`);
	}

	return lines.join("\n");
}
