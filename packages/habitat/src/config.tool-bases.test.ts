/**
 * resolveToolBases — where a habitat loads its work-dir tools from.
 *
 * Repo-backed habitats (config.gitUrl) keep tools in the cloned project dir;
 * the work dir loads last so operator overrides win. Non-provisioned habitats
 * use only the work dir (the project dir is a phantom path).
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveToolBases } from "./config.js";
import type { HabitatConfig } from "./types.js";

const WORK = "/data";

function config(overrides: Partial<HabitatConfig> = {}): HabitatConfig {
	return { agents: [], ...overrides } as HabitatConfig;
}

describe("resolveToolBases", () => {
	it("non-provisioned habitat uses only the work dir", () => {
		expect(resolveToolBases(WORK, config())).toEqual([WORK]);
	});

	it("repo-backed habitat loads project dir first, work dir last", () => {
		const bases = resolveToolBases(
			WORK,
			config({ gitUrl: "https://github.com/x/y.git" }),
		);
		expect(bases).toEqual([join(WORK, "project"), WORK]);
		// project dir before work dir → work-dir tool overrides on name clash
		expect(bases.indexOf(join(WORK, "project"))).toBeLessThan(
			bases.indexOf(WORK),
		);
	});

	it("honors a custom projectDir", () => {
		expect(
			resolveToolBases(
				WORK,
				config({ gitUrl: "https://github.com/x/y.git", projectDir: "repo" }),
			),
		).toEqual([join(WORK, "repo"), WORK]);
	});
});
