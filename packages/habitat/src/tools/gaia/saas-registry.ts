/**
 * Announce habitats to the Habitats SaaS (dynamic registry).
 *
 * Gaia is the only thing that knows the fleet: which habitats exist, what
 * they are called, where they are served. The SaaS learned that only when a
 * human pasted a URL and token into its attach form, so its view of the fleet
 * was a snapshot of whoever had bothered, and drifted from the moment a
 * habitat was created, renamed, or moved.
 *
 * This closes that loop from the side that has the facts. Three properties
 * shape the design:
 *
 *  - **Announcement is a statement, not an event.** Gaia announces on every
 *    start, and the receiver upserts. Nothing has to remember whether a
 *    habitat was announced before, which means no local state to fall out of
 *    sync and no backfill problem after an outage.
 *  - **It never fails a start.** A habitat that is running is more important
 *    than the SaaS knowing about it. Every failure here is logged and
 *    swallowed; the next start announces again.
 *  - **It is off unless configured.** With no URL or secret this is inert, so
 *    a local Gaia or a fresh deploy gains no surprise outbound call.
 *
 * The token sent is the habitat's own per-container API key. It travels only
 * in this authenticated server-to-server registration body; browser links use
 * a one-time login handoff and never expose it. The receiver stores the key
 * encrypted for legacy dispatch and child-authenticated handoff redemption,
 * while normal user calls use audience-bound signed grants.
 */

import type { GaiaHabitatEntry } from "./types.js";
import { resolveHabitatHostname } from "./docker.js";

export interface SaasRegistryConfig {
	/** Full URL of the SaaS register endpoint. */
	url: string;
	/** Shared secret presented as a bearer token. */
	secret: string;
	/** Workspace slug new habitats attach to; the receiver may also default it. */
	workspace?: string;
}

/** Public SaaS origin used for signed-in browser handoffs to child Shells. */
export function resolveSaasAppOrigin(
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	const configured =
		env.HABITATS_SAAS_URL?.trim() ??
		env.HABITATS_SAAS_REGISTRY_URL?.trim();
	if (!configured) return null;
	try {
		return new URL(configured).origin;
	} catch {
		return null;
	}
}

/**
 * Registry settings from the environment. Null — meaning "do not announce" —
 * unless both the URL and the secret are present, because either alone is a
 * half-configured integration that would only produce failing calls.
 *
 * - `HABITATS_SAAS_REGISTRY_URL`
 * - `HABITATS_SAAS_REGISTRY_SECRET`
 * - `HABITATS_SAAS_REGISTRY_WORKSPACE` (optional)
 */
export function resolveSaasRegistryConfig(
	env: NodeJS.ProcessEnv = process.env,
): SaasRegistryConfig | null {
	const url = env.HABITATS_SAAS_REGISTRY_URL?.trim();
	const secret = env.HABITATS_SAAS_REGISTRY_SECRET?.trim();
	if (!url || !secret) return null;
	const workspace = env.HABITATS_SAAS_REGISTRY_WORKSPACE?.trim();
	return { url, secret, ...(workspace ? { workspace } : {}) };
}

export interface AnnouncePayload {
	habitatId: string;
	endpoint: string;
	name: string;
	token: string;
	workspaceSlug?: string;
}

/**
 * Build the announcement for one habitat, or null when it has no public
 * address.
 *
 * A habitat reachable only on a host loopback port is deliberately not
 * announced: the SaaS runs on Vercel and could never dispatch to it, so
 * recording it would put a row in the product that looks attached and can
 * never answer. `entryOpenUrl` falls back to localhost for exactly the local
 * case this must skip, which is why this derives the hostname directly.
 *
 * The endpoint carries no token — the receiver takes it as a field and stores
 * it encrypted, rather than keeping a credential in a URL it will log.
 */
export function buildAnnouncement(
	entry: GaiaHabitatEntry,
	config: SaasRegistryConfig,
): AnnouncePayload | null {
	const host = resolveHabitatHostname(entry);
	if (!host) return null;
	return {
		habitatId: entry.id,
		endpoint: `https://${host}`,
		name: entry.name,
		token: entry.apiKey,
		...(config.workspace ? { workspaceSlug: config.workspace } : {}),
	};
}

export interface AnnounceDeps {
	fetch: typeof globalThis.fetch;
	log?: (message: string) => void;
	/** Bounded so a slow or hanging SaaS cannot stall a habitat start. */
	timeoutMs?: number;
}

export type AnnounceOutcome =
	| { ok: true; created?: boolean; agentKey?: string }
	| { ok: false; reason: string }
	| { ok: "skipped"; reason: string };

/**
 * Announce one habitat. Never throws — the caller is a start path.
 */
export async function announceHabitat(
	entry: GaiaHabitatEntry,
	config: SaasRegistryConfig,
	deps: AnnounceDeps,
): Promise<AnnounceOutcome> {
	const payload = buildAnnouncement(entry, config);
	if (!payload) {
		return {
			ok: "skipped",
			reason: `${entry.id} has no public hostname; nothing the SaaS could dispatch to`,
		};
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);
	try {
		const res = await deps.fetch(config.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${config.secret}`,
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			return { ok: false, reason: `HTTP ${res.status} ${body.slice(0, 200)}` };
		}
		const json = (await res.json().catch(() => ({}))) as {
			created?: boolean;
			agentKey?: string;
		};
		deps.log?.(
			`[saas-registry] ${entry.id} ${json.created ? "registered" : "updated"}` +
				`${json.agentKey ? ` as ${json.agentKey}` : ""}`,
		);
		return {
			ok: true,
			...(json.created !== undefined ? { created: json.created } : {}),
			...(json.agentKey ? { agentKey: json.agentKey } : {}),
		};
	} catch (err) {
		return {
			ok: false,
			reason: err instanceof Error ? err.message : String(err),
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Announce a habitat as a side effect of starting it.
 *
 * Swallows everything: a failed announcement is logged and forgotten, because
 * the next start announces again and a running habitat matters more than the
 * SaaS's view of it being current this second.
 */
export async function announceOnStart(
	entry: GaiaHabitatEntry,
	deps: Partial<AnnounceDeps> = {},
): Promise<void> {
	const config = resolveSaasRegistryConfig();
	if (!config) return;
	const log = deps.log ?? ((m: string) => console.log(m));
	const outcome = await announceHabitat(entry, config, {
		fetch: deps.fetch ?? globalThis.fetch,
		log,
		...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
	});
	if (outcome.ok === false) {
		log(`[saas-registry] ${entry.id} announcement failed: ${outcome.reason}`);
	} else if (outcome.ok === "skipped") {
		log(`[saas-registry] skipped ${outcome.reason}`);
	}
}
