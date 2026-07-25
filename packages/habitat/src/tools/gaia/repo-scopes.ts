/**
 * Derive a habitat's GitHub read scope from the repos it actually declares.
 *
 * Repo access is currently encoded in four places that nothing reconciles:
 * the habitat's Owned repo (`config.gitUrl`), its Mounted repos (agent
 * entries with `kind: "repo"`), the registry's `github: { read, write }` mint
 * boundary, and the App installation list. Mount a repo without widening the
 * read scope and the boot clone fails with a GitHub 404 that reads exactly
 * like "that repo does not exist" — a bad afternoon once, the default state
 * across twenty habitats.
 *
 * Per ADR 0006 the fix is asymmetric, and the asymmetry is the point:
 *
 * - **Read is derived.** Owned repo plus Mounted repos, computed, so it can
 *   never drift from what the habitat will try to clone.
 * - **Write is never derived.** It covers the Owned repo only and stays an
 *   explicit, human-approved declaration.
 *
 * That asymmetry is what keeps ADR 0004's blind spot #1 closed: automatic
 * derivation can only ever widen *read*, and laundering private content into
 * a public repo needs *write*. Derivation also always produces an explicit
 * list, never `"org"` — org-wide read is a deliberate act, not something a
 * mount list can grant you by accident.
 */

import type { AgentEntry, HabitatConfig } from "../../types.js";

/**
 * Extract `owner/name` from a git remote. Handles the HTTPS and SSH forms
 * plus an optional `.git` suffix. Returns undefined for anything else, so an
 * unparseable remote widens no scope rather than guessing.
 */
export function repoNameFromGitUrl(gitUrl: string | undefined): string | undefined {
	if (!gitUrl) return undefined;
	const trimmed = gitUrl.trim();
	if (!trimmed) return undefined;

	// git@host:owner/name(.git)
	const ssh = /^[^@\s]+@[^:\s]+:(?<path>[^\s]+)$/.exec(trimmed);
	const rawPath = ssh?.groups?.path ?? extractHttpPath(trimmed);
	if (!rawPath) return undefined;

	const segments = rawPath
		.replace(/\.git$/i, "")
		.split("/")
		.filter(Boolean);
	if (segments.length < 2) return undefined;

	// Take the LAST two segments: GitHub URLs are owner/name, but a host with
	// a path prefix would otherwise yield the prefix instead of the owner.
	return segments.slice(-2).join("/");
}

function extractHttpPath(gitUrl: string): string | undefined {
	try {
		const url = new URL(gitUrl);
		return url.pathname;
	} catch {
		return undefined;
	}
}

/** Just the repo name, without the owner — the form the mint boundary uses. */
export function bareRepoName(fullName: string | undefined): string | undefined {
	if (!fullName) return undefined;
	const segments = fullName.split("/").filter(Boolean);
	return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

/** Agent entries that cause a clone at boot. */
function isCodeBearing(agent: AgentEntry): boolean {
	const kind = agent.kind ?? "repo";
	return (kind === "repo" || kind === "mcp-agent") && Boolean(agent.gitRemote);
}

export interface DerivedRepoScopes {
	/** Repo names the habitat must be able to read. Always an explicit list. */
	read: string[];
	/** The Owned repo's name, if it has one. Never derived into `write`. */
	owned?: string;
	/** Mounted repo names, in declaration order. */
	mounted: string[];
	/** Remotes that could not be parsed, so a caller can surface them. */
	unresolved: string[];
}

/**
 * Compute the read scope a habitat needs from its own declaration.
 *
 * Deliberately does NOT return a `write` list. Write is the Owned repo only
 * and is declared by a human; see the module comment.
 */
export function deriveRepoScopes(config: HabitatConfig): DerivedRepoScopes {
	const unresolved: string[] = [];

	const owned = bareRepoName(repoNameFromGitUrl(config.gitUrl));
	if (config.gitUrl && !owned) unresolved.push(config.gitUrl);

	const mounted: string[] = [];
	for (const agent of config.agents ?? []) {
		if (!isCodeBearing(agent)) continue;
		const name = bareRepoName(repoNameFromGitUrl(agent.gitRemote));
		if (!name) {
			unresolved.push(agent.gitRemote as string);
			continue;
		}
		if (!mounted.includes(name)) mounted.push(name);
	}

	const read: string[] = [];
	for (const name of [owned, ...mounted]) {
		if (name && !read.includes(name)) read.push(name);
	}

	return { read, mounted, unresolved, ...(owned ? { owned } : {}) };
}

/**
 * Merge a derived read scope into an existing declaration.
 *
 * An existing `"org"` read is preserved rather than narrowed to a list —
 * whoever set it did so deliberately, and silently replacing it here would be
 * a scope change nobody asked for. Explicitly declared extra repos are kept,
 * so a habitat that needs to read something it does not mount (a standards
 * corpus, say) does not lose it every time scopes are recomputed.
 */
export function mergeDerivedReadScope(
	existing: { read?: "org" | string[]; write?: string[] } | undefined,
	derived: DerivedRepoScopes,
): { read: "org" | string[]; write?: string[] } {
	if (existing?.read === "org") {
		return { read: "org", ...(existing.write ? { write: existing.write } : {}) };
	}

	const merged = [...(existing?.read ?? [])];
	for (const name of derived.read) {
		if (!merged.includes(name)) merged.push(name);
	}

	return {
		read: merged,
		...(existing?.write ? { write: existing.write } : {}),
	};
}
