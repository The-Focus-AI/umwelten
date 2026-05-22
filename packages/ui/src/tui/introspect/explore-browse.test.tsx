import { describe, it, expect } from "vitest";
import type { ExplorationBrowserEntry } from "@umwelten/sessions/introspection/browse.js";
import type { SourceSession } from "@umwelten/core/interaction/types/domain-types.js";
import { createDefaultExploration } from "@umwelten/core/interaction/types/domain-types.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeSourceSession(
	overrides: Partial<SourceSession> = {},
): SourceSession {
	return {
		id: "src-cc-test-001",
		source: "claude-code",
		sourceId: "test-001",
		title: "Fix database migration timeout",
		created: "2026-05-14T10:00:00.000Z",
		modified: "2026-05-14T11:00:00.000Z",
		messageCount: 24,
		firstPrompt: "Fix database migration timeout",
		...overrides,
	};
}

function makePiSession(overrides: Partial<SourceSession> = {}): SourceSession {
	return makeSourceSession({
		id: "src-pi-test-002",
		source: "pi",
		sourceId: "pi-002",
		title: "Add error handling to auth",
		sourceData: {
			filename: "2026-05-10T10-00-00Z_session.jsonl",
			cwd: "/projects/my-app",
			displayName: "Refactor auth module",
			branchCount: 2,
			compactionCount: 1,
			labels: { entry1: "jwt-implemented", entry2: "refresh-added" },
		},
		...overrides,
	});
}

function makeExploreEntry(session: SourceSession): ExplorationBrowserEntry {
	const { exploration } = createDefaultExploration(session);
	return {
		exploration,
		sourceSession: session,
		modifiedMs: new Date(session.modified).getTime(),
		filePath: session.source === "pi" ? "/tmp/session.jsonl" : undefined,
		analyzedIn: [],
		modifiedSinceAnalysis: false,
		everAnalyzed: false,
	};
}

// ── Exploration data helpers ────────────────────────────────────────────

describe("Exploration data helpers", () => {
	it("shows pi metadata in entries", () => {
		const session = makePiSession();
		const entry = makeExploreEntry(session);

		expect(entry.sourceSession.source).toBe("pi");
		expect(entry.sourceSession.sourceData?.displayName).toBe(
			"Refactor auth module",
		);
		expect(entry.sourceSession.sourceData?.branchCount).toBe(2);
		expect(entry.sourceSession.sourceData?.compactionCount).toBe(1);
		expect(entry.sourceSession.sourceData?.labels).toBeDefined();
		expect(
			Object.keys(
				entry.sourceSession.sourceData!.labels as Record<string, string>,
			).length,
		).toBe(2);
	});

	it("shows source session membership in entry", () => {
		const session = makeSourceSession();
		const entry = makeExploreEntry(session);

		expect(entry.exploration.members).toHaveLength(1);
		expect(entry.exploration.members[0].sourceSessionId).toBe(
			"src-cc-test-001",
		);
		expect(entry.exploration.members[0].source).toBe("claude-code");
	});

	it("formats pi metadata", () => {
		const session = makePiSession();
		const entry = makeExploreEntry(session);

		expect(entry.filePath).toBeDefined();
		expect(entry.exploration.name).toBe("Add error handling to auth");
		expect(entry.sourceSession.messageCount).toBe(24);
	});

	it("handles sessions without file paths", () => {
		const session = makeSourceSession();
		const entry = makeExploreEntry(session);

		expect(entry.filePath).toBeUndefined();
	});

	it("Exploration has default kind", () => {
		const session = makeSourceSession();
		const entry = makeExploreEntry(session);

		expect(entry.exploration.kind).toBe("default");
		expect(entry.exploration.memberCount).toBe(1);
	});

	it("carries analysis metadata on entry", () => {
		const session = makeSourceSession();
		const entry = makeExploreEntry(session);
		Object.assign(entry, {
			everAnalyzed: true,
			modifiedSinceAnalysis: false,
			analyzedIn: [
				{
					runId: "run-001",
					runCreatedAt: "2026-05-13T10:00:00Z",
					tally: { total: 3, accepted: 2, skipped: 0, pending: 1 },
					attributedProposals: [
						{
							kind: "workflowRule" as const,
							head: "Use pnpm",
							verdict: "accepted" as const,
						},
					],
				},
			],
		});

		expect(entry.everAnalyzed).toBe(true);
		expect(entry.analyzedIn).toHaveLength(1);
		expect(entry.analyzedIn[0].tally.total).toBe(3);
	});

	it("supports multiple source types", () => {
		const sources: Array<{ source: SourceSession["source"]; id: string }> = [
			{ source: "claude-code", id: "cc-1" },
			{ source: "pi", id: "pi-1" },
			{ source: "cursor", id: "c-1" },
		];

		for (const { source, id } of sources) {
			const session = makeSourceSession({
				source: source as SourceSession["source"],
				id,
			});
			const entry = makeExploreEntry(session);
			expect(entry.sourceSession.source).toBe(source);
			expect(entry.sourceSession.id).toBe(id);
		}
	});
});

// ── resolveSessionFilePath ──────────────────────────────────────────────

describe("resolveSessionFilePath", () => {
	it("resolves pi session file path from sourceData", async () => {
		const { resolveSessionFilePath } = await import(
			"@umwelten/sessions/introspection/browse.js"
		);

		const path = resolveSessionFilePath("pi", "pi-session-1", {
			filename: "2026-05-10T10-00-00Z_session.jsonl",
			cwd: "/projects/my-app",
		});

		expect(path).toBeDefined();
		expect(path).toContain(".pi/agent/sessions/");
		expect(path).toContain("session.jsonl");
	});

	it("returns undefined for unknown source", async () => {
		const { resolveSessionFilePath } = await import(
			"@umwelten/sessions/introspection/browse.js"
		);

		const path = resolveSessionFilePath("cursor" as any, "cursor-session", {});
		expect(path).toBeUndefined();
	});

	it("returns undefined for pi without filename in sourceData", async () => {
		const { resolveSessionFilePath } = await import(
			"@umwelten/sessions/introspection/browse.js"
		);

		const path = resolveSessionFilePath("pi", "pi-session-1", { cwd: "/test" });
		expect(path).toBeUndefined();
	});
});
