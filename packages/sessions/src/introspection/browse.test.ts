import { describe, it, expect } from "vitest";
import {
	applyExploreFilter,
	type ExplorationBrowserEntry,
	type FilterState,
} from "./browse.js";
import type {
	Exploration,
	SourceSession,
} from "@umwelten/core/interaction/types/domain-types.js";
import { createDefaultExploration } from "@umwelten/core/interaction/types/domain-types.js";

// ── Fixtures ────────────────────────────────────────────────────────────

function makeSourceSession(
	overrides: Partial<SourceSession> = {},
): SourceSession {
	return {
		id: "src-cc-abc123",
		source: "claude-code",
		sourceId: "abc123",
		title: "Set up CI/CD pipeline",
		projectPath: "/projects/my-app",
		created: "2026-05-13T08:00:00.000Z",
		modified: "2026-05-13T09:00:00.000Z",
		messageCount: 15,
		firstPrompt: "Set up CI/CD pipeline",
		...overrides,
	};
}

function makeExploration(session: SourceSession): Exploration {
	return createDefaultExploration(session).exploration;
}

function makeExploreEntry(
	sessionOverrides: Partial<SourceSession> = {},
	entryOverrides: Partial<ExplorationBrowserEntry> = {},
): ExplorationBrowserEntry {
	const session = makeSourceSession(sessionOverrides);
	const exploration = makeExploration(session);
	return {
		exploration,
		sourceSession: session,
		modifiedMs: new Date(session.modified).getTime(),
		analyzedIn: [],
		modifiedSinceAnalysis: false,
		everAnalyzed: false,
		...entryOverrides,
	};
}

const defaultFilter: FilterState = {
	date: "all",
	status: "all",
	source: "all",
	query: "",
};

// ── applyExploreFilter ──────────────────────────────────────────────────

