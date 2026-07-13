import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	detectSourceFromSessionId,
	loadInteraction,
	interactionFromNormalizedSession,
	summarizeNormalizedSession,
} from "./load-interaction.js";
import { AdapterRegistry, adapterRegistry } from "./adapter.js";
import type { SessionAdapter } from "./adapter.js";
import type {
	NormalizedSession,
	NormalizedMessage,
} from "../types/normalized-types.js";

describe("detectSourceFromSessionId", () => {
	it("recognizes piloc: as pi", () => {
		expect(
			detectSourceFromSessionId(
				"piloc:/Users/x/proj:2026-05-20T00-00-00Z_session.jsonl",
			),
		).toBe("pi");
	});

	it("recognizes pi- (legacy global) as pi", () => {
		expect(
			detectSourceFromSessionId("pi-Users-x-proj--019e5026.jsonl"),
		).toBe("pi");
	});

	it("recognizes cursor: as cursor", () => {
		expect(detectSourceFromSessionId("cursor:abc:composer-1")).toBe("cursor");
	});

	it("recognizes claude-code: prefix as claude-code", () => {
		expect(
			detectSourceFromSessionId(
				"claude-code:abcd1234-5678-90ab-cdef-1234567890ab",
			),
		).toBe("claude-code");
	});

	it("treats bare UUID as claude-code (legacy default)", () => {
		expect(
			detectSourceFromSessionId("abcd1234-5678-90ab-cdef-1234567890ab"),
		).toBe("claude-code");
	});

	it("returns null for unknown ids", () => {
		expect(detectSourceFromSessionId("not-a-known-id")).toBe(null);
	});
});

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeAdapter(
	source: SessionAdapter["source"],
	sessionMap: Map<string, NormalizedSession>,
): SessionAdapter {
	return {
		source,
		displayName: source,
		getSourceLocation: () => "",
		canHandle: async () => true,
		discoverProjects: async () => [],
		discoverSessions: async () => ({
			sessions: [],
			source,
			totalCount: 0,
			hasMore: false,
		}),
		getSessionEntry: async () => null,
		getSession: async (id: string) => sessionMap.get(id) ?? null,
		getMessages: async (id: string) => sessionMap.get(id)?.messages ?? [],
		hasSessionsForProject: async () => true,
	};
}

