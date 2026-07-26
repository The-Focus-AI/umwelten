/**
 * Backing-storage token relay for Gaia (habitats ADR 0005, decision 5).
 *
 * The SaaS is the upstream token authority (it fetches the provisioner's
 * Google access token from Clerk); Gaia only relays. This mirrors the
 * GitHub token service shape — declare-or-refuse against the registry
 * entry, structured refusals, injectable fetch for tests — but mints
 * nothing itself and caches nothing: every pull fetches fresh from the
 * SaaS so revocation takes effect immediately.
 *
 * SaaS contract (The-Focus-AI/habitats#115):
 *   POST <url> body {"habitatId": "..."} with `Authorization: Bearer <key>`
 *   200 → { accessToken, expiresAt, folderId, scopes: {read, write} }
 *   404 → habitat has no provisioned storage
 *   409 → storage provisioned but the grant is broken (needs re-provision)
 */

export interface StorageCapabilityDecl {
	kind: "google-drive";
	read?: boolean;
	write?: boolean;
}

/** The slice of a registry entry the service needs. */
export interface StorageScopedEntry {
	id?: string;
	storage?: StorageCapabilityDecl;
}

export interface StorageRelayConfig {
	/** Full URL of the SaaS storage-token endpoint. */
	tokenUrl: string;
	/** Bearer key authenticating Gaia to the SaaS endpoint. */
	saasKey: string;
}

export interface StorageToken {
	accessToken: string;
	/** ISO timestamp. */
	expiresAt: string;
	folderId: string;
	scopes: { read: boolean; write: boolean };
}

export type StorageTokenResult =
	| { ok: true; token: StorageToken }
	| {
			ok: false;
			status: "not_provisioned" | "needs_reprovision" | "upstream_error";
			message: string;
	  };

export function resolveStorageRelayConfig(
	env: Record<string, string | undefined> = process.env,
): StorageRelayConfig | null {
	const tokenUrl = env.HABITATS_STORAGE_TOKEN_URL?.trim();
	const saasKey = env.HABITATS_STORAGE_TOKEN_KEY?.trim();
	if (!tokenUrl || !saasKey) return null;
	return { tokenUrl, saasKey };
}

/**
 * Derive the declared scope for an entry, or null when the entry declares
 * no usable storage capability. The registry declaration is the capability
 * boundary — a habitat whose entry declares nothing gets refused before
 * Gaia ever talks to the SaaS.
 */
export function deriveStorageScope(
	entry: StorageScopedEntry,
): { read: boolean; write: boolean } | null {
	const decl = entry.storage;
	if (!decl || decl.kind !== "google-drive") return null;
	const read = decl.read !== false; // read defaults on for declared storage
	const write = decl.write === true;
	if (!read && !write) return null;
	return { read, write };
}

export interface StorageTokenService {
	/** False when the relay is unconfigured — every pull returns a refusal. */
	readonly enabled: boolean;
	/**
	 * Relay a fresh token for the entry's declared storage. Never throws:
	 * upstream failures come back as structured refusals so the route can
	 * map them to responses and audit entries.
	 */
	tokenFor(entry: StorageScopedEntry): Promise<StorageTokenResult>;
}

export interface StorageTokenServiceDeps {
	fetchImpl?: typeof fetch;
}

export function createStorageTokenService(
	cfg: StorageRelayConfig | null,
	deps: StorageTokenServiceDeps = {},
): StorageTokenService {
	const fetchImpl = deps.fetchImpl ?? fetch;

	async function tokenFor(
		entry: StorageScopedEntry,
	): Promise<StorageTokenResult> {
		if (!cfg) {
			return {
				ok: false,
				status: "upstream_error",
				message: "Storage token relay not configured on Gaia",
			};
		}
		const scope = deriveStorageScope(entry);
		if (!scope) {
			return {
				ok: false,
				status: "not_provisioned",
				message: `habitat "${entry.id ?? "?"}" declares no storage capability`,
			};
		}

		let res: Response;
		try {
			res = await fetchImpl(cfg.tokenUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${cfg.saasKey}`,
				},
				body: JSON.stringify({ habitatId: entry.id }),
			});
		} catch (err) {
			return {
				ok: false,
				status: "upstream_error",
				message: `SaaS unreachable: ${err instanceof Error ? err.message : err}`,
			};
		}

		if (res.status === 404) {
			return {
				ok: false,
				status: "not_provisioned",
				message: "No backing storage provisioned for this habitat",
			};
		}
		if (res.status === 409) {
			return {
				ok: false,
				status: "needs_reprovision",
				message:
					"Backing storage grant is broken — a member must re-provision it",
			};
		}
		if (!res.ok) {
			return {
				ok: false,
				status: "upstream_error",
				message: `SaaS token endpoint returned ${res.status}`,
			};
		}

		let body: Partial<StorageToken>;
		try {
			body = (await res.json()) as Partial<StorageToken>;
		} catch {
			return {
				ok: false,
				status: "upstream_error",
				message: "SaaS token endpoint returned invalid JSON",
			};
		}
		if (!body.accessToken || !body.folderId || !body.expiresAt) {
			return {
				ok: false,
				status: "upstream_error",
				message: "SaaS token response missing accessToken/folderId/expiresAt",
			};
		}

		// The registry declaration is authoritative and can only narrow what
		// the SaaS grants — a habitat declared read-only never receives write
		// even if the SaaS-side grant would allow it.
		const saasScopes = body.scopes ?? { read: true, write: true };
		return {
			ok: true,
			token: {
				accessToken: body.accessToken,
				expiresAt: body.expiresAt,
				folderId: body.folderId,
				scopes: {
					read: scope.read && saasScopes.read !== false,
					write: scope.write && saasScopes.write === true,
				},
			},
		};
	}

	return { enabled: cfg !== null, tokenFor };
}
