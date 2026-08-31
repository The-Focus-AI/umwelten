import { describe, expect, it } from "vitest";
import {
	assignPreviewOrdinals,
	previewHostname,
	previewLabel,
	resolvePreviewHostname,
} from "./preview-address.js";
import type { GaiaHabitatEntry } from "./types.js";

const preview = {
	worktreeId: "primary",
	branch: "feature/roof pitch",
	port: 5173,
	ordinal: 1,
};

function entry(overrides: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
	return {
		id: "shed-designer",
		name: "Shed Designer",
		config: { name: "Shed Designer", agents: [] },
		secretBindings: [],
		apiKey: "test",
		previewSuffix: "a1b2c3d4e5f60718293a4b5c",
		publishedPreviews: [preview],
		createdAt: "2026-08-31T00:00:00.000Z",
		...overrides,
	};
}

describe("preview addressing", () => {
	it("assigns ordinals by unique ascending port, not startup order", () => {
		expect(assignPreviewOrdinals([8080, 3000, 8080, 5173])).toEqual([
			{ port: 3000, ordinal: 1 },
			{ port: 5173, ordinal: 2 },
			{ port: 8080, ordinal: 3 },
		]);
	});

	it("uses the current branch in one flat hostname", () => {
		expect(previewHostname(entry(), preview)).toBe(
			"shed-designer-feature-roof-pitch-1-a1b2c3d4e5f60718293a4b5c.preview.crepusculardiphthong.com",
		);
		expect(previewHostname(entry(), { ...preview, branch: "main" })).not.toBe(
			previewHostname(entry(), preview),
		);
	});

	it("keeps long labels within 63 characters and hashes truncated identity", () => {
		const a = previewLabel("project", `feature/${"x".repeat(100)}a`, 1, "abcdef123456");
		const b = previewLabel("project", `feature/${"x".repeat(100)}b`, 1, "abcdef123456");
		expect(a.length).toBeLessThanOrEqual(63);
		expect(b.length).toBeLessThanOrEqual(63);
		expect(a).not.toBe(b);
	});
});

describe("preview hostname resolution", () => {
	it("resolves a cached target while its Habitat is dormant", () => {
		const habitat = entry();
		const hostname = previewHostname(habitat, preview);
		const result = resolvePreviewHostname(hostname, [habitat]);
		expect(result).toMatchObject({ kind: "target", dormant: true, preview });
	});

	it("marks the same cached target live when the Habitat has a port", () => {
		const habitat = entry({ containerPort: 7440 });
		const result = resolvePreviewHostname(previewHostname(habitat, preview), [habitat]);
		expect(result).toMatchObject({ kind: "target", dormant: false });
	});

	it("distinguishes a known suffix with a moved-on branch from an unknown host", () => {
		const habitat = entry();
		expect(
			resolvePreviewHostname(
				"shed-designer-old-branch-1-a1b2c3d4e5f60718293a4b5c.preview.crepusculardiphthong.com",
				[habitat],
			),
		).toMatchObject({ kind: "stale", entry: habitat });
		expect(
			resolvePreviewHostname(
				"somebody-else-main-1-000000000000000000000000.preview.crepusculardiphthong.com",
				[habitat],
			),
		).toEqual({ kind: "unknown" });
	});

	it("rejects hosts outside the preview domain", () => {
		expect(resolvePreviewHostname("shed-designer.example.com", [entry()])).toEqual({
			kind: "unknown",
		});
	});
});
