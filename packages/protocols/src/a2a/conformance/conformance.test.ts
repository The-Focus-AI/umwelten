/**
 * The conformance suite, run against the reference target.
 *
 * Everything here is loopback HTTP against a real JSON-RPC transport and a
 * real `FileTaskStore` on a temp directory — no Docker, no model, no network.
 *
 * The negative tests matter as much as the positive one: a suite that cannot
 * be shown to fail on a broken agent is not a regression net. So an agent with
 * an in-memory store is checked to fail the durability case *by name*, and a
 * subject that cannot drive an intent is checked to skip rather than pass.
 */

import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { InMemoryTaskStore } from "@a2a-js/sdk/server";
import { createA2AServer } from "../server.js";
import { startConformanceAgent } from "./local-agent.js";
import { createHttpConformanceSubject } from "./http-subject.js";
import { runA2AConformance, formatConformanceReport } from "./runner.js";
import { ScriptedConformanceAgent } from "./scripted-agent.js";
import { CONFORMANCE_CASES } from "./cases.js";

const SUBJECT_TIMING = { pollIntervalMs: 10, settleTimeoutMs: 4_000 };

describe("A2A conformance — reference agent", () => {
	it("passes every case against a durable, restartable agent", async () => {
		const agent = await startConformanceAgent();
		try {
			const report = await runA2AConformance(
				createHttpConformanceSubject({
					endpoint: () => agent.url,
					name: "reference agent",
					restart: () => agent.restart(),
					...SUBJECT_TIMING,
				}),
			);

			// The formatted report is the artifact a human reads when this breaks.
			expect(report.ok, formatConformanceReport(report)).toBe(true);
			expect(report.skipped).toBe(0);
			expect(report.passed).toBe(CONFORMANCE_CASES.length);
		} finally {
			await agent.stop();
		}
	}, 30_000);

	it("enforces the bearer the agent declares", async () => {
		const agent = await startConformanceAgent({ apiKey: "s3cret" });
		try {
			const authorized = await runA2AConformance(
				createHttpConformanceSubject({
					endpoint: () => agent.url,
					apiKey: "s3cret",
					...SUBJECT_TIMING,
				}),
				{ only: ["poll-tracks-task-to-completion"] },
			);
			expect(authorized.ok, formatConformanceReport(authorized)).toBe(true);

			const anonymous = await runA2AConformance(
				createHttpConformanceSubject({
					endpoint: () => agent.url,
					...SUBJECT_TIMING,
				}),
				{ only: ["poll-tracks-task-to-completion"] },
			);
			expect(anonymous.ok).toBe(false);
			// Even an auth failure is reported as the lifecycle step it broke.
			expect(anonymous.results[0].assertion).toBe("send.quick");
		} finally {
			await agent.stop();
		}
	}, 30_000);

	it("sweeps the task its own restart abandoned", async () => {
		const agent = await startConformanceAgent();
		try {
			const subject = createHttpConformanceSubject({
				endpoint: () => agent.url,
				restart: () => agent.restart(),
				...SUBJECT_TIMING,
			});
			const report = await runA2AConformance(subject, {
				only: ["abandoned-task-is-terminal-after-restart"],
			});
			expect(report.ok, formatConformanceReport(report)).toBe(true);
			// Not just "terminal" — the sweep is what made it terminal.
			expect(agent.lastSweep?.swept).toHaveLength(1);
		} finally {
			await agent.stop();
		}
	}, 30_000);
});

