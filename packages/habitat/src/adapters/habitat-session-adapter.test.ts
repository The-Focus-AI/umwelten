import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { HabitatSessionAdapter } from "./habitat-session-adapter.js";

// ── Fixtures ────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
	testDir = join(tmpdir(), `habitat-adapter-test-${randomUUID()}`);
	await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

/**
 * Create a Habitat session directory with meta.json and transcript.jsonl.
 */
async function createHabitatSession(
	sessionId: string,
	overrides: {
		type?: string;
		model?: string;
		provider?: string;
		messages?: Array<{ role: string; content: string }>;
		agentId?: string;
	} = {},
): Promise<string> {
	const sessionDir = join(testDir, sessionId);
	await mkdir(sessionDir, { recursive: true });

	const meta = {
		sessionId,
		created: "2026-05-14T10:00:00.000Z",
		lastUsed: "2026-05-14T11:30:00.000Z",
		type: overrides.type ?? "cli",
		model: overrides.model,
		provider: overrides.provider,
		agentId: overrides.agentId,
	};

	await writeFile(
		join(sessionDir, "meta.json"),
		JSON.stringify(meta, null, 2),
		"utf-8",
	);

	const messages = overrides.messages ?? [
		{ role: "user", content: "Fix the auth token refresh" },
		{ role: "assistant", content: "I will fix the auth token refresh." },
	];

	const lines = messages.map((msg) =>
		JSON.stringify({
			type: "message",
			id: randomUUID().slice(0, 8),
			parentId: null,
			timestamp: new Date().toISOString(),
			message: msg,
		}),
	);

	// Add session header
	const header = JSON.stringify({
		type: "session",
		version: 3,
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		cwd: "/test",
	});

	await writeFile(
		join(sessionDir, "transcript.jsonl"),
		[header, ...lines].join("\n") + "\n",
		"utf-8",
	);

	return sessionDir;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("HabitatSessionAdapter", () => {
	it("discovers habitat sessions", async () => {
		await createHabitatSession("session-001");
		await createHabitatSession("session-002");

		const adapter = new HabitatSessionAdapter(testDir);
		const result = await adapter.discoverSessions();

		expect(result.source).toBe("habitat");
		expect(result.sessions).toHaveLength(2);
		expect(result.totalCount).toBe(2);
	});

	it("returns session entries with correct fields", async () => {
		await createHabitatSession("test-session", {
			type: "cli",
			model: "claude-sonnet-4-5",
			provider: "anthropic",
		});

		const adapter = new HabitatSessionAdapter(testDir);
		const result = await adapter.discoverSessions();

		const entry = result.sessions[0];
		expect(entry.id).toMatch(/^habitat-/);
		expect(entry.source).toBe("habitat");
		expect(entry.firstPrompt).toBe("Fix the auth token refresh");
		expect(entry.messageCount).toBe(2);
		expect(entry.sourceData?.type).toBe("cli");
		expect(entry.sourceData?.model).toBe("claude-sonnet-4-5");
	});

	it("getSessionEntry returns entry for valid session", async () => {
		await createHabitatSession("valid-session");
		const adapter = new HabitatSessionAdapter(testDir);

		const entry = await adapter.getSessionEntry("habitat-valid-session");
		expect(entry).not.toBeNull();
		expect(entry!.source).toBe("habitat");
		expect(entry!.firstPrompt).toBe("Fix the auth token refresh");
	});

	it("getSessionEntry returns null for non-existent session", async () => {
		const adapter = new HabitatSessionAdapter(testDir);
		const entry = await adapter.getSessionEntry("habitat-nonexistent");
		expect(entry).toBeNull();
	});

	it("getSession returns full session with messages", async () => {
		await createHabitatSession("full-session", {
			messages: [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
				{ role: "toolResult", content: "Result data" },
			],
		});

		const adapter = new HabitatSessionAdapter(testDir);
		const session = await adapter.getSession("habitat-full-session");

		expect(session).not.toBeNull();
		expect(session!.messages).toHaveLength(3);

		const roles = session!.messages.map((m) => m.role);
		expect(roles).toContain("user");
		expect(roles).toContain("assistant");
		expect(roles).toContain("tool");
	});

	it("getMessages returns messages array", async () => {
		await createHabitatSession("msg-session", {
			messages: [
				{ role: "user", content: "Test" },
				{ role: "assistant", content: "Response" },
			],
		});

		const adapter = new HabitatSessionAdapter(testDir);
		const messages = await adapter.getMessages("habitat-msg-session");

		expect(messages).toHaveLength(2);
		expect(messages[0].content).toBe("Test");
		expect(messages[1].content).toBe("Response");
	});

	it("hasSessionsForProject returns true when sessions exist", async () => {
		await createHabitatSession("some-session");
		const adapter = new HabitatSessionAdapter(testDir);
		const result = await adapter.hasSessionsForProject(testDir);
		expect(result).toBe(true);
	});

	it("hasSessionsForProject returns false when no sessions", async () => {
		const adapter = new HabitatSessionAdapter(testDir);
		const result = await adapter.hasSessionsForProject(testDir);
		expect(result).toBe(false);
	});

	it("returns empty result for empty directory", async () => {
		const adapter = new HabitatSessionAdapter(testDir);
		const result = await adapter.discoverSessions();
		expect(result.sessions).toHaveLength(0);
		expect(result.totalCount).toBe(0);
	});

	it("sorts sessions by modified desc by default", async () => {
		await createHabitatSession("older-session");
		// Wait a tick for different timestamps
		await new Promise((r) => setTimeout(r, 10));
		await createHabitatSession("newer-session");

		const adapter = new HabitatSessionAdapter(testDir);
		const result = await adapter.discoverSessions();

		expect(result.sessions).toHaveLength(2);
		// newer-session should come first (descending)
		expect(result.sessions[0].id).toMatch(/newer/);
	});

	it("getSourceLocation returns the sessions dir", () => {
		const adapter = new HabitatSessionAdapter(testDir);
		expect(adapter.getSourceLocation()).toBe(testDir);
	});

	it("canHandle returns true for valid sessions dir", async () => {
		await createHabitatSession("test");
		const adapter = new HabitatSessionAdapter(testDir);
		const result = await adapter.canHandle(testDir);
		expect(result).toBe(true);
	});

	it("registers with the adapter registry correctly", async () => {
		const { adapterRegistry } = await import(
			"@umwelten/core/interaction/adapters/adapter.js"
		);
		const adapter = new HabitatSessionAdapter(testDir);

		adapterRegistry.register(adapter);
		const retrieved = adapterRegistry.get("habitat");
		expect(retrieved).toBe(adapter);
		expect(retrieved!.source).toBe("habitat");
	});

	it("handles sessions with agent metadata", async () => {
		await createHabitatSession("agent-session", {
			agentId: "my-agent",
			type: "discord",
		});

		const adapter = new HabitatSessionAdapter(testDir);
		const result = await adapter.discoverSessions();

		expect(result.sessions[0].sourceData?.agentId).toBe("my-agent");
		expect(result.sessions[0].sourceData?.type).toBe("discord");
	});
});
