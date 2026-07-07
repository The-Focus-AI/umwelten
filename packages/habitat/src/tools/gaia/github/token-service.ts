/**
 * GitHub installation-token service for Gaia (ADR 0004, decisions 2 + 3).
 *
 * Derives the down-scoped repo list + permissions from a habitat entry's
 * `github` capability declaration and mints tokens via ./app-auth.ts,
 * reading the App private key from disk at mint time (never stored in the
 * vault or config). Mints are cached ~50 minutes per (kind + sorted repo
 * list) to respect the installation's pooled rate limits (blind spot #7) —
 * safely under the 1-hour token expiry.
 */

import { readFile } from "node:fs/promises";
import {
	mintInstallationToken,
	type InstallationToken,
} from "./app-auth.js";
import type { GithubAppConfig } from "./app-config.js";

export type GithubTokenKind = "read" | "write";

/** See GaiaHabitatEntry.github (../types.ts) for declaration semantics. */
export interface GithubCapabilityDecl {
	read?: "org" | string[];
	write?: string[];
}

/** The slice of a registry entry the service needs. */
export interface GithubScopedEntry {
	id?: string;
	github?: GithubCapabilityDecl;
}

/** Down-scope request derived from an entry's declaration. */
export interface GithubTokenScope {
	/** Omitted ⇒ every repo in the installation (ambient "org" read). */
	repositories?: string[];
	permissions: Record<string, string>;
}

export interface GithubTokenServiceDeps {
	/** Replace the whole mint (tests). Default reads the key file + calls GitHub. */
	mint?: (scope: GithubTokenScope) => Promise<InstallationToken>;
	/** Clock in ms since epoch (tests). Default: Date.now. */
	now?: () => number;
	/** Key-file reader (tests). Default: fs readFile utf-8. */
	readFileImpl?: (path: string) => Promise<string>;
	/** fetch used by the default mint path. */
	fetchImpl?: typeof fetch;
}

/** Cache mints for 50 minutes (tokens live 60). */
const CACHE_TTL_MS = 50 * 60 * 1000;

/**
 * The mint API's `repositories` field takes bare repo names — the owner is
 * implied by the installation — but declarations naturally arrive as
 * `owner/name` (that's how the registry and humans write repos everywhere
 * else). GitHub 422s on owner-prefixed names, so strip to the final path
 * segment and dedupe before minting.
 */
function toBareRepoNames(repos: string[]): string[] {
	return [...new Set(repos.map((r) => r.split("/").filter(Boolean).pop() ?? r))].sort();
}

/**
 * Derive the token scope for an entry + kind, or null when the entry
 * declares no matching capability.
 *
 * - read  → `contents: read`; `read: "org"` omits the repo list (ambient
 *   installation-wide read), an explicit list pins it.
 * - write → `contents/issues/pull_requests: write`, pinned to exactly the
 *   declared write repos. Write repos are readable through the write token
 *   too (permissions are uniform across a token's repo list).
 */
export function deriveGithubTokenScope(
	entry: GithubScopedEntry,
	kind: GithubTokenKind,
): GithubTokenScope | null {
	const decl = entry.github;
	if (!decl) return null;

	if (kind === "read") {
		if (decl.read === "org") {
			return { permissions: { contents: "read" } };
		}
		if (Array.isArray(decl.read) && decl.read.length > 0) {
			return {
				repositories: toBareRepoNames(decl.read),
				permissions: { contents: "read" },
			};
		}
		return null;
	}

	if (Array.isArray(decl.write) && decl.write.length > 0) {
		return {
			repositories: toBareRepoNames(decl.write),
			permissions: {
				contents: "write",
				issues: "write",
				pull_requests: "write",
			},
		};
	}
	return null;
}

export interface GithubTokenService {
	/** False when the GitHub App is not configured — every mint returns null. */
	readonly enabled: boolean;
	/**
	 * Mint (or serve from cache) a token for the entry's declared scope.
	 * Returns null when the App is unconfigured or the entry declares no
	 * matching scope. Throws on GitHub API failure.
	 */
	tokenFor(
		entry: GithubScopedEntry,
		kind: GithubTokenKind,
	): Promise<InstallationToken | null>;
	/**
	 * Boot-time token bundle for docker.ts env injection. Never throws —
	 * a mint failure must not block a container start (the pull route is
	 * the refresh path); it is logged and that token omitted.
	 */
	bootTokensFor(
		entry: GithubScopedEntry,
	): Promise<{ read?: string; write?: string } | undefined>;
}

export function createGithubTokenService(
	cfg: GithubAppConfig | null,
	deps: GithubTokenServiceDeps = {},
): GithubTokenService {
	const now = deps.now ?? Date.now;
	const readFileImpl =
		deps.readFileImpl ?? ((path: string) => readFile(path, "utf-8"));
	const cache = new Map<string, { token: InstallationToken; mintedAt: number }>();

	async function doMint(scope: GithubTokenScope): Promise<InstallationToken> {
		if (deps.mint) return deps.mint(scope);
		if (!cfg) throw new Error("GitHub App not configured");
		// Key read at use-time — the PEM never lands in config/vault/registry.
		const privateKeyPem = await readFileImpl(cfg.privateKeyFile);
		return mintInstallationToken(
			{
				appId: cfg.appId,
				privateKeyPem,
				installationId: cfg.installationId,
				repositories: scope.repositories,
				permissions: scope.permissions,
			},
			{
				fetchImpl: deps.fetchImpl,
				now: () => Math.floor(now() / 1000),
			},
		);
	}

	async function tokenFor(
		entry: GithubScopedEntry,
		kind: GithubTokenKind,
	): Promise<InstallationToken | null> {
		if (!cfg) return null;
		const scope = deriveGithubTokenScope(entry, kind);
		if (!scope) return null;

		const cacheKey = `${kind}|${scope.repositories?.join(",") ?? "<org>"}`;
		const cached = cache.get(cacheKey);
		if (cached && now() - cached.mintedAt < CACHE_TTL_MS) {
			return cached.token;
		}

		const token = await doMint(scope);
		cache.set(cacheKey, { token, mintedAt: now() });
		return token;
	}

	async function bootTokensFor(
		entry: GithubScopedEntry,
	): Promise<{ read?: string; write?: string } | undefined> {
		const result: { read?: string; write?: string } = {};
		for (const kind of ["read", "write"] as const) {
			try {
				const minted = await tokenFor(entry, kind);
				if (minted) result[kind] = minted.token;
			} catch (err) {
				console.warn(
					`[gaia] GitHub ${kind} token mint failed for "${entry.id ?? "?"}" (continuing without it): ${err instanceof Error ? err.message : err}`,
				);
			}
		}
		return result.read || result.write ? result : undefined;
	}

	return { enabled: cfg !== null, tokenFor, bootTokensFor };
}
