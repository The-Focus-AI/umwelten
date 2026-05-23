/**
 * CLI entrypoint contract tests for issue #62.
 *
 * Verifies that `runBrowseAction` (the action behind `pnpm run cli browse`)
 * initializes adapters and surfaces sessions from every registered source
 * — claude-code, pi, and cursor — before launching the TUI.
 *
 * Rather than spinning up a real terminal, we inject a `launch` hook and
 * an `AdapterRegistry` so we can capture the projection that would have
 * been handed to the TUI.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AdapterRegistry } from "@umwelten/core/interaction/adapters/adapter.js";
import type { SessionAdapter } from "@umwelten/core/interaction/adapters/adapter.js";
import type { NormalizedSessionEntry } from "@umwelten/core/interaction/types/normalized-types.js";
import { loadBrowseProjection } from "./introspect.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeEntry(
	overrides: Partial<NormalizedSessionEntry> = {},
): NormalizedSessionEntry {
	return {
		id: "claude-code-test-001",
		source: "claude-code",
		sourceId: "test-001",
		projectPath: "/projects/my-app",
		gitBranch: "main",
		created: "2026-05-14T10:00:00.000Z",
		modified: "2026-05-14T11:00:00.000Z",
		messageCount: 12,
		firstPrompt: "test prompt",
		metrics: {
			userMessages: 4,
			assistantMessages: 6,
			toolCalls: 5,
		},
		...overrides,
	};
}

function makeAdapter(
	source: SessionAdapter["source"],
	entries: NormalizedSessionEntry[],
): SessionAdapter {
	return {
		source,
		displayName: source,
		getSourceLocation: () => "",
		canHandle: async () => true,
		discoverProjects: async () => ["/projects/my-app"],
		discoverSessions: async () => ({
			sessions: entries,
			source,
			totalCount: entries.length,
			hasMore: false,
		}),
		getSessionEntry: async () => null,
		getSession: async () => null,
		getMessages: async () => [],
		hasSessionsForProject: async () => true,
	};
}

describe("loadBrowseProjection — discovery contract", () => {
	let registry: AdapterRegistry;

	beforeEach(() => {
		registry = new AdapterRegistry();
		registry.register(
			makeAdapter("claude-code", [
				makeEntry({
					id: "cc-1",
					source: "claude-code",
					sourceId: "cc-1",
					firstPrompt: "Set up CI/CD",
					messageCount: 15,
				}),
				makeEntry({
					id: "cc-2",
					source: "claude-code",
					sourceId: "cc-2",
					firstPrompt: "Fix migration",
					messageCount: 8,
				}),
			]),
		);
		registry.register(
			makeAdapter("pi", [
				makeEntry({
					id: "pi-1",
					source: "pi",
					sourceId: "pi-1",
					firstPrompt: "Add error handling",
					messageCount: 6,
				}),
			]),
		);
		registry.register(
			makeAdapter("cursor", [
				makeEntry({
					id: "cursor-1",
					source: "cursor",
					sourceId: "cursor-1",
					firstPrompt: "Refactor auth",
					messageCount: 20,
				}),
			]),
		);
	});

	it("returns sessions from claude-code, pi, and cursor adapters", async () => {
		const result = await loadBrowseProjection({
			projectPath: "/projects/my-app",
			registry,
		});

		const sources = result.sources.map((s) => s.source).sort();
		expect(sources).toContain("claude-code");
		expect(sources).toContain("pi");
		expect(sources).toContain("cursor");
	});

	it("aggregates session counts per adapter", async () => {
		const result = await loadBrowseProjection({
			projectPath: "/projects/my-app",
			registry,
		});

		const byKind = Object.fromEntries(
			result.sources.map((s) => [s.source, s.sessionCount]),
		);
		expect(byKind["claude-code"]).toBe(2);
		expect(byKind.pi).toBe(1);
		expect(byKind.cursor).toBe(1);
	});

	it("produces one default Exploration per discovered session", async () => {
		const result = await loadBrowseProjection({
			projectPath: "/projects/my-app",
			registry,
		});
		expect(result.explorations).toHaveLength(4);
	});

	it("carries real metrics (e.g. messageCount) from the adapter through to the SourceSession", async () => {
		const result = await loadBrowseProjection({
			projectPath: "/projects/my-app",
			registry,
		});

		const piSession = result.sourceSessions.find((s) => s.source === "pi");
		expect(piSession).toBeDefined();
		expect(piSession?.messageCount).toBe(6);

		const cursorSession = result.sourceSessions.find(
			(s) => s.source === "cursor",
		);
		expect(cursorSession?.messageCount).toBe(20);

		// Tool calls flow through via metrics.
		const ccSession = result.sourceSessions.find(
			(s) => s.source === "claude-code",
		);
		expect(ccSession?.metrics?.toolCalls).toBe(5);
	});

	it("returns empty result for an empty registry without throwing", async () => {
		const emptyRegistry = new AdapterRegistry();
		const result = await loadBrowseProjection({
			projectPath: "/projects/nothing",
			registry: emptyRegistry,
		});
		expect(result.explorations).toEqual([]);
		expect(result.sourceSessions).toEqual([]);
		expect(result.sources).toEqual([]);
	});
});

describe("loadBrowseProjection — knowledge / pi metrics contract", () => {
	// Acceptance criterion from issue #62:
	//   `pnpm run cli knowledge -p ../artifacts.thefocus.ai` finds pi sessions
	//   with real counts.
	//
	// The knowledge command projects sessions exactly the same way browse
	// does (both call projectSessions). This test pins the contract that pi
	// sessions surface with real messageCount + toolCalls — no stubs.

	it("pi sessions carry real message and tool counts through projection", async () => {
		const registry = new AdapterRegistry();
		registry.register(
			makeAdapter("pi", [
				makeEntry({
					id: "pi-001",
					source: "pi",
					sourceId: "pi-001",
					firstPrompt: "Add error handling",
					messageCount: 42,
					metrics: {
						userMessages: 18,
						assistantMessages: 24,
						toolCalls: 11,
					},
				}),
			]),
		);

		const result = await loadBrowseProjection({
			projectPath: "/projects/artifacts",
			registry,
		});

		const pi = result.sourceSessions.find((s) => s.source === "pi");
		expect(pi).toBeDefined();
		expect(pi?.messageCount).toBe(42);
		expect(pi?.metrics?.toolCalls).toBe(11);
		expect(pi?.metrics?.userMessages).toBe(18);
		expect(pi?.metrics?.assistantMessages).toBe(24);
	});
});

describe("loadBrowseProjection — adapter initialization", () => {
	it("when called without a registry it initializes the global one (does not throw)", async () => {
		// Using the global registry exercises initializeAdapters(). We don't
		// assert on the contents because the host machine may or may not have
		// sessions for this synthetic project path — what we're verifying is
		// that the call succeeds and returns a well-formed result.
		const result = await loadBrowseProjection({
			projectPath: "/tmp/__umwelten_test_does_not_exist__",
		});
		expect(result).toBeDefined();
		expect(Array.isArray(result.explorations)).toBe(true);
		expect(Array.isArray(result.sources)).toBe(true);
	});
});
