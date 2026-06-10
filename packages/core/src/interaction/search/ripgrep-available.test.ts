import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ripgrepAvailable } from "./ripgrep-available.js";

const HAS_RG = (() => {
	const result = spawnSync("rg", ["--version"], { stdio: "ignore" });
	return result.status === 0;
})();

describe("ripgrepAvailable", () => {
	it("resolves false for a binary that does not exist", async () => {
		await expect(
			ripgrepAvailable("definitely-not-a-real-binary-92xq"),
		).resolves.toBe(false);
	});

	it.skipIf(!HAS_RG)("resolves true when rg is on PATH", async () => {
		await expect(ripgrepAvailable()).resolves.toBe(true);
	});

	it("never rejects — missing binaries resolve, not throw", async () => {
		// The CLI preflight relies on this: a missing rg must produce the
		// friendly install hint, not an unhandled spawn error.
		const result = ripgrepAvailable("also-not-a-binary-92xq");
		await expect(result).resolves.toBeTypeOf("boolean");
	});
});
