/**
 * Turning declared mounts into the agent entries the entrypoint clones.
 *
 * Per ADR 0006 a habitat has at most one **Owned repo** — the material it is
 * responsible for, read-write — and any number of **Mounted repos**, which it
 * reads and never writes. Mounts are carried as agent entries with
 * `kind: "repo"` and `mode: "read"`, which is what makes the container
 * entrypoint clone them and what makes the file tools refuse to write into
 * them.
 *
 * Creating a habitat used to accept an Owned repo but not mounts, so standing
 * up a client habitat was a create call, then a config update, then a scope
 * grant, then a rebuild — with nothing tying the mounts to the scopes. This
 * builds both from one declaration.
 */

import type { AgentEntry } from "../../types.js";
import type { MountedRepoSpec } from "./types.js";
import { repoNameFromGitUrl, bareRepoName } from "./repo-scopes.js";

/** Slug an id into something safe for a directory name. */
function toMountId(spec: MountedRepoSpec): string | undefined {
	const explicit = spec.id?.trim();
	if (explicit) return explicit;
	// Default to the repo's own name — that is what makes the common case
	// `{ gitRemote }` with nothing else.
	return bareRepoName(repoNameFromGitUrl(spec.gitRemote));
}

export class MountDeclarationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MountDeclarationError";
	}
}

/**
 * Build read-only agent entries from declared mounts.
 *
 * Throws rather than skipping on a bad declaration: a mount that silently
 * vanishes would surface much later as "the agent can't see that repo",
 * which is a far worse afternoon than a rejected create call.
 */
export function mountsToAgentEntries(
	mounts: MountedRepoSpec[] | undefined,
): AgentEntry[] {
	if (!mounts?.length) return [];

	const entries: AgentEntry[] = [];
	const seen = new Set<string>();

	for (const spec of mounts) {
		const remote = spec.gitRemote?.trim();
		if (!remote) {
			throw new MountDeclarationError(
				"A mount needs a gitRemote; got an entry without one.",
			);
		}

		const id = toMountId(spec);
		if (!id) {
			throw new MountDeclarationError(
				`Could not derive a mount id from "${remote}". Pass an explicit id.`,
			);
		}
		if (seen.has(id)) {
			throw new MountDeclarationError(
				`Duplicate mount id "${id}". Mounts share a directory namespace, so ids must be unique — pass an explicit id for one of them.`,
			);
		}
		seen.add(id);

		entries.push({
			id,
			name: spec.name ?? id,
			// Where the entrypoint clones it inside the container.
			projectPath: `agents/${id}/repo`,
			kind: "repo",
			// The half that makes this a Mounted repo rather than a second Owned
			// one: read mode blocks writes and forces read-only tool subsets.
			mode: "read",
			gitRemote: remote,
			...(spec.gitBranch ? { gitBranch: spec.gitBranch } : {}),
		});
	}

	return entries;
}
