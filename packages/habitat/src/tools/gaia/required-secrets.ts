/**
 * What a habitat actually needs, read from what the habitat says it needs.
 *
 * A habitat already declares its requirements in `config.requiredSecrets[]`
 * and publishes them on its agent card as `requiredCredentials` (ADR 0004).
 * That is the contract: *to instantiate me, give me these things.*
 *
 * Gaia never read it. It provisioned from `secretBindings` — a separate,
 * hand-maintained list of bare names on the registry entry — and the
 * relationship was inverted: `export_habitat` *generated* `requiredSecrets`
 * from `secretBindings`, making the declaration a derivative of the manual
 * list rather than its source. Meanwhile `entry.config.requiredSecrets` sat
 * on the same registry entry, unread.
 *
 * The cost was drift with nothing to catch it. A name in `secretBindings`
 * that no habitat ever asked for looks exactly like one it did, so a client
 * repo ended up declaring a model API key that is not a fact about that
 * client — nobody could tell from the data which names were real.
 *
 * This module makes the contract the source. The distinction it draws that a
 * bare name list cannot:
 *
 *  - **`type: "secret"`** — an operator value. Gaia resolves it from the
 *    habitat's vault, and a missing one fails the start.
 *  - **`type: "oauth"`** — the habitat mints this itself, at its own
 *    `connectPath`, when a user authorizes. It never enters a vault, and
 *    counting it as missing would refuse to start a habitat over a token no
 *    vault was ever meant to hold.
 *
 * That second case was only ever handled by convention. Here it is a rule.
 */

import type { HabitatConfig, RequiredSecret } from "../../types.js";

export interface SecretNeeds {
	/** Names Gaia must resolve from the habitat's vault before it can start. */
	fromVault: string[];
	/** Names the habitat mints itself. Gaia supplies nothing and checks nothing. */
	selfMinted: string[];
	/**
	 * Where this came from. `contract` means the habitat declared it;
	 * `bindings` means it has not been migrated and we fell back to the old
	 * hand-maintained list.
	 */
	source: "contract" | "bindings";
	/** The declarations behind `fromVault`, for reporting. */
	declared: RequiredSecret[];
}

/** True when this requirement is the habitat's to mint, not Gaia's to supply. */
export function isSelfMinted(secret: RequiredSecret): boolean {
	return secret.type === "oauth";
}

/**
 * Work out what a habitat needs.
 *
 * Prefers the declared contract; falls back to `secretBindings` for habitats
 * that have not been migrated, so nothing breaks while the fleet moves over.
 * A habitat declaring an empty `requiredSecrets: []` is taken at its word —
 * it needs nothing — rather than falling through to the old list, since
 * "declared nothing" and "declared nothing yet" must not look alike.
 */
export function secretNeeds(
	config: Pick<HabitatConfig, "requiredSecrets">,
	secretBindings: readonly string[] = [],
): SecretNeeds {
	const declared = config.requiredSecrets;

	if (declared === undefined) {
		return {
			fromVault: [...secretBindings],
			selfMinted: [],
			source: "bindings",
			declared: [],
		};
	}

	const fromVault = declared.filter((s) => !isSelfMinted(s));
	return {
		fromVault: fromVault.map((s) => s.name),
		selfMinted: declared.filter(isSelfMinted).map((s) => s.name),
		source: "contract",
		declared: fromVault,
	};
}

/**
 * Names the habitat declared that its vault did not supply.
 *
 * Only ever `type: "secret"` entries — a self-minted credential is absent
 * until a user connects, which is normal and must never block a start.
 * Optional entries are reported too: `required: false` means the habitat can
 * run without it, so the caller decides whether to block.
 */
export function unmetNeeds(
	needs: SecretNeeds,
	resolved: Record<string, string>,
): { missing: string[]; missingRequired: string[] } {
	const missing = needs.fromVault.filter((name) => !resolved[name]);
	if (needs.source === "bindings") {
		// A bare name list carries no required/optional flag, so every name in
		// it counts as required — which is how it behaved before.
		return { missing, missingRequired: missing };
	}
	const requiredNames = new Set(
		needs.declared.filter((s) => s.required !== false).map((s) => s.name),
	);
	return {
		missing,
		missingRequired: missing.filter((name) => requiredNames.has(name)),
	};
}

/** Human-readable summary. Names only, never values. */
export function describeSecretNeeds(
	id: string,
	needs: SecretNeeds,
	resolved?: Record<string, string>,
): string {
	const lines: string[] = [];

	if (needs.source === "bindings") {
		lines.push(
			`${id}: no declared contract — falling back to secretBindings.`,
			`  Add requiredSecrets[] to its config so it states what it needs.`,
		);
	}

	if (needs.fromVault.length === 0 && needs.selfMinted.length === 0) {
		lines.push(`${id}: declares no secrets.`);
		return lines.join("\n");
	}

	if (needs.fromVault.length) {
		const status = (name: string) =>
			resolved ? (resolved[name] ? "ok" : "MISSING") : "declared";
		lines.push(
			`${id} — from its vault:`,
			...needs.fromVault.map((n) => `    ${n}  ${status(n)}`),
		);
	}

	if (needs.selfMinted.length) {
		lines.push(
			`${id} — minted by the habitat when a user connects (Gaia supplies nothing):`,
			...needs.selfMinted.map((n) => `    ${n}`),
		);
	}

	return lines.join("\n");
}
