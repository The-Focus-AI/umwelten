/**
 * The A2A conformance suite (#274), run against a real habitat A2A surface.
 *
 * This is the second target of the one fixture set: the same cases that run
 * against the reference agent in `@umwelten/protocols`, pointed at
 * `createA2AHandler` — the real `HabitatAgentExecutor`, the real
 * `FileTaskStore` on a work directory, and the real boot sweep — mounted on a
 * loopback HTTP server and driven over JSON-RPC.
 *
 * The bridge is the seam, exactly as it is in `a2a-handler.test.ts`: it is
 * scripted rather than model-backed, so a run can be made to answer at once,
 * hang until it is aborted, or fail. Nothing here needs Docker, a model, or
 * the network.
 *
 * What a habitat cannot be driven to — `rejected`, `input-required` — the
 * suite reports as skipped rather than pretending to cover.
 */

import { describe, it, expect } from "vitest";
import {
	createHttpConformanceSubject,
	formatConformanceReport,
	runA2AConformance,
} from "@umwelten/protocols/a2a/conformance/index.js";
import {
	SCRIPT_FAIL,
	SCRIPT_QUICK,
	SCRIPT_SLOW,
	startLoopbackHabitat,
} from "./test-utils/a2a-loopback.js";

describe("A2A conformance — habitat surface", () => {
	it("conforms on every case a habitat can be driven through", async () => {
		const agent = await startLoopbackHabitat();
		try {
			const report = await runA2AConformance(
				createHttpConformanceSubject({
					endpoint: () => agent.url,
					name: "habitat A2A surface",
					restart: () => agent.restart(),
					prompts: {
						quick: SCRIPT_QUICK,
						slow: SCRIPT_SLOW,
						fail: SCRIPT_FAIL,
						// A habitat run either answers or fails; there is no way to ask
						// it for a rejection, and nothing yet parks a run on
						// `input-required`. Skipped, not faked.
						reject: null,
						"input-required": null,
					},
					pollIntervalMs: 10,
					settleTimeoutMs: 5_000,
				}),
			);

			expect(report.ok, formatConformanceReport(report)).toBe(true);
			// Everything except the two intents a habitat cannot produce.
			expect(report.passed).toBe(6);
			expect(report.skipped).toBe(3);
		} finally {
			await agent.stop();
		}
	}, 40_000);
});
