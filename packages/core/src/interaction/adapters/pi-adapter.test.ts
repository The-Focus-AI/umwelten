import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { PiSessionAdapter, type ParsedPiSession } from "./pi-adapter.js";
import type { NormalizedSession } from "../types/normalized-types.js";

const FIXTURES_DIR = join(import.meta.dirname, "__fixtures__", "pi");

// ── Helpers ─────────────────────────────────────────────────────────────

function loadFixture(name: string): Promise<string> {
	return readFile(join(FIXTURES_DIR, name), "utf-8");
}

function makeAdapter(): PiSessionAdapter {
	return new PiSessionAdapter();
}

// ── Fixture: linear session ─────────────────────────────────────────────

describe("PiSessionAdapter — linear fixture", () => {
	let raw: string;
	let parsed: ParsedPiSession;

	beforeEach(async () => {
		raw = await loadFixture("linear-session.jsonl");
		parsed = makeAdapter().parseRawSession(raw)!;
	});

	it("parses the session header", () => {
		expect(parsed.header.type).toBe("session");
		expect(parsed.header.version).toBe(3);
		expect(parsed.header.cwd).toBe("/projects/my-app");
	});

	it("extracts all entries", () => {
		expect(parsed.entries.length).toBe(6);
	});

	it("identifies model and thinking level", () => {
		expect(parsed.model).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet-4-5",
		});
		expect(parsed.thinkingLevel).toBe("high");
	});

	it("has no branches or compactions", () => {
		expect(parsed.branchCount).toBe(0);
		expect(parsed.compactionCount).toBe(0);
	});

	it("builds a linear active path", () => {
		// First entry has parentId: null, rest chain
		expect(parsed.entries[0].type).toBe("model_change");
		expect(parsed.entries[0].parentId).toBeNull();
		// Each subsequent entry's parentId matches the previous entry's id
		for (let i = 1; i < parsed.entries.length; i++) {
			expect(parsed.entries[i].parentId).toBe(parsed.entries[i - 1].id);
		}
	});

	it("has no labels", () => {
		expect(parsed.labels.size).toBe(0);
	});
});

// ── Fixture: branched session ───────────────────────────────────────────

describe("PiSessionAdapter — branched fixture", () => {
	let parsed: ParsedPiSession;

	beforeEach(async () => {
		const raw = await loadFixture("branched-session.jsonl");
		parsed = makeAdapter().parseRawSession(raw)!;
	});

	it("detects branch points", () => {
		expect(parsed.branchCount).toBeGreaterThanOrEqual(1);
	});

	it("preserves branch summary entries", () => {
		const branchSummaries = parsed.entries.filter(
			(e) => e.type === "branch_summary",
		);
		expect(branchSummaries.length).toBe(1);
		expect((branchSummaries[0] as any).fromId).toBe("b2000004");
		expect((branchSummaries[0] as any).summary).toContain("raw SQL");
	});

	it("builds tree structure with multiple children", () => {
		// Entry b2000003 should have two children: b2000004 (branch A) and b2000006 (branch summary → branch B)
		const childrenOfParent = parsed.tree.get("b2000003");
		expect(childrenOfParent).toBeDefined();
		expect(childrenOfParent!.length).toBe(2);
	});

	it("active path follows the last branch (branch B)", () => {
		// The last entry in the file is the ORM branch's assistant message
		const lastEntry = parsed.entries[parsed.entries.length - 1];
		expect(lastEntry.id).toBe("b2000008");
		expect(parsed.activePath).toContain("b2000008");
	});
});

// ── Fixture: with compaction ────────────────────────────────────────────

describe("PiSessionAdapter — compaction fixture", () => {
	let parsed: ParsedPiSession;

	beforeEach(async () => {
		const raw = await loadFixture("with-compaction.jsonl");
		parsed = makeAdapter().parseRawSession(raw)!;
	});

	it("detects compaction entries", () => {
		expect(parsed.compactionCount).toBe(1);
	});

	it("extracts compaction metadata", () => {
		const compaction = parsed.entries.find(
			(e) => e.type === "compaction",
		) as any;
		expect(compaction).toBeDefined();
		expect(compaction.summary).toContain("CI pipeline");
		expect(compaction.tokensBefore).toBe(45000);
		expect(compaction.firstKeptEntryId).toBe("c3000003");
	});
});

// ── Fixture: with labels and name ───────────────────────────────────────

describe("PiSessionAdapter — labels and name fixture", () => {
	let parsed: ParsedPiSession;

	beforeEach(async () => {
		const raw = await loadFixture("with-labels-and-name.jsonl");
		parsed = makeAdapter().parseRawSession(raw)!;
	});

	it("extracts session display name", () => {
		expect(parsed.displayName).toBe("Refactor auth module");
	});

	it("extracts labels", () => {
		expect(parsed.labels.size).toBe(2);
		expect(parsed.labels.get("d4000004")).toBe("jwt-implemented");
		expect(parsed.labels.get("d4000008")).toBe("refresh-added");
	});

	it("includes label in message sourceData", async () => {
		// Convert to NormalizedSession to check message-level labels
		const adapter = makeAdapter();
		const raw = adapter.parseRawSession(
			await loadFixture("with-labels-and-name.jsonl"),
		)!;
		const messages = (adapter as any).entriesToMessages(raw) as any[];
		const labeledMsg = messages.find((m: any) => m.sourceData?.label);
		expect(labeledMsg).toBeDefined();
		expect(labeledMsg.sourceData.label).toBe("jwt-implemented");
	});
});