describe("applyExploreFilter", () => {
	it("returns all entries with default filter", () => {
		const entries = [
			makeExploreEntry({ id: "s1" }),
			makeExploreEntry({ id: "s2" }),
		];
		const result = applyExploreFilter(entries, defaultFilter);
		expect(result).toHaveLength(2);
	});

	describe("date filtering", () => {
		it("filters by 24h window", () => {
			const recent = makeExploreEntry({
				id: "recent",
				modified: new Date().toISOString(),
			});
			const old = makeExploreEntry({
				id: "old",
				modified: "2025-01-01T00:00:00.000Z",
			});
			const result = applyExploreFilter([recent, old], {
				...defaultFilter,
				date: "24h",
			});
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.id).toBe("recent");
		});

		it("filters by 7d window", () => {
			const recent = makeExploreEntry({
				id: "recent",
				modified: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
			});
			const old = makeExploreEntry({
				id: "old",
				modified: "2025-01-01T00:00:00.000Z",
			});
			const result = applyExploreFilter([recent, old], {
				...defaultFilter,
				date: "7d",
			});
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.id).toBe("recent");
		});
	});

	describe("source filtering", () => {
		it("filters by source type", () => {
			const cc = makeExploreEntry({ id: "cc-1", source: "claude-code" });
			const pi = makeExploreEntry({ id: "pi-1", source: "pi" });
			const result = applyExploreFilter([cc, pi], {
				...defaultFilter,
				source: "pi",
			});
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.source).toBe("pi");
		});
	});

	describe("status filtering", () => {
		it("filters for unanalyzed entries", () => {
			const unanalyzed = makeExploreEntry(
				{ id: "u1" },
				{ everAnalyzed: false },
			);
			const analyzed = makeExploreEntry(
				{ id: "a1" },
				{
					everAnalyzed: true,
					analyzedIn: [
						{
							runId: "r1",
							runCreatedAt: "2026-05-13T10:00:00Z",
							tally: { total: 1, accepted: 0, skipped: 0, pending: 0 },
							attributedProposals: [],
						},
					],
				},
			);
			const result = applyExploreFilter([unanalyzed, analyzed], {
				...defaultFilter,
				status: "unanalyzed",
			});
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.id).toBe("u1");
		});

		it("filters for pending entries", () => {
			const pending = makeExploreEntry(
				{ id: "p1" },
				{
					analyzedIn: [
						{
							runId: "r1",
							runCreatedAt: "2026-05-13T10:00:00Z",
							tally: { total: 2, accepted: 0, skipped: 0, pending: 2 },
							attributedProposals: [],
						},
					],
				},
			);
			const done = makeExploreEntry(
				{ id: "d1" },
				{
					analyzedIn: [
						{
							runId: "r2",
							runCreatedAt: "2026-05-13T10:00:00Z",
							tally: { total: 1, accepted: 1, skipped: 0, pending: 0 },
							attributedProposals: [],
						},
					],
				},
			);
			const result = applyExploreFilter([pending, done], {
				...defaultFilter,
				status: "pending",
			});
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.id).toBe("p1");
		});

		it("filters for digested entries", () => {
			const digested = makeExploreEntry(
				{ id: "dig-1" },
				{
					digest: {
						sessionId: "dig-1",
						overallSummary: "Good session",
						analysis: { tags: ["auth"], topics: ["login"] },
					} as any,
				},
			);
			const undigested = makeExploreEntry({ id: "undig-1" });
			const result = applyExploreFilter([digested, undigested], {
				...defaultFilter,
				status: "digested",
			});
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.id).toBe("dig-1");
		});

		it("filters for undigested entries", () => {
			const digested = makeExploreEntry(
				{ id: "dig-1" },
				{
					digest: {
						sessionId: "dig-1",
						overallSummary: "Good session",
						analysis: { tags: ["auth"], topics: ["login"] },
					} as any,
				},
			);
			const undigested = makeExploreEntry({ id: "undig-1" });
			const result = applyExploreFilter([digested, undigested], {
				...defaultFilter,
				status: "undigested",
			});
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.id).toBe("undig-1");
		});
	});

	describe("text query filtering", () => {
		it("matches against exploration name", () => {
			const match = makeExploreEntry({
				id: "m1",
				title: "Fix database migration",
			});
			const noMatch = makeExploreEntry({ id: "nm1", title: "Set up CI/CD" });
			const result = applyExploreFilter([match, noMatch], {
				...defaultFilter,
				query: "database",
			});
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.id).toBe("m1");
		});

		it("matches against session ID", () => {
			const entry = makeExploreEntry({ id: "src-cc-abc123" });
			const result = applyExploreFilter([entry], {
				...defaultFilter,
				query: "abc123",
			});
			expect(result).toHaveLength(1);
		});

		it("matches against digest tags and topics", () => {
			const entry = makeExploreEntry(
				{ id: "m1" },
				{
					digest: {
						sessionId: "m1",
						overallSummary: "",
						analysis: {
							tags: ["oauth", "jwt"],
							topics: ["authentication", "security"],
						},
					} as any,
				},
			);
			const result = applyExploreFilter([entry], {
				...defaultFilter,
				query: "jwt",
			});
			expect(result).toHaveLength(1);
		});

		it("returns empty for no matches", () => {
			const entry = makeExploreEntry({ id: "m1", title: "Fix bugs" });
			const result = applyExploreFilter([entry], {
				...defaultFilter,
				query: "zzz_nonexistent",
			});
			expect(result).toHaveLength(0);
		});
	});

	describe("combined filters", () => {
		it("applies date + source + query together", () => {
			const match = makeExploreEntry({
				id: "m1",
				source: "pi",
				title: "Add error handling",
				modified: new Date().toISOString(),
			});
			const wrongSource = makeExploreEntry({
				id: "ws1",
				source: "claude-code",
				title: "Add error handling",
				modified: new Date().toISOString(),
			});
			const wrongDate = makeExploreEntry({
				id: "wd1",
				source: "pi",
				title: "Old error handling",
				modified: "2025-01-01T00:00:00.000Z",
			});
			const wrongQuery = makeExploreEntry({
				id: "wq1",
				source: "pi",
				title: "Set up CI/CD",
				modified: new Date().toISOString(),
			});

			const result = applyExploreFilter(
				[match, wrongSource, wrongDate, wrongQuery],
				{ date: "30d", source: "pi", status: "all", query: "error" },
			);
			expect(result).toHaveLength(1);
			expect(result[0].sourceSession.id).toBe("m1");
		});
	});
});

// ── ExplorationBrowserEntry shape ───────────────────────────────────────

