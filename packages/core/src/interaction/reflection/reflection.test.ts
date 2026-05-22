import { describe, it, expect } from "vitest";
import {
	buildReflectionContext,
	buildReflectiveInteraction,
	buildExplorationDetail,
} from "./reflection.js";
import type { SourceSession } from "../types/domain-types.js";
import {
	createDefaultExploration,
	createVirtualExploration,
} from "../types/domain-types.js";

// ── Fixtures ────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SourceSession> = {}): SourceSession {
	return {
		id: "src-cc-abc123",
		source: "claude-code",
		sourceId: "abc123",
		title: "Fix auth token refresh",
		created: "2026-05-14T10:00:00.000Z",
		modified: "2026-05-14T11:30:00.000Z",
		messageCount: 24,
		firstPrompt: "The auth token is expiring before the refresh completes",
		...overrides,
	};
}

function makePiSession(): SourceSession {
	return makeSession({
		id: "src-pi-auth-001",
		source: "pi",
		sourceId: "pi-auth-001",
		title: "Add error handling to auth",
		sourceData: {
			filename: "session.jsonl",
			cwd: "/projects/my-app",
			displayName: "Refactor auth module",
			branchCount: 2,
			compactionCount: 1,
			labels: { entry1: "jwt-implemented" },
		},
	});
}

// ── buildExplorationDetail ──────────────────────────────────────────────

describe("buildExplorationDetail", () => {
	it("includes exploration name and id", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const detail = buildExplorationDetail(exploration);

		expect(detail).toContain("Fix auth token refresh");
		expect(detail).toContain(exploration.id);
		expect(detail).toContain("default");
	});

	it("shows source session members", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const detail = buildExplorationDetail(exploration);

		expect(detail).toContain("claude-code");
		expect(detail).toContain("src-cc-abc123");
	});

	it("includes search query for virtual explorations", () => {
		const session = makeSession();
		const exploration = createVirtualExploration("auth tokens", [session]);
		const detail = buildExplorationDetail(exploration);

		expect(detail).toContain("auth tokens");
		expect(detail).toContain("virtual");
		expect(detail).toContain('"auth tokens"');
	});

	it("handles explorations with multiple members", () => {
		const s1 = makeSession({ id: "s1", title: "Fix auth" });
		const s2 = makeSession({ id: "s2", title: "Add middleware" });
		const exploration = createVirtualExploration("auth work", [s1, s2]);
		const detail = buildExplorationDetail(exploration);

		expect(detail).toContain("s1");
		expect(detail).toContain("s2");
		expect(detail).toContain("Members: 2");
	});
});

// ── buildReflectionContext ──────────────────────────────────────────────

describe("buildReflectionContext", () => {
	it("returns system messages with exploration context", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const messages = buildReflectionContext([exploration]);

		expect(messages.length).toBeGreaterThanOrEqual(2);
		expect(messages.every((m) => m.role === "system")).toBe(true);
	});

	it("includes exploration overview", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const messages = buildReflectionContext([exploration]);

		const overview = messages[0].content as string;
		expect(overview).toContain("Total Explorations: 1");
		expect(overview).toContain("Total Source Sessions: 1");
	});

	it("includes per-exploration detail", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const messages = buildReflectionContext([exploration]);

		const details = messages.filter((m) =>
			(m.content as string).includes("--- Exploration:"),
		);
		expect(details).toHaveLength(1);
		expect(details[0].content).toContain("Fix auth token refresh");
	});

	it("prepends system context when provided", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const messages = buildReflectionContext([exploration], {
			systemContext: "Custom system context.",
		});

		expect(messages[0].content).toContain("Custom system context.");
	});

	it("handles multiple explorations", () => {
		const s1 = makeSession({ id: "s1", title: "Auth" });
		const s2 = makeSession({ id: "s2", title: "CI/CD" });
		const e1 = createDefaultExploration(s1).exploration;
		const e2 = createDefaultExploration(s2).exploration;

		const messages = buildReflectionContext([e1, e2]);

		const overview = messages[0].content as string;
		expect(overview).toContain("Total Explorations: 2");
		expect(overview).toContain("Total Source Sessions: 2");
	});

	it("aggregates source types from all members", () => {
		const ccSession = makeSession({ id: "cc-1", source: "claude-code" });
		const piSession = makePiSession();
		const e1 = createDefaultExploration(ccSession).exploration;
		const e2 = createDefaultExploration(piSession).exploration;

		const messages = buildReflectionContext([e1, e2]);
		const overview = messages[0].content as string;

		expect(overview).toContain("claude-code");
		expect(overview).toContain("pi");
	});
});

