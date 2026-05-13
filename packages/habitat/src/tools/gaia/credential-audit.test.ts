import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	CredentialAuditLogger,
	credentialEntry,
	bindingEntry,
} from "./credential-audit.js";
import type { AuditEntry } from "./credential-audit.js";

describe("CredentialAuditLogger", () => {
	let dataDir: string;
	let audit: CredentialAuditLogger;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "credential-audit-"));
		audit = new CredentialAuditLogger(dataDir);
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	// ── basic logging ────────────────────────────────────────────────

	it("creates credential-audit.jsonl on first write", async () => {
		await audit.log(credentialEntry("add_credential", "test-key"));

		const raw = await readFile(
			join(dataDir, "credential-audit.jsonl"),
			"utf-8",
		);
		expect(raw).toContain('"operation":"add_credential"');
		expect(raw).toContain('"credential":"test-key"');
		expect(raw).toContain('"timestamp"');
	});

	it("appends entries (does not overwrite)", async () => {
		await audit.log(credentialEntry("add_credential", "alpha"));
		await audit.log(credentialEntry("verify_credential", "alpha"));

		const entries = await audit.read();
		expect(entries.length).toBe(2);
		expect(entries[0].operation).toBe("add_credential");
		expect(entries[1].operation).toBe("verify_credential");
	});

	it("each log line is valid JSON", async () => {
		await audit.log(credentialEntry("add_credential", "key1"));
		await audit.log(credentialEntry("remove_credential", "key1"));

		const raw = await readFile(
			join(dataDir, "credential-audit.jsonl"),
			"utf-8",
		);
		const lines = raw.trim().split("\n");
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});

	// ── read ──────────────────────────────────────────────────────────

	it("returns empty array when file does not exist", async () => {
		const entries = await audit.read();
		expect(entries).toEqual([]);
	});

	it("returns most recent N entries (default: 50)", async () => {
		for (let i = 0; i < 60; i++) {
			await audit.log(credentialEntry("add_credential", `key-${i}`));
		}
		const entries = await audit.read();
		expect(entries.length).toBe(50);
		expect(entries[0].credential).toBe("key-10");
		expect(entries[49].credential).toBe("key-59");
	});

	it("returns all entries when fewer than N", async () => {
		await audit.log(credentialEntry("add_credential", "one"));
		await audit.log(credentialEntry("add_credential", "two"));

		const entries = await audit.read(10);
		expect(entries.length).toBe(2);
	});

	it("respects custom limit", async () => {
		for (let i = 0; i < 10; i++) {
			await audit.log(credentialEntry("add_credential", `key-${i}`));
		}
		const entries = await audit.read(5);
		expect(entries.length).toBe(5);
		expect(entries[0].credential).toBe("key-5");
		expect(entries[4].credential).toBe("key-9");
	});

	// ── entry helpers ─────────────────────────────────────────────────

	it("credentialEntry creates entries with correct fields", () => {
		const entry = credentialEntry("verify_credential", "my-key");
		expect(entry.operation).toBe("verify_credential");
		expect(entry.credential).toBe("my-key");
		expect(entry.timestamp).toBeDefined();
		expect(entry.habitatId).toBeUndefined();
		expect(entry.capability).toBeUndefined();
	});

	it("bindingEntry creates entries with habitatId, capability, credential", () => {
		const entry = bindingEntry(
			"bind_capability",
			"my-habitat",
			"github:read",
			"gh-key",
		);
		expect(entry.operation).toBe("bind_capability");
		expect(entry.habitatId).toBe("my-habitat");
		expect(entry.capability).toBe("github:read");
		expect(entry.credential).toBe("gh-key");
		expect(entry.timestamp).toBeDefined();
	});

	// ── all operation types ───────────────────────────────────────────

	it("add_credential log entry", async () => {
		await audit.log(credentialEntry("add_credential", "qb-key"));
		const entries = await audit.read(1);
		expect(entries[0]).toMatchObject({
			operation: "add_credential",
			credential: "qb-key",
		});
	});

	it("remove_credential log entry", async () => {
		await audit.log(credentialEntry("remove_credential", "old-key"));
		const entries = await audit.read(1);
		expect(entries[0]).toMatchObject({
			operation: "remove_credential",
			credential: "old-key",
		});
	});

	it("verify_credential log entry", async () => {
		await audit.log(credentialEntry("verify_credential", "gh-key"));
		const entries = await audit.read(1);
		expect(entries[0]).toMatchObject({
			operation: "verify_credential",
			credential: "gh-key",
		});
	});

	it("bind_capability log entry", async () => {
		await audit.log(
			bindingEntry("bind_capability", "bot-1", "github:write", "gh-write"),
		);
		const entries = await audit.read(1);
		expect(entries[0]).toMatchObject({
			operation: "bind_capability",
			habitatId: "bot-1",
			capability: "github:write",
			credential: "gh-write",
		});
	});

	it("unbind_capability log entry", async () => {
		await audit.log(
			bindingEntry("unbind_capability", "bot-1", "quickbooks:read", "qb-read"),
		);
		const entries = await audit.read(1);
		expect(entries[0]).toMatchObject({
			operation: "unbind_capability",
			habitatId: "bot-1",
			capability: "quickbooks:read",
			credential: "qb-read",
		});
	});

	// ── interleaved entries ──────────────────────────────────────────

	it("handles interleaved operations and reads them in order", async () => {
		await audit.log(credentialEntry("add_credential", "key-a"));
		await audit.log(bindingEntry("bind_capability", "h1", "cap:x", "key-a"));
		await audit.log(credentialEntry("verify_credential", "key-a"));
		await audit.log(bindingEntry("unbind_capability", "h1", "cap:x", "key-a"));
		await audit.log(credentialEntry("remove_credential", "key-a"));

		const entries = await audit.read(10);
		expect(entries.length).toBe(5);
		expect(entries.map((e) => e.operation)).toEqual([
			"add_credential",
			"bind_capability",
			"verify_credential",
			"unbind_capability",
			"remove_credential",
		]);
	});
});
