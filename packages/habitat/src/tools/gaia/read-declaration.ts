/**
 * Reading a habitat's declaration out of its Owned repo.
 *
 * ADR 0006 leaves a bootstrap circularity: Gaia must read the repo to learn
 * the scopes it needs a token to read it with. Cloning would make that worse —
 * a working tree, a disk, and a full history for one small file.
 *
 * Fetching the single file over the contents API resolves it cleanly. The
 * fetch runs under an **ambient-read** token (org-wide `contents: read`, which
 * is what a declaration-less habitat's scope amounts to), and everything after
 * it uses the scope derived from what it read. One request, no working tree,
 * and the widest credential is used for the shortest possible moment.
 */

import { HABITAT_DECLARATION_FILE } from "./declaration.js";

/** `https://github.com/owner/repo(.git)` or `git@github.com:owner/repo` → `owner/repo`. */
export function parseGitHubRepo(
	gitUrl: string,
): { owner: string; repo: string } | undefined {
	const trimmed = gitUrl.trim();
	if (!trimmed) return undefined;

	const ssh = /^[^@\s]+@[^:\s]+:(?<path>[^\s]+)$/.exec(trimmed);
	let path = ssh?.groups?.path;
	if (!path) {
		try {
			path = new URL(trimmed).pathname;
		} catch {
			return undefined;
		}
	}

	const parts = path.replace(/\.git$/i, "").split("/").filter(Boolean);
	if (parts.length < 2) return undefined;
	const [owner, repo] = parts.slice(-2);
	return { owner, repo };
}

export interface ReadDeclarationDeps {
	/** Ambient-read installation token. */
	token?: string;
	fetchImpl?: typeof fetch;
	/** GitHub API base, for GHE or tests. */
	apiBase?: string;
}

export class DeclarationFetchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeclarationFetchError";
	}
}

/**
 * Fetch `habitat.json` from a repo's default branch, or a named ref.
 *
 * Returns undefined when the file is absent — that is a normal answer, and
 * the caller decides what to do about it. Everything else throws, because a
 * repo the App cannot see and a repo with no declaration need very different
 * fixes and must not look alike.
 */
export async function readDeclarationFromRepo(
	gitUrl: string,
	ref?: string,
	deps: ReadDeclarationDeps = {},
): Promise<string | undefined> {
	const parsed = parseGitHubRepo(gitUrl);
	if (!parsed) {
		throw new DeclarationFetchError(
			`Could not read a GitHub owner/repo out of "${gitUrl}".`,
		);
	}

	const base = deps.apiBase ?? "https://api.github.com";
	const url = new URL(
		`/repos/${parsed.owner}/${parsed.repo}/contents/${HABITAT_DECLARATION_FILE}`,
		base,
	);
	if (ref) url.searchParams.set("ref", ref);

	const fetchImpl = deps.fetchImpl ?? fetch;
	const res = await fetchImpl(url, {
		headers: {
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
			...(deps.token ? { authorization: `Bearer ${deps.token}` } : {}),
		},
	});

	if (res.status === 404) {
		// GitHub answers 404 both for "no such file" and for "no such repo, as
		// far as your token is concerned". Those need opposite fixes — add a
		// declaration, versus install the App — so they must not read alike.
		const repoRes = await fetchImpl(
			new URL(`/repos/${parsed.owner}/${parsed.repo}`, base),
			{
				headers: {
					accept: "application/vnd.github+json",
					...(deps.token ? { authorization: `Bearer ${deps.token}` } : {}),
				},
			},
		);
		if (repoRes.status === 404) {
			throw new DeclarationFetchError(
				`Cannot see ${parsed.owner}/${parsed.repo}. If the repo exists and is private, the @habitats GitHub App is probably not installed on it — that is what a 404 looks like from here.`,
			);
		}
		return undefined;
	}

	if (!res.ok) {
		throw new DeclarationFetchError(
			`GitHub returned HTTP ${res.status} reading ${HABITAT_DECLARATION_FILE} from ${parsed.owner}/${parsed.repo}.`,
		);
	}

	const body = (await res.json()) as { content?: string; encoding?: string };
	if (typeof body.content !== "string") {
		throw new DeclarationFetchError(
			`Unexpected contents-API response for ${HABITAT_DECLARATION_FILE} — no content field. Is it a directory?`,
		);
	}

	return body.encoding === "base64"
		? Buffer.from(body.content, "base64").toString("utf-8")
		: body.content;
}
