import { describe, it, expect, beforeEach } from "vitest";
import {
	toSourceSession,
	toSourceSessionFull,
	projectSessionEntry,
	projectSessions,
} from "./projector.js";
import { AdapterRegistry } from "../adapters/adapter.js";
import { PiSessionAdapter } from "../adapters/pi-adapter.js";
import type {
	NormalizedSessionEntry,
	NormalizedSession,
} from "../types/normalized-types.js";
import type { SourceSessionKind } from "../types/domain-types.js";
import type { SessionAdapter } from "../adapters/adapter.js";

// ── Fixtures ────────────────────────────────────────────────────────────

function makeEntry(
	overrides: Partial<NormalizedSessionEntry> = {},
): NormalizedSessionEntry {
	return {
		id: "claude-code-abc123",
		source: "claude-code",
		sourceId: "abc123",
		projectPath: "/projects/my-app",
		gitBranch: "main",
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

function makeFullSession(
	overrides: Partial<NormalizedSession> = {},
): NormalizedSession {
	return {
		id: "pi-session-001",
		source: "pi",
		sourceId: "019e1000-0000-7000-8000-000000000001",
		projectPath: "/projects/my-app",
		gitRepo: "my-app",
		created: "2026-05-10T10:00:00.000Z",
		modified: "2026-05-10T10:00:20.000Z",
		messages: [
			{
				id: "m1",
				role: "user",
				content: "Add error handling to the auth module",
				timestamp: "2026-05-10T10:00:02.000Z",
			},
			{
				id: "m2",
				role: "assistant",
				content: "I will add error handling.",
				timestamp: "2026-05-10T10:00:10.000Z",
			},
		],
		messageCount: 2,
		firstPrompt: "Add error handling to the auth module",
		sourceData: { cwd: "/projects/my-app", branchCount: 0 },
		...overrides,
	};
}

// ── toSourceSession ─────────────────────────────────────────────────────

describe("toSourceSession", () => {
	it("converts a claude-code entry to a SourceSession", () => {
		const entry = makeEntry();
		const source = toSourceSession(entry, "claude-code");

		expect(source.id).toBe("claude-code-abc123");
		expect(source.source).toBe("claude-code");
		expect(source.sourceId).toBe("abc123");
		expect(source.projectPath).toBe("/projects/my-app");
		expect(source.messageCount).toBe(24);
		expect(source.firstPrompt).toBe(
			"The auth token is expiring before the refresh completes",
		);
	});

	it("preserves metrics", () => {
		const entry = makeEntry();
		const source = toSourceSession(entry, "cursor");

		expect(source.metrics).toBeDefined();
		expect(source.metrics!.userMessages).toBe(6);
		expect(source.metrics!.assistantMessages).toBe(8);
		expect(source.metrics!.toolCalls).toBe(10);
		expect(source.metrics!.totalTokens).toBe(45000);
		expect(source.metrics!.estimatedCost).toBe(0.15);
	});

	it("handles entries without metrics", () => {
		const entry = makeEntry({ metrics: undefined });
		const source = toSourceSession(entry, "pi");

		expect(source.metrics).toBeUndefined();
	});

	it("truncates long titles to 80 characters", () => {
		const longPrompt = "A".repeat(200);
		const entry = makeEntry({ firstPrompt: longPrompt });
		const source = toSourceSession(entry, "native");

		expect(source.title.length).toBeLessThanOrEqual(83); // 80 + '...'
		expect(source.title.endsWith("...")).toBe(true);
	});

	it("uses empty title for empty firstPrompt", () => {
		const entry = makeEntry({ firstPrompt: "" });
		const source = toSourceSession(entry, "claude-code");

		expect(source.title).toBe("");
	});

	it("carries sourceData through", () => {
		const entry = makeEntry({
			sourceData: { filename: "session.jsonl", displayName: "Refactor" },
		});
		const source = toSourceSession(entry, "pi");

		expect(source.sourceData?.filename).toBe("session.jsonl");
		expect(source.sourceData?.displayName).toBe("Refactor");
	});
});

// ── toSourceSessionFull ─────────────────────────────────────────────────

describe("toSourceSessionFull", () => {
	it("converts a full NormalizedSession to a SourceSession", () => {
		const session = makeFullSession();
		const source = toSourceSessionFull(session);

		expect(source.id).toBe("pi-session-001");
		expect(source.source).toBe("pi");
		expect(source.messageCount).toBe(2);
		expect(source.firstPrompt).toBe("Add error handling to the auth module");
	});

	it("preserves gitRepo and sourceData", () => {
		const session = makeFullSession({ gitRepo: "my-app" });
		const source = toSourceSessionFull(session);

		expect(source.gitRepo).toBe("my-app");
		expect(source.sourceData?.cwd).toBe("/projects/my-app");
	});
});

// ── projectSessionEntry ─────────────────────────────────────────────────

describe("projectSessionEntry", () => {
	it("creates a default Exploration from a session entry", () => {
		const entry = makeEntry();
		const exploration = projectSessionEntry(entry, "claude-code");

		expect(exploration.kind).toBe("default");
		expect(exploration.name).toBe(
			"The auth token is expiring before the refresh completes",
		);
		expect(exploration.members).toHaveLength(1);
		expect(exploration.members[0].sourceSessionId).toBe("claude-code-abc123");
		expect(exploration.members[0].source).toBe("claude-code");
		expect(exploration.memberCount).toBe(1);
	});

	it("works for pi sessions", () => {
		const entry = makeEntry({
			id: "pi-encoded-001",
			source: "pi",
			sourceId: "019e-1234",
			firstPrompt: "Refactor auth module",
		});
		const exploration = projectSessionEntry(entry, "pi");

		expect(exploration.id).toMatch(/^exp-default-pi-/);
		expect(exploration.name).toBe("Refactor auth module");
		expect(exploration.members[0].source).toBe("pi");
	});
});

// ── projectSessions ─────────────────────────────────────────────────────

describe("projectSessions", () => {
	let registry: AdapterRegistry;

	beforeEach(() => {
		registry = new AdapterRegistry();

		// Register a mock Claude Code adapter
		const mockClaudeAdapter: SessionAdapter = {
			source: "claude-code",
			displayName: "Claude Code",
			getSourceLocation: () => "",
			canHandle: async () => true,
			discoverProjects: async () => ["/projects/my-app"],
			discoverSessions: async () => ({
				sessions: [
					makeEntry({
						id: "cc-session-1",
						source: "claude-code",
						sourceId: "cc-1",
						firstPrompt: "Set up CI/CD pipeline",
						messageCount: 15,
						created: "2026-05-13T08:00:00.000Z",
						modified: "2026-05-13T09:00:00.000Z",
					}),
					makeEntry({
						id: "cc-session-2",
						source: "claude-code",
						sourceId: "cc-2",
						firstPrompt: "Fix database migration",
						messageCount: 8,
						created: "2026-05-12T10:00:00.000Z",
						modified: "2026-05-12T11:00:00.000Z",
					}),
				],
				source: "claude-code",
				totalCount: 2,
				hasMore: false,
			}),
			getSessionEntry: async () => null,
			getSession: async () => null,
			getMessages: async () => [],
			hasSessionsForProject: async () => true,
		};

		// Register a mock Pi adapter
		const mockPiAdapter: SessionAdapter = {
			source: "pi",
			displayName: "pi",
			getSourceLocation: () => "",
			canHandle: async () => true,
			discoverProjects: async () => ["/projects/my-app"],
			discoverSessions: async () => ({
				sessions: [
					makeEntry({
						id: "pi-session-1",
						source: "pi",
						sourceId: "pi-001",
						firstPrompt: "Add error handling",
						messageCount: 6,
						sourceData: { branchCount: 2, compactionCount: 1 },
					}),
				],
				source: "pi",
				totalCount: 1,
				hasMore: false,
			}),
			getSessionEntry: async () => null,
			getSession: async () => null,
			getMessages: async () => [],
			hasSessionsForProject: async () => true,
		};

		registry.register(mockClaudeAdapter);
		registry.register(mockPiAdapter);
	});

	it("projects all sessions from all adapters", async () => {
		const result = await projectSessions("/projects/my-app", { registry });

		expect(result.explorations).toHaveLength(3); // 2 claude + 1 pi
		expect(result.sources).toHaveLength(2);
	});

	it("returns per-source breakdown", async () => {
		const result = await projectSessions("/projects/my-app", { registry });

		const claudeSource = result.sources.find((s) => s.source === "claude-code");
		const piSource = result.sources.find((s) => s.source === "pi");

		expect(claudeSource).toBeDefined();
		expect(claudeSource!.sessionCount).toBe(2);
		expect(claudeSource!.explorationCount).toBe(2);

		expect(piSource).toBeDefined();
		expect(piSource!.sessionCount).toBe(1);
		expect(piSource!.explorationCount).toBe(1);
	});

	it("Explorations have correct kinds and members", async () => {
		const result = await projectSessions("/projects/my-app", { registry });

		for (const exploration of result.explorations) {
			expect(exploration.kind).toBe("default");
			expect(exploration.members).toHaveLength(1);
			expect(exploration.memberCount).toBe(1);
			expect(exploration.members[0].kind).toBe("reference");
		}
	});

	it("preserves source identity in exploration names", async () => {
		const result = await projectSessions("/projects/my-app", { registry });

		const names = result.explorations.map((e) => e.name);
		expect(names).toContain("Set up CI/CD pipeline");
		expect(names).toContain("Fix database migration");
		expect(names).toContain("Add error handling");
	});

	it("handles empty project with no sessions", async () => {
		const emptyRegistry = new AdapterRegistry();

		const result = await projectSessions("/projects/empty", {
			registry: emptyRegistry,
		});
		expect(result.explorations).toHaveLength(0);
		expect(result.sources).toHaveLength(0);
	});

	it("handles adapters that error gracefully", async () => {
		const errorAdapter: SessionAdapter = {
			source: "cursor",
			displayName: "Cursor",
			getSourceLocation: () => "",
			canHandle: async () => false,
			discoverProjects: async () => [],
			discoverSessions: async () => {
				throw new Error("Adapter unavailable");
			},
			getSessionEntry: async () => null,
			getSession: async () => null,
			getMessages: async () => [],
			hasSessionsForProject: async () => false,
		};

		const errorRegistry = new AdapterRegistry();
		errorRegistry.register(mockClaudeAdapter()); // Need to register directly
		errorRegistry.register(errorAdapter);

		const result = await projectSessions("/projects/my-app", {
			registry: errorRegistry,
		});
		// Should still get claude-code sessions even though cursor errored
		expect(result.explorations.length).toBeGreaterThanOrEqual(2);
	});
});

// Helper to create a claude-code adapter inline
function mockClaudeAdapter(): SessionAdapter {
	return {
		source: "claude-code",
		displayName: "Claude Code",
		getSourceLocation: () => "",
		canHandle: async () => true,
		discoverProjects: async () => ["/projects/my-app"],
		discoverSessions: async () => ({
			sessions: [
				makeEntry({
					id: "cc-session-1",
					source: "claude-code",
					sourceId: "cc-1",
					firstPrompt: "Set up CI/CD pipeline",
					messageCount: 15,
					created: "2026-05-13T08:00:00.000Z",
					modified: "2026-05-13T09:00:00.000Z",
				}),
				makeEntry({
					id: "cc-session-2",
					source: "claude-code",
					sourceId: "cc-2",
					firstPrompt: "Fix database migration",
					messageCount: 8,
					created: "2026-05-12T10:00:00.000Z",
					modified: "2026-05-12T11:00:00.000Z",
				}),
			],
			source: "claude-code",
			totalCount: 2,
			hasMore: false,
		}),
		getSessionEntry: async () => null,
		getSession: async () => null,
		getMessages: async () => [],
		hasSessionsForProject: async () => true,
	};
}