function makeMessage(
	overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage {
	return {
		id: "m1",
		role: "user",
		content: "hello",
		timestamp: "2026-05-20T10:00:00.000Z",
		...overrides,
	};
}

function makeSession(
	id: string,
	messages: NormalizedMessage[],
	source: NormalizedSession["source"] = "pi",
): NormalizedSession {
	return {
		id,
		source,
		sourceId: id,
		projectPath: "/projects/test",
		created: "2026-05-20T10:00:00.000Z",
		modified: "2026-05-20T10:30:00.000Z",
		messageCount: messages.length,
		firstPrompt: messages.find((m) => m.role === "user")?.content ?? "",
		messages,
	};
}

const FAKE_MODEL = {
	name: "test-model",
	provider: "google",
} as const;

// ── loadInteraction — registry dispatch ──────────────────────────────────

describe("loadInteraction — dispatch", () => {
	// Save/restore the global registry between tests because the helper uses
	// the global, not an injectable one (that's the public API shape).
	let restoreAdapters: Map<string, SessionAdapter | undefined> | null = null;

	beforeEach(() => {
		restoreAdapters = new Map();
		// Snapshot whatever is in the registry today so we can restore.
		for (const s of adapterRegistry.getSources()) {
			restoreAdapters.set(s, adapterRegistry.get(s));
		}
	});

	afterEach(() => {
		// Restore prior adapters and remove any we registered during the test.
		const sources = Array.from(adapterRegistry.getSources());
		for (const s of sources) {
			const prev = restoreAdapters?.get(s);
			if (prev) {
				adapterRegistry.register(prev);
			}
		}
	});

	it("returns null when the sessionId prefix matches no adapter", async () => {
		const interaction = await loadInteraction("not-a-known-id", FAKE_MODEL);
		expect(interaction).toBe(null);
	});

	it("returns null when the adapter has no such session", async () => {
		const piAdapter = makeAdapter("pi", new Map());
		adapterRegistry.register(piAdapter);

		const interaction = await loadInteraction(
			"piloc:/proj:2026-05-20T00-00-00Z_missing.jsonl",
			FAKE_MODEL,
		);
		expect(interaction).toBe(null);
	});

	it("dispatches to the pi adapter for piloc: ids", async () => {
		const sessionId = "piloc:/proj:2026-05-20T00-00-00Z_one.jsonl";
		const session = makeSession(sessionId, [
			makeMessage({ role: "user", content: "what is x?" }),
			makeMessage({ id: "m2", role: "assistant", content: "x is y" }),
		]);
		adapterRegistry.register(makeAdapter("pi", new Map([[sessionId, session]])));

		const interaction = await loadInteraction(sessionId, FAKE_MODEL);
		expect(interaction).not.toBe(null);
		// fromNormalizedSession replaces interaction.messages with the
		// session's messages (no separate system slot in the resulting array
		// when the source session had no system message).
		expect(interaction!.messages.length).toBe(2);
		const userMsg = interaction!.messages.find((m) => m.role === "user");
		expect(userMsg?.content).toBe("what is x?");
	});

	it("dispatches to the cursor adapter for cursor: ids", async () => {
		const sessionId = "cursor:workspace-abc:composer-1";
		const session = makeSession(
			sessionId,
			[makeMessage({ content: "cursor question" })],
			"cursor",
		);
		adapterRegistry.register(
			makeAdapter("cursor", new Map([[sessionId, session]])),
		);

		const interaction = await loadInteraction(sessionId, FAKE_MODEL);
		expect(interaction).not.toBe(null);
		expect(interaction!.metadata.source).toBe("cursor");
	});
});

// ── interactionFromNormalizedSession — schema cleanup ────────────────────

describe("interactionFromNormalizedSession", () => {
	it("filters tool-role messages out of the resulting Interaction", () => {
		const session = makeSession("piloc:/proj:s.jsonl", [
			makeMessage({ role: "user", content: "run a tool" }),
			makeMessage({
				id: "m2",
				role: "assistant",
				content: "[tool bash] {cmd:'ls'}",
			}),
			// This one is schema-invalid as a v5 ModelMessage (tool content must
			// be Array<ToolResultPart>, not a string) and must be dropped.
			makeMessage({
				id: "m3",
				role: "tool",
				content: "ls output here",
			}),
			makeMessage({ id: "m4", role: "assistant", content: "done" }),
		]);

		const interaction = interactionFromNormalizedSession(session, FAKE_MODEL);
		const roles = interaction.messages.map((m) => m.role);
		expect(roles).not.toContain("tool");
		// system (from fromNormalizedSession default) + user + 2 assistant
		expect(interaction.messages.filter((m) => m.role === "user")).toHaveLength(1);
		expect(
			interaction.messages.filter((m) => m.role === "assistant"),
		).toHaveLength(2);
	});

	it("preserves the source and sourceId from the NormalizedSession", () => {
		const session = makeSession(
			"piloc:/proj:s.jsonl",
			[makeMessage()],
			"pi",
		);
		const interaction = interactionFromNormalizedSession(session, FAKE_MODEL);
		expect(interaction.metadata.source).toBe("pi");
		expect(interaction.metadata.sourceId).toBe("piloc:/proj:s.jsonl");
	});
});

// ── summarizeNormalizedSession ───────────────────────────────────────────

describe("summarizeNormalizedSession", () => {
	it("counts messages by role", () => {
		const session = makeSession("piloc:/p:s.jsonl", [
			makeMessage({ role: "user" }),
			makeMessage({ id: "m2", role: "assistant", content: "answer" }),
			makeMessage({ id: "m3", role: "tool", content: "tool result" }),
			makeMessage({ id: "m4", role: "assistant", content: "more" }),
		]);
		const m = summarizeNormalizedSession(session);
		expect(m.messageCount).toBe(4);
		expect(m.userMessages).toBe(1);
		expect(m.assistantMessages).toBe(2);
		expect(m.toolCalls).toBe(1);
	});

	it("sums per-message tokens across the session", () => {
		const session = makeSession("piloc:/p:s.jsonl", [
			makeMessage({ role: "user", tokens: { input: 100 } }),
			makeMessage({
				id: "m2",
				role: "assistant",
				tokens: { input: 50, output: 200, cacheRead: 30 },
			}),
			makeMessage({
				id: "m3",
				role: "assistant",
				tokens: { output: 100, cacheWrite: 10 },
			}),
		]);
		const m = summarizeNormalizedSession(session);
		expect(m.inputTokens).toBe(150);
		expect(m.outputTokens).toBe(300);
		expect(m.cacheReadTokens).toBe(30);
		expect(m.cacheWriteTokens).toBe(10);
		expect(m.totalTokens).toBe(490);
	});

	it("prefers session.metrics.estimatedCost when present", () => {
		const session = makeSession("piloc:/p:s.jsonl", [
			makeMessage({ tokens: { input: 1000, output: 500 } }),
		]);
		session.metrics = {
			userMessages: 1,
			assistantMessages: 0,
			toolCalls: 0,
			estimatedCost: 0.42,
		};
		// Even with a model that has costs, the pre-computed wins.
		const modelWithCost = {
			...FAKE_MODEL,
			costs: { promptTokens: 1, completionTokens: 1 },
		} as any;
		const m = summarizeNormalizedSession(session, modelWithCost);
		expect(m.estimatedCost).toBe(0.42);
	});

	it("falls back to calculateCost(model, sum) when session.metrics is missing", () => {
		const session = makeSession("piloc:/p:s.jsonl", [
			makeMessage({ tokens: { input: 1_000_000, output: 0 } }),
		]);
		// 1M prompt tokens × $1/1M = $1.00 total.
		const modelWithCost = {
			...FAKE_MODEL,
			costs: { promptTokens: 1, completionTokens: 0 },
		} as any;
		const m = summarizeNormalizedSession(session, modelWithCost);
		expect(m.estimatedCost).toBeCloseTo(1.0, 5);
	});

	it("returns 0 cost when no model is provided and no metrics are pre-computed", () => {
		const session = makeSession("piloc:/p:s.jsonl", [
			makeMessage({ tokens: { input: 999, output: 999 } }),
		]);
		const m = summarizeNormalizedSession(session);
		expect(m.estimatedCost).toBe(0);
		// Tokens are still summed.
		expect(m.totalTokens).toBe(1998);
	});

	it("computes duration from first and last message timestamps", () => {
		const session = makeSession("piloc:/p:s.jsonl", [
			makeMessage({ timestamp: "2026-05-20T10:00:00.000Z" }),
			makeMessage({
				id: "m2",
				role: "assistant",
				timestamp: "2026-05-20T10:30:15.000Z",
			}),
		]);
		const m = summarizeNormalizedSession(session);
		// 30m 15s = 1815s = 1_815_000ms.
		expect(m.durationMs).toBe(1_815_000);
	});
});
