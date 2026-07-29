/**
 * Push notifications on the habitat A2A surface (#275).
 *
 * A caller registers a URL and is told when the Task moves, instead of asking
 * repeatedly. Everything here runs against the real handler on loopback with a
 * real HTTP server standing in for the caller's webhook — no Docker, no model,
 * no outbound network.
 *
 * The case that matters most is the last one: a Task that dies with its
 * container and is swept on the next boot still notifies. That transition
 * happens outside the request handler, so it is the one nobody would have
 * noticed was missing.
 */

import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { TaskState, type Task } from "@a2a-js/sdk";
import {
	deleteA2APushConfig,
	getA2ATask,
	isA2ATask,
	listA2APushConfigs,
	registerA2APush,
	sendA2ATask,
} from "@umwelten/protocols";
import { buildAgentCard } from "./a2a-handler.js";
import type { AgentHost } from "./types.js";
import {
	SCRIPT_QUICK,
	SCRIPT_SLOW,
	startLoopbackHabitat,
} from "./test-utils/a2a-loopback.js";

/**
 * What arrives at the webhook. Registrations in these tests ride the legacy
 * (0.3) wire, so the legacy-aware sender serializes deliveries in the legacy
 * shape — string task states — regardless of the server's internal v1 types.
 */
interface Delivery {
	task: { id: string; status?: { state?: string } };
	token: string | undefined;
}

