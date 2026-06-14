/**
 * Unit coverage for the A2A chat client's exported helpers.
 *
 * The streaming render loop (`a2aChat`/`sendOne`) is verified end-to-end
 * against a live habitat in the PR; here we pin the pure/filesystem
 * helpers that are cheap to test and easy to regress.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// discoverToken reads gaia-data/registry.json (then registry.json) from cwd.
// Mock fs so we can drive it without touching the real filesystem or chdir
// (process.chdir is unsupported in vitest workers).
const files = new Map<string, string>();
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(async (path: string) => {
		for (const [suffix, content] of files) {
			if (path.endsWith(suffix)) return content;
		}
		const err: NodeJS.ErrnoException = new Error("ENOENT");
		err.code = "ENOENT";
		throw err;
	}),
}));

import { truncateJson, discoverToken } from "./chat.js";

describe("truncateJson", () => {
	it("passes short values through unchanged", () => {
		expect(truncateJson("hi", 100)).toBe("hi");
		expect(truncateJson({ a: 1 }, 100)).toBe('{"a":1}');
	});

	it("truncates long values with an ellipsis", () => {
		const out = truncateJson("x".repeat(50), 10);
		expect(out).toBe("xxxxxxxxxx...");
		expect(out.length).toBe(13);
	});

	it("stringifies non-string input before measuring", () => {
		expect(truncateJson({ name: "abcdef" }, 8)).toBe('{"name":...');
	});
});

describe("discoverToken", () => {
	beforeEach(() => files.clear());

	it("matches a gaia-data/registry.json entry by container port", async () => {
		files.set(
			"gaia-data/registry.json",
			JSON.stringify({
				habitats: [
					{ id: "a", containerPort: 7440, apiKey: "key-a" },
					{ id: "b", containerPort: 7441, apiKey: "key-b" },
				],
			}),
		);
		expect(await discoverToken("http://localhost:7441")).toBe("key-b");
		expect(await discoverToken("http://localhost:7440")).toBe("key-a");
	});

	it("falls back to a top-level registry.json", async () => {
		files.set(
			"registry.json",
			JSON.stringify({ habitats: [{ containerPort: 7442, apiKey: "key-c" }] }),
		);
		expect(await discoverToken("http://127.0.0.1:7442")).toBe("key-c");
	});

	it("returns undefined with no registry or no port match", async () => {
		expect(await discoverToken("http://localhost:7440")).toBeUndefined();
		files.set(
			"registry.json",
			JSON.stringify({ habitats: [{ containerPort: 9999, apiKey: "key-x" }] }),
		);
		expect(await discoverToken("http://localhost:7440")).toBeUndefined();
	});
});
