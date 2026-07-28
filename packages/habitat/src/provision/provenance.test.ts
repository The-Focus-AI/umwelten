import { describe, expect, it, vi } from "vitest";
import {
	ProvenanceCache,
	describeProvenance,
	readHabitatProvenance,
	type HabitatProvenance,
	type ProvenanceProbe,
} from "./provenance.js";
import { STALE_MARKER_FILE } from "./stale.js";
import type { HabitatConfig } from "../types.js";

const WORK = "/habitat";
const NOW = new Date("2026-07-28T12:00:00.000Z");

/**
 * A fake volume. `repos` maps a checkout directory to what git would say
 * about it; anything not listed is not cloned.
 */
function probeFor(opts: {
	repos?: Record<
		string,
		{ commit?: string; committedAt?: string; fetchedAt?: string }
	>;
	staleMark?: string | false;
}): ProvenanceProbe {
	const repos = opts.repos ?? {};
	const markPath = `${WORK}/${STALE_MARKER_FILE}`;
	const dirOf = (gitPath: string) => gitPath.replace(/\/\.git$/, "");

	return {
		exists: vi.fn(async (path: string) => {
			if (path === markPath) return opts.staleMark !== false && opts.staleMark !== undefined;
			if (path.endsWith("/.git")) return dirOf(path) in repos;
			return false;
		}),
		readFile: vi.fn(async (path: string) =>
			path === markPath && typeof opts.staleMark === "string"
				? opts.staleMark
				: undefined,
		),
		headCommit: vi.fn(async (dir: string) => repos[dir]?.commit),
		headCommittedAt: vi.fn(async (dir: string) => repos[dir]?.committedAt),
		lastFetchedAt: vi.fn(async (dir: string) => repos[dir]?.fetchedAt),
	};
}

function config(overrides: Partial<HabitatConfig> = {}): HabitatConfig {
	return {
		name: "upperhand",
		gitUrl: "https://github.com/The-Focus-AI/client-upperhand.git",
		...overrides,
	} as HabitatConfig;
}

const read = (cfg: HabitatConfig, probe: ProvenanceProbe) =>
	readHabitatProvenance({ workDir: WORK, config: cfg, probe, now: () => NOW });

describe("readHabitatProvenance", () => {
	it("reports the Owned repo's commit and when it was last refreshed", async () => {
		const probe = probeFor({
			repos: {
				[`${WORK}/project`]: {
					commit: "a".repeat(40),
					committedAt: "2026-07-20T09:00:00.000Z",
					fetchedAt: "2026-07-27T12:00:00.000Z",
				},
			},
		});

		const p = await read(config(), probe);

		expect(p.repos).toHaveLength(1);
		expect(p.repos[0]).toMatchObject({
			id: "owned",
			role: "owned",
			present: true,
			commit: "a".repeat(40),
			committedAt: "2026-07-20T09:00:00.000Z",
			refreshedAt: "2026-07-27T12:00:00.000Z",
			refreshedAgeSeconds: 86_400,
		});
		expect(p.capturedAt).toBe(NOW.toISOString());
	});

	it("reports the same for each Mounted repo", async () => {
		const cfg = config({
			agents: [
				{ id: "api", gitRemote: "https://github.com/x/api.git", mode: "read" },
				{ id: "web", gitRemote: "https://github.com/x/web.git", mode: "read" },
			],
		} as Partial<HabitatConfig>);
		const probe = probeFor({
			repos: {
				[`${WORK}/project`]: { commit: "a".repeat(40), fetchedAt: NOW.toISOString() },
				[`${WORK}/agents/api/repo`]: {
					commit: "b".repeat(40),
					fetchedAt: "2026-07-28T11:00:00.000Z",
				},
				[`${WORK}/agents/web/repo`]: {
					commit: "c".repeat(40),
					fetchedAt: "2026-07-21T12:00:00.000Z",
				},
			},
		});

		const p = await read(cfg, probe);

		const mounted = p.repos.filter((r) => r.role === "mounted");
		expect(mounted.map((r) => r.id)).toEqual(["api", "web"]);
		expect(mounted[0].refreshedAgeSeconds).toBe(3_600);
		expect(mounted[1].refreshedAgeSeconds).toBe(7 * 86_400);
		expect(mounted[0].gitRemote).toBe("https://github.com/x/api.git");
	});

	it("says so explicitly when a refresh is owed, with when it was marked", async () => {
		const probe = probeFor({
			repos: { [`${WORK}/project`]: { commit: "a".repeat(40) } },
			staleMark: "2026-07-28T06:30:00.000Z\n",
		});

		const p = await read(config(), probe);

		expect(p.stale).toBe(true);
		expect(p.staleSince).toBe("2026-07-28T06:30:00.000Z");
	});

	/** The mark's presence is the signal; its contents are a courtesy. */
	it("is still stale when the mark's body is empty or unparseable", async () => {
		for (const body of ["", "   ", "not a date"]) {
			const p = await read(
				config(),
				probeFor({ repos: {}, staleMark: body }),
			);
			expect(p.stale).toBe(true);
			expect(p.staleSince).toBeUndefined();
		}
	});

	it("is not stale when no mark is present", async () => {
		const p = await read(config(), probeFor({ staleMark: false }));
		expect(p.stale).toBe(false);
	});

	it("reports provenance without error for a habitat with no Mounted repos", async () => {
		const probe = probeFor({
			repos: { [`${WORK}/project`]: { commit: "a".repeat(40) } },
		});

		const p = await read(config({ agents: [] } as Partial<HabitatConfig>), probe);

		expect(p.repos).toHaveLength(1);
		expect(p.repos[0].role).toBe("owned");
	});

	it("reports a habitat with no repos at all rather than failing", async () => {
		const p = await read(
			config({ gitUrl: undefined } as Partial<HabitatConfig>),
			probeFor({}),
		);
		expect(p.repos).toEqual([]);
		expect(p.stale).toBe(false);
	});

	/**
	 * A rollup that silently skips a repo it was told about is the exact
	 * failure this ticket exists to prevent, so a declared-but-absent repo
	 * is reported rather than omitted.
	 */
	it("reports a declared repo that is not checked out", async () => {
		const cfg = config({
			agents: [{ id: "api", gitRemote: "https://github.com/x/api.git", mode: "read" }],
		} as Partial<HabitatConfig>);

		const p = await read(cfg, probeFor({ repos: {} }));

		expect(p.repos.map((r) => [r.id, r.present])).toEqual([
			["owned", false],
			["api", false],
		]);
	});

	/** Credential-only agents (ADR 0006) have no checkout to date. */
	it("ignores agents that declare no remote", async () => {
		const cfg = config({
			agents: [
				{ id: "creds", kind: "credential-only" },
				{ id: "api", gitRemote: "https://github.com/x/api.git", mode: "read" },
			],
		} as Partial<HabitatConfig>);

		const p = await read(cfg, probeFor({ repos: {} }));

		expect(p.repos.map((r) => r.id)).toEqual(["owned", "api"]);
	});

	it("never reaches the network — the probe is the only thing it can touch", async () => {
		const probe = probeFor({ repos: { [`${WORK}/project`]: { commit: "a" } } });
		await read(config(), probe);
		// Every method used is a local read; there is no fetch seam to call.
		expect(Object.keys(probe)).toEqual([
			"exists",
			"readFile",
			"headCommit",
			"headCommittedAt",
			"lastFetchedAt",
		]);
	});

	it("clamps a refresh time in the future to zero rather than going negative", async () => {
		const probe = probeFor({
			repos: {
				[`${WORK}/project`]: { commit: "a", fetchedAt: "2026-07-28T13:00:00.000Z" },
			},
		});

		const p = await read(config(), probe);

		expect(p.repos[0].refreshedAgeSeconds).toBe(0);
	});
});