// ── Full session normalization ──────────────────────────────────────────

describe("PiSessionAdapter — normalization", () => {
	it("converts linear session to NormalizedSession", async () => {
		const raw = await loadFixture("linear-session.jsonl");
		const adapter = makeAdapter();
		const parsed = adapter.parseRawSession(raw)!;

		// Simulate what getSession does by directly calling toNormalizedSession
		const session = (adapter as any).toNormalizedSession(
			parsed,
			"/projects/my-app",
			join(FIXTURES_DIR, "linear-session.jsonl"),
		) as NormalizedSession;

		expect(session.source).toBe("pi");
		expect(session.sourceId).toBe("019e1000-0000-7000-8000-000000000001");
		expect(session.messageCount).toBeGreaterThan(0);
		expect(session.firstPrompt).toBe("Add error handling to the auth module");
	});

	it("maps message roles correctly", async () => {
		const raw = await loadFixture("linear-session.jsonl");
		const adapter = makeAdapter();
		const parsed = adapter.parseRawSession(raw)!;
		const messages = (adapter as any).entriesToMessages(parsed) as any[];

		expect(messages.some((m: any) => m.role === "user")).toBe(true);
		expect(messages.some((m: any) => m.role === "assistant")).toBe(true);
		expect(messages.some((m: any) => m.role === "tool")).toBe(true);
	});

	it("extracts assistant usage stats", async () => {
		const raw = await loadFixture("linear-session.jsonl");
		const adapter = makeAdapter();
		const parsed = adapter.parseRawSession(raw)!;
		const messages = (adapter as any).entriesToMessages(parsed) as any[];

		const assistantMsgs = messages.filter((m: any) => m.role === "assistant");
		expect(assistantMsgs.length).toBe(2);
		// Second assistant message has usage
		const lastAssistant = assistantMsgs[1];
		expect(lastAssistant.tokens).toBeDefined();
		expect(lastAssistant.tokens.total).toBe(380);
	});

	it("extracts tool call info from tool result messages", async () => {
		const raw = await loadFixture("linear-session.jsonl");
		const adapter = makeAdapter();
		const parsed = adapter.parseRawSession(raw)!;
		const messages = (adapter as any).entriesToMessages(parsed) as any[];

		const toolMsg = messages.find((m: any) => m.role === "tool");
		expect(toolMsg).toBeDefined();
		expect(toolMsg.tool).toBeDefined();
		expect(toolMsg.tool.name).toBe("read");
	});
});

// ── Discovery ───────────────────────────────────────────────────────────

describe("PiSessionAdapter — discovery", () => {
	it("encodes project paths correctly", () => {
		const adapter = makeAdapter();
		const encoded = (adapter as any).encodeProjectPath(
			"/Users/wschenk/My Project",
		);
		expect(encoded).toBe("--Users-wschenk-My Project--");
	});

	it("decodes project paths correctly", () => {
		const adapter = makeAdapter();
		const decoded = (adapter as any).decodeProjectPath(
			"--Users-wschenk-My-Project--",
		);
		expect(decoded).toBe("/Users/wschenk/My/Project");
	});

	it("builds session IDs from file paths", () => {
		const adapter = makeAdapter();
		const base = homedir() + "/.pi/agent/sessions";
		const id = (adapter as any).buildSessionId(
			base + "/--Users-test--/session.jsonl",
		);
		expect(id).toBe("pi--Users-test--session.jsonl");
	});

	it("resolveSessionId reverses buildSessionId", () => {
		const adapter = makeAdapter();
		const filePath =
			homedir() + "/.pi/agent/sessions/--Users-test--/session.jsonl";
		const id = (adapter as any).buildSessionId(filePath);
		const [projectPath, resolvedFile] = (adapter as any).resolveSessionId(id);
		expect(projectPath).toBe("/Users/test");
		expect(resolvedFile).toBe(filePath);
	});

	it("detects canHandle for an existing project", async () => {
		// Use a real test dir
		const adapter = makeAdapter();
		const canHandle = await adapter.canHandle(FIXTURES_DIR);
		// FIXTURES_DIR won't have pi session format, so this should be false
		expect(canHandle).toBe(false);
	});
});

// ── Session entry parsing ───────────────────────────────────────────────

describe("PiSessionAdapter — entry parsing", () => {
	it("returns null for empty input", () => {
		const parsed = makeAdapter().parseRawSession("");
		expect(parsed).toBeNull();
	});

	it("returns null for non-session header", () => {
		const parsed = makeAdapter().parseRawSession('{"type":"unknown"}');
		expect(parsed).toBeNull();
	});

	it("handles malformed lines gracefully", () => {
		const raw = [
			'{"type":"session","version":3,"id":"test","timestamp":"2025-01-01T00:00:00Z","cwd":"/test"}',
			"not valid json",
			'{"type":"message","id":"m1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}',
		].join("\n");

		const parsed = makeAdapter().parseRawSession(raw);
		expect(parsed).not.toBeNull();
		expect(parsed!.entries.length).toBe(1); // only parses the valid entry
	});
});
