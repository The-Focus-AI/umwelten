/**
 * Where an answer came from (umwelten #277).
 *
 * Separating start from refresh (#276) means a habitat can legitimately
 * answer from a checkout that is days old. That is usually fine and
 * occasionally catastrophic: a changelog assembled across fifteen client
 * habitats where three were quietly three weeks stale is confidently
 * incorrect in a way nobody notices — the rollup reads as complete because
 * every habitat answered.
 *
 * So every answer carries what it was computed from: the commit each repo is
 * on, when that checkout was last brought up to date, and whether a refresh
 * is already known to be owed. Consumers decide what to do with it. That is
 * what gives the operations habitat grounds to refuse to publish a rollup at
 * all (operations#3) and what the control plane surfaces (habitats#117).
 *
 * Two constraints shape the implementation:
 *
 *  - **No network.** Provenance is about what this checkout *is*, not how far
 *    behind upstream it is. Asking GitHub would make every answer depend on
 *    GitHub being up, and would turn a cheap fact into a rate-limited one.
 *    Everything here reads the volume.
 *
 *  - **Machine-readable first.** Prose provenance gets summarised away by the
 *    next model in the chain. The structured record is the contract;
 *    `describeProvenance()` exists for humans reading a transcript, not for
 *    callers deciding whether to trust an answer.
 */

import { join } from "node:path";
import { normalizeAgents } from "./plan.js";
import { staleMarkerPath } from "./stale.js";
import type { HabitatConfig } from "../types.js";

export type RepoRole = "owned" | "mounted";

export interface RepoProvenance {
	/** `owned` for the Owned repo, otherwise the agent id. */
	id: string;
	role: RepoRole;
	/** False when the repo is declared but not on the volume yet. */
	present: boolean;
	gitRemote?: string;
	branch?: string;
	/** Full SHA of HEAD. */
	commit?: string;
	/** ISO commit date of HEAD — how old the *code* is. */
	committedAt?: string;
	/** ISO time this checkout was last brought up to date. */
	refreshedAt?: string;
	/** Seconds since `refreshedAt`, for callers that would rather not do date maths. */
	refreshedAgeSeconds?: number;
}

export interface HabitatProvenance {
	capturedAt: string;
	/**
	 * A refresh is known to be owed — #276 left a stale mark and the habitat
	 * has not yet acted on it. Distinct from "old": a checkout can be weeks
	 * old and perfectly current if nothing upstream moved.
	 */
	stale: boolean;
	/** ISO time the stale mark was written, when it says. */
	staleSince?: string;
	repos: RepoProvenance[];
}

/** The seam: everything that touches the volume, injectable for tests. */
export interface ProvenanceProbe {
	exists(path: string): Promise<boolean>;
	readFile(path: string): Promise<string | undefined>;
	/** Full SHA of HEAD in `dir`, or undefined if it cannot be read. */
	headCommit(dir: string): Promise<string | undefined>;
	/** ISO commit date of HEAD in `dir`. */
	headCommittedAt(dir: string): Promise<string | undefined>;
	/** ISO time `dir` was last fetched into. */
	lastFetchedAt(dir: string): Promise<string | undefined>;
}

export interface ReadProvenanceInput {
	workDir: string;
	config: HabitatConfig;
	probe: ProvenanceProbe;
	now?: () => Date;
}

async function readRepo(
	probe: ProvenanceProbe,
	now: Date,
	base: Pick<RepoProvenance, "id" | "role" | "gitRemote" | "branch">,
	dir: string,
): Promise<RepoProvenance> {
	if (!(await probe.exists(join(dir, ".git")))) {
		// Declared but not cloned. Reported rather than omitted: a rollup
		// that silently skips a repo it was told about is the failure mode
		// this ticket exists to prevent.
		return { ...base, present: false };
	}

	const [commit, committedAt, refreshedAt] = await Promise.all([
		probe.headCommit(dir),
		probe.headCommittedAt(dir),
		probe.lastFetchedAt(dir),
	]);

	return {
		...base,
		present: true,
		commit,
		committedAt,
		refreshedAt,
		refreshedAgeSeconds: refreshedAt
			? Math.max(0, Math.floor((now.getTime() - Date.parse(refreshedAt)) / 1000))
			: undefined,
	};
}