describe("ExplorationBrowserEntry shape", () => {
	it("wraps an Exploration and SourceSession", () => {
		const entry = makeExploreEntry({
			id: "src-pi-001",
			source: "pi",
			title: "Refactor auth module",
		});

		expect(entry.exploration.kind).toBe("default");
		expect(entry.exploration.name).toBe("Refactor auth module");
		expect(entry.sourceSession.source).toBe("pi");
		expect(entry.sourceSession.id).toBe("src-pi-001");
		expect(typeof entry.modifiedMs).toBe("number");
	});

	it("carries analysis metadata", () => {
		const entry = makeExploreEntry(
			{ id: "analyzed-session" },
			{
				everAnalyzed: true,
				modifiedSinceAnalysis: false,
				analyzedIn: [
					{
						runId: "run-001",
						runCreatedAt: "2026-05-13T10:00:00Z",
						tally: { total: 3, accepted: 2, skipped: 0, pending: 1 },
						attributedProposals: [
							{ kind: "workflowRule", head: "Use pnpm", verdict: "accepted" },
						],
					},
				],
			},
		);

		expect(entry.everAnalyzed).toBe(true);
		expect(entry.analyzedIn).toHaveLength(1);
		expect(entry.analyzedIn[0].tally.total).toBe(3);
	});

	it("carries digest data when available", () => {
		const entry = makeExploreEntry(
			{ id: "digested" },
			{
				digest: {
					sessionId: "digested",
					overallSummary: "Resolved auth token refresh issue",
					analysis: { tags: ["auth"], topics: ["token-refresh"] },
				} as any,
			},
		);

		expect(entry.digest).toBeDefined();
		expect(entry.digest!.overallSummary).toContain("auth token");
	});
});

// ── searchToVirtualExploration ──────────────────────────────────────────

describe("searchToVirtualExploration", () => {
	it("creates a virtual exploration from matching entries", async () => {
		const entries = [
			makeExploreEntry({ id: "s1", title: "Fix database migration" }),
			makeExploreEntry({ id: "s2", title: "Set up CI/CD pipeline" }),
		];

		const { searchToVirtualExploration } = await import("./browse.js");
		const result = searchToVirtualExploration(entries, "database");

		expect(result.query).toBe("database");
		expect(result.exploration.kind).toBe("virtual");
		expect(result.exploration.searchQuery).toBe("database");
		expect(result.matches).toHaveLength(1);
		expect(result.matches[0].sourceSession.id).toBe("s1");
		expect(result.totalSearched).toBe(2);
	});

	it("includes all matching entries as members", async () => {
		const entries = [
			makeExploreEntry({ id: "s1", title: "Auth tokens JWT" }),
			makeExploreEntry({ id: "s2", title: "OAuth refresh tokens" }),
			makeExploreEntry({ id: "s3", title: "Database indexes" }),
		];

		const { searchToVirtualExploration } = await import("./browse.js");
		const result = searchToVirtualExploration(entries, "token");

		expect(result.matches).toHaveLength(2);
		expect(result.exploration.members).toHaveLength(2);
		expect(result.exploration.memberCount).toBe(2);
	});

	it("returns empty result for no matches", async () => {
		const entries = [makeExploreEntry({ id: "s1", title: "Fix bugs" })];

		const { searchToVirtualExploration } = await import("./browse.js");
		const result = searchToVirtualExploration(entries, "zzz_nonexistent");

		expect(result.matches).toHaveLength(0);
		expect(result.exploration.members).toHaveLength(0);
		expect(result.exploration.memberCount).toBe(0);
	});

	it("handles empty query gracefully", async () => {
		const entries = [makeExploreEntry({ id: "s1", title: "Fix bugs" })];

		const { searchToVirtualExploration } = await import("./browse.js");
		const result = searchToVirtualExploration(entries, "");

		expect(result.matches).toHaveLength(0);
		expect(result.exploration.searchQuery).toBe("");
		expect(result.exploration.kind).toBe("virtual");
	});

	it("matches against digest tags and topics", async () => {
		const entries = [
			makeExploreEntry(
				{ id: "s1", title: "Auth work" },
				{
					digest: {
						sessionId: "s1",
						overallSummary: "",
						analysis: {
							tags: ["oauth", "jwt"],
							topics: ["authentication"],
						},
					} as any,
				},
			),
			makeExploreEntry({ id: "s2", title: "CI/CD" }),
		];

		const { searchToVirtualExploration } = await import("./browse.js");
		const result = searchToVirtualExploration(entries, "jwt");

		expect(result.matches).toHaveLength(1);
		expect(result.matches[0].sourceSession.id).toBe("s1");
	});

	it("matches against session ID", async () => {
		const entries = [makeExploreEntry({ id: "src-cc-special-id", title: "Work" })];

		const { searchToVirtualExploration } = await import("./browse.js");
		const result = searchToVirtualExploration(entries, "special-id");

		expect(result.matches).toHaveLength(1);
	});

	it("exposes total searched count", async () => {
		const entries = Array.from({ length: 10 }, (_, i) =>
			makeExploreEntry({ id: `s${i}`, title: `Session ${i}` }),
		);

		const { searchToVirtualExploration } = await import("./browse.js");
		const result = searchToVirtualExploration(entries, "Session");

		expect(result.totalSearched).toBe(10);
		expect(result.matches).toHaveLength(10);
	});
});