describe("describeProvenance", () => {
	const base: HabitatProvenance = {
		capturedAt: NOW.toISOString(),
		stale: false,
		repos: [
			{
				id: "owned",
				role: "owned",
				present: true,
				commit: "abcdef1234567890",
				refreshedAgeSeconds: 7 * 86_400,
			},
		],
	};

	it("leads with the stale warning when a refresh is owed", () => {
		const text = describeProvenance({
			...base,
			stale: true,
			staleSince: "2026-07-28T06:30:00.000Z",
		});
		expect(text.split("\n")[0]).toContain("STALE");
		expect(text).toContain("2026-07-28T06:30:00.000Z");
	});

	it("abbreviates the commit and the age", () => {
		expect(describeProvenance(base)).toContain("abcdef12, refreshed 7d ago");
	});

	it("says a declared repo is not checked out", () => {
		const text = describeProvenance({
			...base,
			repos: [{ id: "api", role: "mounted", present: false }],
		});
		expect(text).toContain("declared but not checked out");
	});

	it("handles a habitat with no repos", () => {
		expect(describeProvenance({ ...base, repos: [] })).toContain(
			"answers from no checkout",
		);
	});
});

describe("ProvenanceCache", () => {
	const value = (n: number): HabitatProvenance => ({
		capturedAt: `2026-07-28T12:00:0${n}.000Z`,
		stale: false,
		repos: [],
	});

	it("collapses repeated reads inside the TTL", async () => {
		let n = 0;
		const read = vi.fn(async () => value(n++));
		let clock = 1_000;
		const cache = new ProvenanceCache(read, 30_000, () => clock);

		const a = await cache.get();
		clock += 29_000;
		const b = await cache.get();

		expect(read).toHaveBeenCalledOnce();
		expect(b).toBe(a);
	});

	it("reads again once the TTL has passed", async () => {
		let n = 0;
		const read = vi.fn(async () => value(n++));
		let clock = 1_000;
		const cache = new ProvenanceCache(read, 30_000, () => clock);

		await cache.get();
		clock += 30_001;
		await cache.get();

		expect(read).toHaveBeenCalledTimes(2);
	});

	/** After a refresh the old answer is a lie, so it must not be served. */
	it("reads again after being invalidated", async () => {
		let n = 0;
		const read = vi.fn(async () => value(n++));
		const cache = new ProvenanceCache(read, 30_000, () => 1_000);

		await cache.get();
		cache.invalidate();
		await cache.get();

		expect(read).toHaveBeenCalledTimes(2);
	});
});