export async function readHabitatProvenance(
	input: ReadProvenanceInput,
): Promise<HabitatProvenance> {
	const { workDir, config, probe } = input;
	const now = input.now?.() ?? new Date();

	const marker = staleMarkerPath(workDir);
	const staleBody = (await probe.exists(marker))
		? await probe.readFile(marker)
		: undefined;
	const stale = staleBody !== undefined;

	const repos: RepoProvenance[] = [];

	if (config.gitUrl) {
		repos.push(
			await readRepo(
				probe,
				now,
				{
					id: "owned",
					role: "owned",
					gitRemote: config.gitUrl,
					branch: config.gitBranch,
				},
				join(workDir, config.projectDir ?? "project"),
			),
		);
	}

	// Mounted repos are the agents with a remote. An agent without one is a
	// credential-only entry (ADR 0006) — there is no checkout to date.
	const mounts = normalizeAgents(config.agents).filter((a) => a.gitRemote);
	const mounted = await Promise.all(
		mounts.map((agent) =>
			readRepo(
				probe,
				now,
				{
					id: agent.id,
					role: "mounted",
					gitRemote: agent.gitRemote,
					branch: agent.gitBranch,
				},
				join(workDir, "agents", agent.id, "repo"),
			),
		),
	);
	repos.push(...mounted);

	return {
		capturedAt: now.toISOString(),
		stale,
		// The mark's body is the ISO time it was written (#276). An empty or
		// unparseable body still means stale — the mark's presence is the
		// signal, its contents are a courtesy.
		...(stale && staleBody?.trim() && !Number.isNaN(Date.parse(staleBody.trim()))
			? { staleSince: new Date(staleBody.trim()).toISOString() }
			: {}),
		repos,
	};
}

/** Human-readable summary, for transcripts. The structured record is the contract. */
export function describeProvenance(p: HabitatProvenance): string {
	const lines: string[] = [];
	if (p.stale) {
		lines.push(
			p.staleSince
				? `STALE: a refresh has been owed since ${p.staleSince} and has not run yet.`
				: "STALE: a refresh is owed and has not run yet.",
		);
	}
	if (p.repos.length === 0) {
		lines.push("No repos declared — this habitat answers from no checkout.");
		return lines.join("\n");
	}
	for (const r of p.repos) {
		if (!r.present) {
			lines.push(`${r.id} (${r.role}): declared but not checked out.`);
			continue;
		}
		const short = r.commit?.slice(0, 8) ?? "unknown";
		const age =
			r.refreshedAgeSeconds === undefined
				? "refresh time unknown"
				: `refreshed ${formatAge(r.refreshedAgeSeconds)} ago`;
		lines.push(`${r.id} (${r.role}): ${short}, ${age}.`);
	}
	return lines.join("\n");
}

function formatAge(seconds: number): string {
	if (seconds < 90) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 90) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

/**
 * Provenance goes on every answer, and reading it shells out to git once per
 * repo. For the cross-project rollup habitat — the one with the most mounts,
 * and the one this ticket is really for — that is the difference between a
 * fact and a cost. A short TTL keeps it a fact.
 *
 * The TTL is deliberately short: it exists to collapse the repos of a single
 * burst of questions, not to let a refresh go unnoticed.
 */
export class ProvenanceCache {
	private cached?: { at: number; value: HabitatProvenance };

	constructor(
		private readonly read: () => Promise<HabitatProvenance>,
		private readonly ttlMs = 30_000,
		private readonly clock: () => number = () => Date.now(),
	) {}

	async get(): Promise<HabitatProvenance> {
		const now = this.clock();
		if (this.cached && now - this.cached.at < this.ttlMs) {
			return this.cached.value;
		}
		const value = await this.read();
		this.cached = { at: now, value };
		return value;
	}

	/** Drop the cache — call after a refresh, so the next answer tells the truth. */
	invalidate(): void {
		this.cached = undefined;
	}
}
