import { describe, it, expect } from "vitest";
import {
	createDefaultExploration,
	createVirtualExploration,
	type SourceSession,
	type Exploration,
	type SavedExploration,
	type ExplorationMember,
	type SourceSessionMetrics,
} from "./domain-types.js";

// ── Fixtures ────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SourceSession> = {}): SourceSession {
	return {
		id: "src-claude-abc123",
		source: "claude-code",
		sourceId: "abc123",
		title: "Fix auth token refresh",
		projectPath: "/projects/my-app",
		gitBranch: "main",
		gitRepo: "my-app",
		created: "2026-05-14T10:00:00.000Z",
		modified: "2026-05-14T11:30:00.000Z",
		messageCount: 24,
		firstPrompt: "The auth token is expiring before the refresh completes",
		metrics: {
			userMessages: 6,
			assistantMessages: 8,
			toolCalls: 10,
			totalTokens: 45000,
			inputTokens: 30000,
			outputTokens: 15000,
			cacheReadTokens: 5000,
			cacheWriteTokens: 2000,
			estimatedCost: 0.15,
		},
		...overrides,
	};
}

// ── SourceSession ───────────────────────────────────────────────────────

describe("SourceSession", () => {
	it("constructs a minimal session without optional fields", () => {
		const session: SourceSession = {
			id: "src-pi-001",
			source: "pi",
			sourceId: "001",
			title: "",
			created: "2026-01-01T00:00:00.000Z",
			modified: "2026-01-01T01:00:00.000Z",
			messageCount: 0,
			firstPrompt: "",
		};
		expect(session.id).toBe("src-pi-001");
		expect(session.source).toBe("pi");
	});

	it("accepts all known source kinds", () => {
		const kinds: SourceSession["source"][] = [
			"pi",
			"claude-code",
			"cursor",
			"habitat" as any, // habitat isn't in SessionSource yet but is valid
			"native",
			"unknown",
		];
		for (const source of kinds) {
			const s: SourceSession = makeSession({
				source: source as any,
				id: `src-${source}`,
			});
			expect(s.source).toBe(source);
		}
	});

	it("holds optional metrics", () => {
		const metrics: SourceSessionMetrics = {
			userMessages: 6,
			assistantMessages: 8,
			toolCalls: 10,
			estimatedCost: 0.08,
		};
		const session = makeSession({ metrics });
		expect(session.metrics?.estimatedCost).toBe(0.08);
	});

	it("carries source-specific data", () => {
		const session = makeSession({
			sourceData: {
				fullPath: "/home/user/.claude/sessions/abc.jsonl",
				model: "claude-sonnet-4",
			},
		});
		expect(session.sourceData?.fullPath).toBe(
			"/home/user/.claude/sessions/abc.jsonl",
		);
	});
});

// ── createDefaultExploration ────────────────────────────────────────────

describe("createDefaultExploration", () => {
	it("uses the session title as the exploration name", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		expect(exploration.name).toBe("Fix auth token refresh");
	});

	it("falls back to firstPrompt when title is empty", () => {
		const session = makeSession({ title: "" });
		const { exploration } = createDefaultExploration(session);
		expect(exploration.name).toBe(
			"The auth token is expiring before the refresh completes",
		);
	});

	it("falls back to a generic label when both title and firstPrompt are empty", () => {
		const session = makeSession({
			title: "",
			firstPrompt: "",
			id: "fallback-test",
		});
		const { exploration } = createDefaultExploration(session);
		expect(exploration.name).toContain("fallback-test");
	});

	it("produces a default-kind exploration", () => {
		const { exploration } = createDefaultExploration(makeSession());
		expect(exploration.kind).toBe("default");
	});

	it("creates one reference member pointing back to the source session", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		expect(exploration.members).toHaveLength(1);
		expect(exploration.members[0].kind).toBe("reference");
		expect(exploration.members[0].sourceSessionId).toBe(session.id);
		expect(exploration.members[0].source).toBe(session.source);
	});

	it("sets created/modified timestamps from the source session", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		expect(exploration.created).toBe(session.created);
		expect(exploration.modified).toBe(session.modified);
	});

	it("returns the source session in the result", () => {
		const session = makeSession();
		const result = createDefaultExploration(session);
		expect(result.sourceSession).toBe(session);
	});

	it("produces valid exploration ids", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		expect(exploration.id).toMatch(/^exp-default-/);
	});
});