describe("A2A conformance — reporting", () => {
	it("skips, rather than passes, what the subject cannot drive", async () => {
		const agent = await startConformanceAgent();
		try {
			const report = await runA2AConformance(
				createHttpConformanceSubject({
					endpoint: () => agent.url,
					// A model-backed habitat cannot be told to end `rejected`, and this
					// harness has no way to restart it.
					prompts: { reject: null },
					...SUBJECT_TIMING,
				}),
			);

			const rejected = report.results.find(
				(r) => r.id === "rejection-is-terminal",
			);
			expect(rejected?.status).toBe("skipped");
			expect(rejected?.skipReason).toContain("reject");

			const restartCases = report.results.filter((r) =>
				CONFORMANCE_CASES.find((c) => c.id === r.id)?.requires?.restart,
			);
			expect(restartCases).not.toHaveLength(0);
			for (const result of restartCases) {
				expect(result.status).toBe("skipped");
				expect(result.skipReason).toContain("restart");
			}

			// A run that skipped work is still "ok" — but it says so, loudly.
			expect(report.ok).toBe(true);
			expect(report.skipped).toBe(restartCases.length + 1);
			expect(formatConformanceReport(report)).toContain("SKIP");
		} finally {
			await agent.stop();
		}
	}, 30_000);

	it("names the lifecycle assertion that broke, not the request", async () => {
		const agent = await startConformanceAgent();
		try {
			// An agent that acknowledges the work and then never finishes it. The
			// requests all succeed; what is broken is the lifecycle claim that a
			// poller can track a Task to completion.
			const report = await runA2AConformance(
				createHttpConformanceSubject({
					endpoint: () => agent.url,
					prompts: { quick: "conformance:slow" },
					pollIntervalMs: 10,
					settleTimeoutMs: 300,
				}),
				{ only: ["poll-tracks-task-to-completion"] },
			);

			expect(report.ok).toBe(false);
			const failure = report.results[0];
			expect(failure.status).toBe("failed");
			expect(failure.assertion).toBe("poll.reaches-completed");
			expect(failure.message).toMatch(/did not reach `completed`/);
			expect(failure.observedState).toBe("working");
			expect(failure.criterion).toBe("Polling tracks a Task to completion");
			expect(formatConformanceReport(report)).toContain(
				"poll.reaches-completed",
			);
		} finally {
			await agent.stop();
		}
	}, 30_000);

	it("fails the durability case against an agent that forgets its Tasks", async () => {
		// The exact regression #267 exists to prevent: an agent whose Tasks live
		// in memory. `tasks/get` after the restart cannot answer at all, so the
		// failure lands on the step that asked.
		const agent = await startForgetfulAgent();
		try {
			const report = await runA2AConformance(
				createHttpConformanceSubject({
					endpoint: () => agent.url,
					restart: () => agent.restart(),
					...SUBJECT_TIMING,
				}),
				{ only: ["task-survives-restart"] },
			);

			expect(report.ok).toBe(false);
			const failure = report.results[0];
			expect(failure.status).toBe("failed");
			expect(failure.assertion).toBe("restart.get-after");
			expect(failure.message).toContain("request failed");
		} finally {
			await agent.stop();
		}
	}, 30_000);
});

/**
 * The same agent with the SDK's in-memory store — a habitat that forgets every
 * Task when its container stops. Kept local to this file: it exists to be
 * failed, not to be offered as a target.
 */
async function startForgetfulAgent() {
	let executor = new ScriptedConformanceAgent();
	let a2a = createA2AServer({
		agentCard: {
			name: "Forgetful Agent",
			description: "Loses its tasks on restart.",
			url: "http://127.0.0.1/a2a",
			version: "1.0.0",
			protocolVersion: "0.2.5",
			capabilities: { streaming: true },
			defaultInputModes: ["text/plain"],
			defaultOutputModes: ["text/plain"],
			skills: [],
		},
		executor,
		taskStore: new InMemoryTaskStore(),
	});

	const server = createServer((req, res) => {
		void (async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk as Buffer);
			const body = chunks.length
				? JSON.parse(Buffer.concat(chunks).toString("utf-8"))
				: undefined;
			const result = await a2a.transportHandler.handle(body);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(result));
		})();
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = address && typeof address === "object" ? address.port : 0;

	return {
		url: `http://127.0.0.1:${port}`,
		async restart() {
			executor.kill();
			executor = new ScriptedConformanceAgent();
			a2a = createA2AServer({
				agentCard: a2a.agentCard,
				executor,
				taskStore: new InMemoryTaskStore(),
			});
		},
		async stop() {
			executor.kill();
			await new Promise<void>((resolve) => {
				server.closeAllConnections?.();
				server.close(() => resolve());
			});
		},
	};
}
