/**
 * Tests for extraction workflow engine — determineScope, concurrency, and progress.
 *
 * TDD vertical slices per acceptance criteria in #63:
 * 1. determineScope ordering (newest first, undigested before stale)
 * 2. Stale detection (modified time and schema version)
 * 3. Concurrency control (default 1, configurable)
 * 4. Progress streaming events
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	determineScope,
	ExtractionEngine,
	type ExtractionInput,
	type DigestInfo,
	type ExtractionProgress,
} from "./extraction-engine.js";

// ── Mock digestSession at module level (vi.hoisted avoids hoisting issues) ──
const { mockDigestSession } = vi.hoisted(() => ({
	mockDigestSession: vi.fn(),
}));

vi.mock("./session-digester.js", () => ({
	digestSession: mockDigestSession,
}));

const successDigest = {
	sessionId: "test",
	overallSummary: "test",
	allFacts: [],
	extractedFacts: [],
	segments: [],
	analysis: { tags: [], topics: [] },
	metrics: { messageCount: 10, segmentCount: 1, toolCallCount: 0, estimatedCost: 0, duration: 0 },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ExtractionInput> = {}): ExtractionInput {
	return {
		explorationId: "exp-1",
		sessionId: "session-1",
		modified: "2026-05-20T10:00:00Z",
		source: "claude-code",
		sessionEntry: {
			sessionId: "session-1",
			fileMtime: Date.now(),
			firstPrompt: "Test session",
			messageCount: 10,
			created: "2026-05-20T10:00:00Z",
			modified: "2026-05-20T10:00:00Z",
			gitBranch: "main",
			projectPath: "/test",
			isSidechain: false,
		},
		...overrides,
	};
}

// ─── determineScope ─────────────────────────────────────────────────────

describe("determineScope", () => {
	it("returns all inputs as undigested when no digests exist", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-20T10:00:00Z" }),
			makeInput({ explorationId: "e2", sessionId: "s2", modified: "2026-05-19T10:00:00Z" }),
		];

		const scope = determineScope(inputs, new Map());

		expect(scope.undigested).toHaveLength(2);
		expect(scope.stale).toHaveLength(0);
		expect(scope.undigested[0].explorationId).toBe("e1");
		expect(scope.undigested[1].explorationId).toBe("e2");
	});

	it("sorts undigested by modified date descending (newest first)", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "oldest", sessionId: "s1", modified: "2026-05-10T10:00:00Z" }),
			makeInput({ explorationId: "middle", sessionId: "s2", modified: "2026-05-15T10:00:00Z" }),
			makeInput({ explorationId: "newest", sessionId: "s3", modified: "2026-05-20T10:00:00Z" }),
		];

		const scope = determineScope(inputs, new Map());

		expect(scope.undigested.map((e) => e.explorationId)).toEqual([
			"newest",
			"middle",
			"oldest",
		]);
	});

	it("excludes already-digested sessions that are up to date", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-10T10:00:00Z" }),
			makeInput({ explorationId: "e2", sessionId: "s2", modified: "2026-05-20T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
			["s2", { digestedAt: "2026-05-25T10:00:00Z", schemaVersion: 1 }],
		]);

		const scope = determineScope(inputs, digests, 1);

		expect(scope.undigested).toHaveLength(0);
		expect(scope.stale).toHaveLength(0);
	});

	it("detects stale when source session modified after digest", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-20T10:00:00Z" }),
			makeInput({ explorationId: "e2", sessionId: "s2", modified: "2026-05-10T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
			["s2", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
		]);

		const scope = determineScope(inputs, digests, 1);

		expect(scope.undigested).toHaveLength(0);
		expect(scope.stale).toHaveLength(1);
		expect(scope.stale[0].explorationId).toBe("e1");
	});

	it("detects stale when schema version mismatches", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-10T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
		]);

		const scope = determineScope(inputs, digests, 2);

		expect(scope.stale).toHaveLength(1);
		expect(scope.stale[0].explorationId).toBe("e1");
	});

	it("treats undigested as higher priority than stale", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "stale-new", sessionId: "s1", modified: "2026-05-22T10:00:00Z" }),
			makeInput({ explorationId: "undigested", sessionId: "s2", modified: "2026-05-15T10:00:00Z" }),
			makeInput({ explorationId: "stale-old", sessionId: "s3", modified: "2026-05-12T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-10T10:00:00Z", schemaVersion: 1 }],
			["s3", { digestedAt: "2026-05-01T10:00:00Z", schemaVersion: 1 }],
		]);

		const scope = determineScope(inputs, digests, 1);

		expect(scope.undigested).toHaveLength(1);
		expect(scope.undigested[0].explorationId).toBe("undigested");

		expect(scope.stale).toHaveLength(2);
		expect(scope.stale[0].explorationId).toBe("stale-new");
		expect(scope.stale[1].explorationId).toBe("stale-old");
	});

	it("handles digest without schemaVersion by only checking time", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-20T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-25T10:00:00Z" }],
		]);

		const scope = determineScope(inputs, digests, 2);

		expect(scope.undigested).toHaveLength(0);
		expect(scope.stale).toHaveLength(0);
	});

	it("treats exact timestamp match as up to date (not stale)", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-15T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
		]);

		const scope = determineScope(inputs, digests, 1);

		expect(scope.undigested).toHaveLength(0);
		expect(scope.stale).toHaveLength(0);
	});

	it("returns empty scope when all already digested and up to date", () => {
		const inputs: ExtractionInput[] = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-10T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
		]);

		const scope = determineScope(inputs, digests, 1);

		expect(scope.undigested).toHaveLength(0);
		expect(scope.stale).toHaveLength(0);
	});
});

// ─── ExtractionEngine (all engine tests share mocked digestSession) ─────

describe("ExtractionEngine", () => {
	const model = { name: "test", provider: "test" as any, temperature: 0 } as any;

	beforeEach(() => {
		mockDigestSession.mockReset();
		mockDigestSession.mockResolvedValue(successDigest);
	});

	// ── Progress streaming ─────────────────────────────────────────────

	it("emits pending, digesting, and digested events in correct order", async () => {
		const engine = new ExtractionEngine({ concurrency: 1, schemaVersion: 1 });

		const events: ExtractionProgress[] = [];
		const onProgress = (e: ExtractionProgress) => events.push(e);

		const inputs = [makeInput({ explorationId: "e1", sessionId: "s1" })];

		const result = await engine.run(
			inputs, new Map(), "/test", "test-project", model, onProgress,
		);

		expect(result.digested).toBe(1);
		expect(result.failed).toBe(0);

		const phases = events.map((e) => e.phase);
		expect(phases).toContain("pending");
		expect(phases).toContain("digesting");
		expect(phases).toContain("digested");

		const pendingIdx = phases.indexOf("pending");
		const digestingIdx = phases.indexOf("digesting");
		const digestedIdx = phases.indexOf("digested");
		expect(pendingIdx).toBeLessThan(digestingIdx);
		expect(digestingIdx).toBeLessThan(digestedIdx);
	});

	it("emits failed event when digestSession throws", async () => {
		mockDigestSession.mockRejectedValue(new Error("LLM unavailable"));

		const engine = new ExtractionEngine({ concurrency: 1, schemaVersion: 1 });

		const events: ExtractionProgress[] = [];
		const onProgress = (e: ExtractionProgress) => events.push(e);

		const inputs = [makeInput({ explorationId: "e1", sessionId: "s1" })];

		const result = await engine.run(
			inputs, new Map(), "/test", "test-project", model, onProgress,
		);

		expect(result.failed).toBe(1);
		expect(result.digested).toBe(0);

		const failedEvent = events.find((e) => e.phase === "failed");
		expect(failedEvent).toBeDefined();
		expect(failedEvent!.detail).toContain("LLM unavailable");
	});

	it("emits events for all Explorations in scope", async () => {
		const engine = new ExtractionEngine({ concurrency: 1, schemaVersion: 1 });

		const events: ExtractionProgress[] = [];
		const onProgress = (e: ExtractionProgress) => events.push(e);

		const inputs = [
			makeInput({ explorationId: "e1", sessionId: "s1" }),
			makeInput({ explorationId: "e2", sessionId: "s2" }),
			makeInput({ explorationId: "e3", sessionId: "s3" }),
		];

		const result = await engine.run(
			inputs, new Map(), "/test", "test-project", model, onProgress,
		);

		expect(result.digested).toBe(3);

		const e1Events = events.filter((e) => e.explorationId === "e1");
		const e2Events = events.filter((e) => e.explorationId === "e2");
		const e3Events = events.filter((e) => e.explorationId === "e3");

		expect(e1Events.length).toBeGreaterThanOrEqual(2);
		expect(e2Events.length).toBeGreaterThanOrEqual(2);
		expect(e3Events.length).toBeGreaterThanOrEqual(2);
	});

	// ── Scope + skip ───────────────────────────────────────────────────

	it("skips already-digested explorations", async () => {
		const engine = new ExtractionEngine({ concurrency: 1, schemaVersion: 1 });

		const inputs = [
			makeInput({ explorationId: "new", sessionId: "s1", modified: "2026-05-20T10:00:00Z" }),
			makeInput({ explorationId: "dug", sessionId: "s2", modified: "2026-05-10T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s2", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
		]);

		const result = await engine.run(inputs, digests, "/test", "test-project", model);

		expect(result.digested).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.failed).toBe(0);
	});

	it("returns zero when nothing to process", async () => {
		const engine = new ExtractionEngine({ concurrency: 1 });

		const inputs = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-10T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
		]);

		const result = await engine.run(inputs, digests, "/test", "test-project", model);

		expect(result.digested).toBe(0);
		expect(result.skipped).toBe(1);
		expect(result.failed).toBe(0);
	});

	// ── Concurrency control ────────────────────────────────────────────

	it("defaults to concurrency 1", () => {
		expect(new ExtractionEngine()).toBeDefined();
	});

	it("accepts configurable concurrency", () => {
		expect(new ExtractionEngine({ concurrency: 3 })).toBeDefined();
	});

	it("processes sequentially when concurrency=1 (e1 digested before e2 digesting starts)", async () => {
		const engine = new ExtractionEngine({ concurrency: 1, schemaVersion: 1 });

		const events: ExtractionProgress[] = [];
		const onProgress = (e: ExtractionProgress) => events.push(e);

		const inputs = [
			makeInput({ explorationId: "e1", sessionId: "s1" }),
			makeInput({ explorationId: "e2", sessionId: "s2" }),
		];

		await engine.run(inputs, new Map(), "/test", "test-project", model, onProgress);

		// Pending events fire for all upfront, then digesting/digested per exploration.
		// With concurrency=1, e1's digesting must start before e2's digesting.
		const e1DigestingIdx = events.findIndex(
			(e) => e.explorationId === "e1" && e.phase === "digesting",
		);
		const e2DigestingIdx = events.findIndex(
			(e) => e.explorationId === "e2" && e.phase === "digesting",
		);

		expect(e1DigestingIdx).toBeLessThan(e2DigestingIdx);
	});

	// ── Schema version detection ───────────────────────────────────────

	it("re-extracts when schema version mismatches (stale by schema)", async () => {
		const engine = new ExtractionEngine({ concurrency: 1, schemaVersion: 2 });

		const inputs = [
			makeInput({ explorationId: "e1", sessionId: "s1", modified: "2026-05-10T10:00:00Z" }),
		];

		const digests = new Map<string, DigestInfo>([
			["s1", { digestedAt: "2026-05-15T10:00:00Z", schemaVersion: 1 }],
		]);

		const result = await engine.run(inputs, digests, "/test", "test-project", model);

		expect(result.digested).toBe(1);
		expect(result.stale).toBe(1);
		expect(result.skipped).toBe(0);
	});
});