// ── buildReflectiveInteraction ──────────────────────────────────────────

describe("buildReflectiveInteraction", () => {
	it("creates an Interaction with the question", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const model: any = { provider: "test", model: "test-model" };

		const interaction = buildReflectiveInteraction(
			[exploration],
			"What did we learn?",
			{
				model,
			},
		);

		expect(interaction.messages.length).toBeGreaterThanOrEqual(3);
		const lastMsg = interaction.messages[interaction.messages.length - 1];
		expect(lastMsg.role).toBe("user");
		expect(lastMsg.content).toBe("What did we learn?");
	});

	it("pre-populates system context messages", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const model: any = { provider: "test", model: "test-model" };

		const interaction = buildReflectiveInteraction(
			[exploration],
			"Any failures?",
			{
				model,
			},
		);

		const systemMsgs = interaction.messages.filter((m) => m.role === "system");
		expect(systemMsgs.length).toBeGreaterThanOrEqual(2);
		expect(
			systemMsgs.some((m) => (m.content as string).includes("Exploration")),
		).toBe(true);
	});

	it("uses the provided model", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const model: any = { provider: "anthropic", model: "claude-sonnet-4-5" };

		const interaction = buildReflectiveInteraction([exploration], "Question?", {
			model,
		});

		expect(interaction.modelDetails).toBe(model);
	});

	it("accepts custom instructions", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const model: any = { provider: "test", model: "test-model" };

		const interaction = buildReflectiveInteraction([exploration], "Question?", {
			model,
			customInstructions: ["Focus on security issues."],
		});

		// Stimulus should include the custom instruction; we can verify through
		// the stimulus' instructions
		expect(interaction.stimulus.instructions).toContain(
			"Focus on security issues.",
		);
	});

	it("marks source as native with reflection prefix", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const model: any = { provider: "test", model: "test-model" };

		const interaction = buildReflectiveInteraction([exploration], "Question?", {
			model,
		});

		expect(interaction.metadata.source).toBe("native");
		expect(interaction.metadata.sourceId).toMatch(/^reflection-/);
	});

	it("no new runner type is used (uses base runner)", () => {
		const session = makeSession();
		const { exploration } = createDefaultExploration(session);
		const model: any = { provider: "test", model: "test-model" };

		const interaction = buildReflectiveInteraction([exploration], "Question?", {
			model,
		});

		// The Stimulus uses runnerType 'base' by default (no special runner)
		expect(interaction.stimulus.options.runnerType).toBeUndefined();
	});

	it("works with virtual explorations", () => {
		const s1 = makeSession({ id: "s1", title: "Auth fix" });
		const s2 = makeSession({ id: "s2", title: "Token refresh" });
		const exploration = createVirtualExploration("auth work", [s1, s2]);
		const model: any = { provider: "test", model: "test-model" };

		const interaction = buildReflectiveInteraction(
			[exploration],
			"What changed?",
			{ model },
		);

		const lastMsg = interaction.messages[interaction.messages.length - 1];
		expect(lastMsg.content).toBe("What changed?");
		// Context should include both sessions
		const ctxContent = interaction.messages
			.filter((m) => m.role === "system")
			.map((m) => m.content as string)
			.join("\n");
		expect(ctxContent).toContain("s1");
		expect(ctxContent).toContain("s2");
	});

	it("handles empty explorations array gracefully", () => {
		const model: any = { provider: "test", model: "test-model" };

		const interaction = buildReflectiveInteraction([], "What happened?", {
			model,
		});

		expect(interaction.messages.length).toBeGreaterThanOrEqual(2);
		const lastMsg = interaction.messages[interaction.messages.length - 1];
		expect(lastMsg.content).toBe("What happened?");
	});
});