/** A caller's webhook: records what the agent POSTs to it. */
async function startWebhook(options: { status?: number } = {}) {
	const deliveries: Delivery[] = [];
	const server: Server = createServer((req, res) => {
		void (async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk as Buffer);
			const raw = Buffer.concat(chunks).toString("utf-8");
			try {
				deliveries.push({
					task: JSON.parse(raw) as Delivery["task"],
					token: req.headers["x-a2a-notification-token"] as string | undefined,
				});
			} catch {
				/* a body we cannot parse is still a delivery attempt we ignore */
			}
			res.writeHead(options.status ?? 200);
			res.end();
		})();
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = address && typeof address === "object" ? address.port : 0;

	return {
		url: `http://127.0.0.1:${port}/hook`,
		deliveries,
		/** Wait for a delivery matching `predicate`, or fail with what did arrive. */
		async waitFor(
			predicate: (delivery: Delivery) => boolean,
			timeoutMs = 5_000,
		): Promise<Delivery> {
			const deadline = Date.now() + timeoutMs;
			for (;;) {
				const found = deliveries.find(predicate);
				if (found) return found;
				if (Date.now() >= deadline) {
					throw new Error(
						`no matching push notification within ${timeoutMs}ms; received: ${
							deliveries
								.map((d) => `${d.task.id}=${d.task.status?.state}`)
								.join(", ") || "(none)"
						}`,
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},
		async stop() {
			await new Promise<void>((resolve) => {
				server.closeAllConnections?.();
				server.close(() => resolve());
			});
		},
	};
}

async function sendTask(
	endpoint: string,
	text: string,
	pushNotificationUrl?: string,
): Promise<Task> {
	const sent = await sendA2ATask({
		endpoint,
		text,
		blocking: false,
		...(pushNotificationUrl ? { pushNotificationUrl } : {}),
	});
	if (!isA2ATask(sent)) throw new Error("expected a Task, got a Message");
	return sent;
}

describe("habitat push notifications", () => {
	it("declares the capability on its card", async () => {
		const card = await buildAgentCard({
			baseUrl: "http://localhost:7430",
			habitat: {
				getConfig: () => ({ name: "Test", agents: [] }),
				getStimulus: async () => ({ options: { role: "test" } }),
				getWorkDir: () => "/tmp",
			} as unknown as AgentHost,
		});

		// Without this the SDK refuses every tasks/pushNotificationConfig/* call
		// before it reaches any store, so nothing below would be reachable.
		expect(card.capabilities.pushNotifications).toBe(true);
	});

	it("notifies a registered webhook when a Task finishes", async () => {
		const agent = await startLoopbackHabitat();
		const webhook = await startWebhook();
		try {
			const task = await sendTask(agent.url, SCRIPT_QUICK, webhook.url);
			const delivered = await webhook.waitFor(
				(d) => d.task.id === task.id && d.task.status?.state === "completed",
			);
			expect(delivered.task.id).toBe(task.id);
		} finally {
			await webhook.stop();
			await agent.stop();
		}
	}, 30_000);

	it("lists and deletes a caller's registrations", async () => {
		const agent = await startLoopbackHabitat();
		const webhook = await startWebhook();
		try {
			// Registration is per-Task, so the Task has to exist first — a slow one,
			// which stays around to be registered against.
			const task = await sendTask(agent.url, SCRIPT_SLOW);
			await registerA2APush({
				endpoint: agent.url,
				taskId: task.id,
				url: webhook.url,
				token: "shhh",
			});

			const configs = await listA2APushConfigs({
				endpoint: agent.url,
				taskId: task.id,
			});
			expect(configs).toHaveLength(1);
			expect(configs[0].pushNotificationConfig.url).toBe(webhook.url);
			// An unnamed registration is named after its Task, so a caller with one
			// webhook per Task never has to track config ids.
			expect(configs[0].pushNotificationConfig.id).toBe(task.id);

			await deleteA2APushConfig({ endpoint: agent.url, taskId: task.id });
			expect(
				await listA2APushConfigs({ endpoint: agent.url, taskId: task.id }),
			).toHaveLength(0);
		} finally {
			await webhook.stop();
			await agent.stop();
		}
	}, 30_000);

	it("sends the registration's token so the receiver can trust the callback", async () => {
		const agent = await startLoopbackHabitat();
		const webhook = await startWebhook();
		try {
			const task = await sendTask(agent.url, SCRIPT_SLOW);
			await registerA2APush({
				endpoint: agent.url,
				taskId: task.id,
				url: webhook.url,
				token: "shhh",
			});

			// The restart moves the Task (mid-flight → swept to `failed`), which is
			// what there is to notify about.
			await agent.restart();
			const delivered = await webhook.waitFor((d) => d.task.id === task.id);
			expect(delivered.token).toBe("shhh");
		} finally {
			await webhook.stop();
			await agent.stop();
		}
	}, 30_000);

	it("keeps registrations across a restart", async () => {
		const agent = await startLoopbackHabitat();
		const webhook = await startWebhook();
		try {
			const task = await sendTask(agent.url, SCRIPT_SLOW);
			await registerA2APush({
				endpoint: agent.url,
				taskId: task.id,
				url: webhook.url,
			});

			await agent.restart();

			// A registration that evaporates is worse than none: the caller believes
			// it is registered and waits for a webhook nobody will call.
			const configs = await listA2APushConfigs({
				endpoint: agent.url,
				taskId: task.id,
			});
			expect(configs).toHaveLength(1);
			expect(configs[0].pushNotificationConfig.url).toBe(webhook.url);
		} finally {
			await webhook.stop();
			await agent.stop();
		}
	}, 30_000);

	it("notifies the webhook of a Task the boot sweep had to fail", async () => {
		const agent = await startLoopbackHabitat();
		const webhook = await startWebhook();
		try {
			const task = await sendTask(agent.url, SCRIPT_SLOW, webhook.url);

			// The container dies with the run still in flight. Nothing publishes a
			// terminal event for it; the next boot's sweep is what moves it, and
			// that write never passes through the request handler — so without the
			// explicit dispatch, the one caller who asked to be told never is.
			await agent.restart();

			const delivered = await webhook.waitFor(
				(d) => d.task.id === task.id && d.task.status?.state === "failed",
			);
			expect(delivered.task.status?.state).toBe("failed");

			const afterwards = await getA2ATask({
				endpoint: agent.url,
				taskId: task.id,
			});
			expect(afterwards.status?.state).toBe(TaskState.TASK_STATE_FAILED);
		} finally {
			await webhook.stop();
			await agent.stop();
		}
	}, 30_000);

	it("does not fail the Task when the webhook is broken", async () => {
		const agent = await startLoopbackHabitat();
		// A receiver that errors on every delivery — the common case of a caller
		// whose endpoint is misconfigured or briefly down.
		const webhook = await startWebhook({ status: 500 });
		try {
			const task = await sendTask(agent.url, SCRIPT_QUICK, webhook.url);
			await webhook.waitFor((d) => d.task.id === task.id);

			const settled = await getA2ATask({ endpoint: agent.url, taskId: task.id });
			expect(settled.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
		} finally {
			await webhook.stop();
			await agent.stop();
		}
	}, 30_000);

	it("does not fail the Task when the webhook is gone entirely", async () => {
		const agent = await startLoopbackHabitat();
		const webhook = await startWebhook();
		const url = webhook.url;
		await webhook.stop();
		try {
			const task = await sendTask(agent.url, SCRIPT_QUICK, url);
			// Nothing to wait on — the point is that the Task settles anyway.
			for (let i = 0; i < 100; i++) {
				const current = await getA2ATask({
					endpoint: agent.url,
					taskId: task.id,
				});
				if (current.status?.state === TaskState.TASK_STATE_COMPLETED) return;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			throw new Error("Task never completed with an unreachable webhook");
		} finally {
			await agent.stop();
		}
	}, 30_000);
});