// ── createVirtualExploration ────────────────────────────────────────────

describe("createVirtualExploration", () => {
	it("creates a virtual-kind exploration with a search name", () => {
		const session = makeSession();
		const exploration = createVirtualExploration("oauth token", [session]);
		expect(exploration.kind).toBe("virtual");
		expect(exploration.name).toBe("Search: oauth token");
		expect(exploration.searchQuery).toBe("oauth token");
	});

	it("includes all matched sessions as members", () => {
		const s1 = makeSession({ id: "s1", title: "Auth" });
		const s2 = makeSession({ id: "s2", title: "Tokens" });
		const exploration = createVirtualExploration("auth tokens", [s1, s2]);
		expect(exploration.members).toHaveLength(2);
		expect(exploration.memberCount).toBe(2);
		expect(exploration.members[0].sourceSessionId).toBe("s1");
		expect(exploration.members[1].sourceSessionId).toBe("s2");
	});

	it("handles empty result sets", () => {
		const exploration = createVirtualExploration("nothing", []);
		expect(exploration.members).toHaveLength(0);
		expect(exploration.memberCount).toBe(0);
	});

	it("timestamps at creation time", () => {
		const before = new Date().toISOString();
		const exploration = createVirtualExploration("test", [makeSession()]);
		const after = new Date().toISOString();
		expect(exploration.created).toBeDefined();
		expect(exploration.created >= before && exploration.created <= after).toBe(
			true,
		);
	});
});

// ── SavedExploration shape ──────────────────────────────────────────────

describe("SavedExploration", () => {
	it("matches the expected v1 schema", () => {
		const saved: SavedExploration = {
			version: 1,
			id: "exp-saved-fix-auth",
			name: "Fix auth token refresh",
			saved: "2026-05-14T12:00:00.000Z",
			members: [
				{
					kind: "reference",
					sourceSessionId: "src-claude-abc123",
					source: "claude-code",
					label: "main fix",
				},
			],
		};
		expect(saved.version).toBe(1);
		expect(saved.members[0].kind).toBe("reference");
		expect(saved.members[0].label).toBe("main fix");
	});
});

// ── Exploration invariants ──────────────────────────────────────────────

describe("Exploration invariants", () => {
	it("default explorations have memberCount matching members length", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		expect(exploration.memberCount).toBe(exploration.members.length);
	});

	it("virtual explorations have no savedPath", () => {
		const exploration = createVirtualExploration("test", [makeSession()]);
		expect(exploration.savedPath).toBeUndefined();
	});

	it("default explorations have no searchQuery", () => {
		const { exploration } = createDefaultExploration(makeSession());
		expect(exploration.searchQuery).toBeUndefined();
	});

	it("virtual explorations have a searchQuery", () => {
		const exploration = createVirtualExploration("find me", [makeSession()]);
		expect(exploration.searchQuery).toBe("find me");
	});
});

// ── Type-level assertions (compile-time checks) ─────────────────────────

describe("type-level contracts", () => {
	it('ExplorationMember kind is narrowed to "reference" in v1', () => {
		const member: ExplorationMember = {
			kind: "reference",
			sourceSessionId: "x",
			source: "pi",
		};
		// Accessing kind as a literal — this is a compile-time check
		// (if the union were widened, the test wouldn't change but the types would)
		expect(member.kind).toBe("reference");
	});

	it("SourceSession id is always a string", () => {
		const s: SourceSession = {
			id: "any-string",
			source: "native",
			sourceId: "also-a-string",
			title: "",
			created: "",
			modified: "",
			messageCount: 5,
			firstPrompt: "hello",
		};
		expect(typeof s.id).toBe("string");
	});
});
