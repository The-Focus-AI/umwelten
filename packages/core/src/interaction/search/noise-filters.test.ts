/**
 * Unit tests for the noise-filter primitives.
 *
 * peekFile() opens real files (small fixtures) — these tests don't
 * shell out to rg, so they run regardless of whether ripgrep is
 * installed.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
	peekFile,
	isNoiseFile,
	CLAUDE_CODE_MIN_SESSION_LINES,
	type PeekedFile,
} from "./index.js";

const NOISY_DIR = join(
	import.meta.dirname,
	"__fixtures__",
	"projects",
	"-tmp-search-fixture-project-noisy",
);

const SIDECHAIN_PATH = join(NOISY_DIR, "sidechain-aaa.jsonl");
const MICRO_PATH = join(NOISY_DIR, "micro-bbb.jsonl");
const QUEUEOP_PATH = join(NOISY_DIR, "queueop-ccc.jsonl");
const REGULAR_PATH = join(NOISY_DIR, "regular-ddd.jsonl");

describe("CLAUDE_CODE_MIN_SESSION_LINES", () => {
	it("is 5", () => {
		// Pinning this constant: changing it would shift the boundary
		// between "noise" and "real session." Forces the change to
		// be visible in code review.
		expect(CLAUDE_CODE_MIN_SESSION_LINES).toBe(5);
	});
});

describe("peekFile", () => {
	it("flags a sidechain file by the first line's isSidechain field", async () => {
		const p = await peekFile(SIDECHAIN_PATH);
		expect(p.firstIsSidechain).toBe(true);
		expect(p.firstHasAgentId).toBe(true);
		expect(p.lines).toBeGreaterThanOrEqual(CLAUDE_CODE_MIN_SESSION_LINES);
	});

	it("flags a micro-file with fewer than CLAUDE_CODE_MIN_SESSION_LINES lines", async () => {
		const p = await peekFile(MICRO_PATH);
		expect(p.lines).toBeLessThan(CLAUDE_CODE_MIN_SESSION_LINES);
		expect(p.firstIsSidechain).toBe(false);
		expect(p.firstHasAgentId).toBe(false);
	});

	it("does NOT flag a regular session", async () => {
		const p = await peekFile(REGULAR_PATH);
		expect(p.firstIsSidechain).toBe(false);
		expect(p.firstHasAgentId).toBe(false);
		expect(p.lines).toBeGreaterThanOrEqual(CLAUDE_CODE_MIN_SESSION_LINES);
	});

	it("returns empty/false fields for a missing file (treated as noise downstream)", async () => {
		const p = await peekFile("/this/path/does/not/exist.jsonl");
		expect(p.lines).toBe(0);
		expect(p.firstIsSidechain).toBe(false);
		expect(p.firstHasAgentId).toBe(false);
	});

	it("stops at the threshold when the file is larger", async () => {
		// Generate a file with way more than `threshold` lines and assert
		// peekFile reports exactly `threshold` (it stops reading early).
		const dir = await mkdtemp(join(tmpdir(), "umwelten-peekfile-test-"));
		await mkdir(dir, { recursive: true });
		const filePath = join(dir, "big.jsonl");
		const lines: string[] = [];
		for (let i = 0; i < 100; i++) {
			lines.push(
				JSON.stringify({
					type: "user",
					timestamp: `2026-05-01T00:00:${String(i).padStart(2, "0")}Z`,
					message: { role: "user", content: `line ${i}` },
				}),
			);
		}
		await writeFile(filePath, lines.join("\n") + "\n");

		const threshold = 7;
		const p = await peekFile(filePath, threshold);
		expect(p.lines).toBe(threshold);
	});

	it("handles a non-JSON first line gracefully", async () => {
		const dir = await mkdtemp(join(tmpdir(), "umwelten-peekfile-test-"));
		await mkdir(dir, { recursive: true });
		const filePath = join(dir, "garbled.jsonl");
		await writeFile(
			filePath,
			"this is not json\n{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"ok\"}}\n{\"x\":1}\n{\"x\":2}\n{\"x\":3}\n",
		);

		const p = await peekFile(filePath);
		expect(p.firstIsSidechain).toBe(false);
		expect(p.firstHasAgentId).toBe(false);
		expect(p.lines).toBe(CLAUDE_CODE_MIN_SESSION_LINES);
	});
});

describe("isNoiseFile", () => {
	function f(o: Partial<PeekedFile>): PeekedFile {
		return {
			lines: 100,
			firstIsSidechain: false,
			firstHasAgentId: false,
			...o,
		};
	}

	it("flags micro-files", () => {
		expect(isNoiseFile(f({ lines: 0 }))).toBe(true);
		expect(isNoiseFile(f({ lines: CLAUDE_CODE_MIN_SESSION_LINES - 1 }))).toBe(true);
	});

	it("flags sidechain files", () => {
		expect(isNoiseFile(f({ firstIsSidechain: true }))).toBe(true);
	});

	it("flags files with an agentId", () => {
		expect(isNoiseFile(f({ firstHasAgentId: true }))).toBe(true);
	});

	it("does NOT flag a regular file", () => {
		expect(
			isNoiseFile(
				f({
					lines: CLAUDE_CODE_MIN_SESSION_LINES,
					firstIsSidechain: false,
					firstHasAgentId: false,
				}),
			),
		).toBe(false);
	});
});

describe("end-to-end fixture composition", () => {
	it("classifies each fixture file correctly", async () => {
		const sidechain = await peekFile(SIDECHAIN_PATH);
		const micro = await peekFile(MICRO_PATH);
		const queueop = await peekFile(QUEUEOP_PATH);
		const regular = await peekFile(REGULAR_PATH);

		expect(isNoiseFile(sidechain)).toBe(true);
		expect(isNoiseFile(micro)).toBe(true);
		expect(isNoiseFile(queueop)).toBe(true);
		expect(isNoiseFile(regular)).toBe(false);
	});
});
