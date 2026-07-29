/**
 * The fixture set: one case per lifecycle claim an A2A client and its agent
 * have to agree on.
 *
 * These are written against {@link ConformanceSubject} only, so the same cases
 * run against an in-process scripted agent on loopback and against a live
 * habitat by address, with the control plane's client as the subject when it
 * is the one under test.
 *
 * Adding a case belongs here, not in a downstream copy — that is the whole
 * point of the arrangement (ADR 0007).
 *
 * SDK 1.x note: the subject returns v1-typed Tasks, so states here are
 * `TaskState` enum members. The legacy spellings ("working", "completed")
 * survive only in prose and assertion labels.
 */

import { TaskState } from "@a2a-js/sdk";
import {
	isInterruptedTaskState,
	isTerminalTaskState,
} from "../file-task-store.js";
import {
	assertIsTask,
	assertNotTerminal,
	assertSameTask,
	assertTaskState,
	assertTerminal,
	assertTrue,
} from "./assertions.js";
import type { ConformanceCase, ConformanceContext } from "./types.js";

/** Best-effort cleanup: a case must not leave work running for the next one. */
async function cancelQuietly(
	ctx: ConformanceContext,
	taskId: string,
): Promise<void> {
	try {
		await ctx.subject.cancelTask(taskId);
	} catch {
		/* already settled, or the agent is gone — either way, nothing to do */
	}
}

export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
	{
		id: "non-blocking-send-returns-task",
		title: "A non-blocking send returns a Task that is not yet finished",
		criterion: "Non-blocking send returns a Task in a non-terminal state",
		requires: { intents: ["slow"] },
		async run(ctx) {
			const sent = await ctx.step("send.non-blocking", () =>
				ctx.subject.send({ text: ctx.prompt("slow"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");
			assertNotTerminal(task, "send.returns-non-terminal-task");
			// `submitted` and `working` are both legal here; what is not legal is
			// the send having blocked until the work was done.
			assertTaskState(
				task,
				[TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING],
				"send.returns-in-flight-state",
			);
			await cancelQuietly(ctx, task.id);
		},
	},
	{
		id: "poll-tracks-task-to-completion",
		title: "Polling follows a Task from submission to completion",
		criterion: "Polling tracks a Task to completion",
		requires: { intents: ["quick"] },
		async run(ctx) {
			const sent = await ctx.step("send.quick", () =>
				ctx.subject.send({ text: ctx.prompt("quick"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");

			const settled = await ctx.awaitTask({
				taskId: task.id,
				until: (t) => t.status?.state === TaskState.TASK_STATE_COMPLETED,
				assertion: "poll.reaches-completed",
				describe: "reach `completed`",
			});
			assertSameTask(settled, task.id, "poll.tracks-the-same-task");
			assertTaskState(
				settled,
				TaskState.TASK_STATE_COMPLETED,
				"poll.reaches-completed",
			);
			assertTrue(
				Boolean(settled.status?.timestamp),
				"expected the terminal status to carry a timestamp",
				"poll.terminal-status-has-timestamp",
			);
		},
	},
	{
		id: "cancel-is-observable-to-a-poller",
		title: "Cancelling an in-flight Task transitions it, visibly to a poller",
		criterion: "Cancellation transitions a Task and is observable to a poller",
		requires: { intents: ["slow"] },
		async run(ctx) {
			const sent = await ctx.step("send.slow", () =>
				ctx.subject.send({ text: ctx.prompt("slow"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");

			// Wait until the agent is actually on it, so cancel is cancelling work
			// rather than racing the task's own creation.
			await ctx.awaitTask({
				taskId: task.id,
				until: (t) =>
					t.status?.state === TaskState.TASK_STATE_WORKING ||
					t.status?.state === TaskState.TASK_STATE_SUBMITTED,
				assertion: "cancel.task-is-in-flight-first",
				describe: "be in flight before cancellation",
			});

			const canceled = await ctx.step("cancel.request", () =>
				ctx.subject.cancelTask(task.id),
			);
			assertTaskState(
				canceled,
				TaskState.TASK_STATE_CANCELED,
				"cancel.returns-canceled",
			);

			// The response saying `canceled` is not the claim; the claim is that a
			// caller who was polling — and never saw the cancel response — observes
			// it too. That only holds if cancellation reached the store.
			const observed = await ctx.awaitTask({
				taskId: task.id,
				until: (t) => t.status?.state === TaskState.TASK_STATE_CANCELED,
				assertion: "cancel.observable-to-a-poller",
				describe: "be observed as `canceled` by a poller",
			});
			assertTaskState(
				observed,
				TaskState.TASK_STATE_CANCELED,
				"cancel.observable-to-a-poller",
			);
		},
	},
	{
		id: "failure-is-terminal",
		title: "A Task that fails ends in `failed`",
		criterion: "One suite drives a live Habitat through each terminal state",
		requires: { intents: ["fail"] },
		async run(ctx) {
			const sent = await ctx.step("send.fail", () =>
				ctx.subject.send({ text: ctx.prompt("fail"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");
			const settled = await ctx.awaitTask({
				taskId: task.id,
				until: (t) => t.status?.state === TaskState.TASK_STATE_FAILED,
				assertion: "terminal.failed",
				describe: "reach `failed`",
			});
			assertTaskState(settled, TaskState.TASK_STATE_FAILED, "terminal.failed");
		},
	},
	{
		id: "rejection-is-terminal",
		title: "A Task the agent refuses ends in `rejected`",
		criterion: "One suite drives a live Habitat through each terminal state",
		requires: { intents: ["reject"] },
		async run(ctx) {
			const sent = await ctx.step("send.reject", () =>
				ctx.subject.send({ text: ctx.prompt("reject"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");
			const settled = await ctx.awaitTask({
				taskId: task.id,
				until: (t) => t.status?.state === TaskState.TASK_STATE_REJECTED,
				assertion: "terminal.rejected",
				describe: "reach `rejected`",
			});
			assertTaskState(
				settled,
				TaskState.TASK_STATE_REJECTED,
				"terminal.rejected",
			);
		},
	},
	{
		id: "interrupted-task-settles-without-finishing",
		title: "A Task waiting on the caller stops moving without being terminal",
		criterion: "One suite drives a live Habitat through submit and work",
		requires: { intents: ["input-required"] },
		async run(ctx) {
			const sent = await ctx.step("send.input-required", () =>
				ctx.subject.send({ text: ctx.prompt("input-required"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");
			const settled = await ctx.awaitTask({
				taskId: task.id,
				until: (t) => isInterruptedTaskState(t.status?.state),
				assertion: "interrupted.reaches-input-required",
				describe: "reach `input-required`",
			});
			assertTaskState(
				settled,
				TaskState.TASK_STATE_INPUT_REQUIRED,
				"interrupted.reaches-input-required",
			);
			// A poller must be able to tell "waiting for me" from "finished", or it
			// will either hang forever or report a half-done Task as done.
			assertTrue(
				!isTerminalTaskState(settled.status?.state),
				"expected `input-required` not to be reported as a terminal state",
				"interrupted.is-not-terminal",
			);
		},
	},
	{
		id: "task-survives-restart",
		title: "A finished Task is still there after the agent restarts",
		criterion: "Task state survives a restart of the Habitat under test",
		requires: { intents: ["quick"], restart: true },
		async run(ctx) {
			const sent = await ctx.step("send.quick", () =>
				ctx.subject.send({ text: ctx.prompt("quick"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");
			const before = await ctx.awaitTask({
				taskId: task.id,
				until: (t) => t.status?.state === TaskState.TASK_STATE_COMPLETED,
				assertion: "restart.completed-before-restart",
				describe: "reach `completed` before the restart",
			});

			await ctx.restart("restart.agent-restarts");

			const after = await ctx.step("restart.get-after", () =>
				ctx.subject.getTask(task.id),
			);
			assertSameTask(after, task.id, "restart.same-task-id");
			assertTaskState(
				after,
				TaskState.TASK_STATE_COMPLETED,
				"restart.state-survives",
			);
			assertTrue(
				after.contextId === before.contextId,
				`expected contextId ${before.contextId} to survive the restart, got ${after.contextId}`,
				"restart.context-survives",
			);
		},
	},
	{
		id: "abandoned-task-is-terminal-after-restart",
		title: "Work killed by a restart is reported terminal, not still running",
		criterion:
			"An abandoned Task is observed terminal after restart, exercising #267's sweep",
		requires: { intents: ["slow"], restart: true },
		async run(ctx) {
			const sent = await ctx.step("send.slow", () =>
				ctx.subject.send({ text: ctx.prompt("slow"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");
			// `submitted` counts: an agent is not obliged to announce `working`
			// before it starts, and holding it to that would fail agents that are
			// merely terse rather than wrong. What matters is that the Task is
			// recorded and in flight when the agent dies under it.
			await ctx.awaitTask({
				taskId: task.id,
				until: (t) =>
					t.status?.state === TaskState.TASK_STATE_WORKING ||
					t.status?.state === TaskState.TASK_STATE_SUBMITTED,
				assertion: "abandoned.in-flight-before-restart",
				describe: "be in flight before the restart",
			});

			await ctx.restart("abandoned.agent-restarts");

			// The Task is the point: nothing is working on it any more, so a caller
			// polling it must not be told it is still running. Left `working`, a
			// poller waits out its whole timeout on work that died minutes ago.
			const after = await ctx.step("abandoned.get-after", () =>
				ctx.subject.getTask(task.id),
			);
			assertSameTask(after, task.id, "abandoned.same-task-id");
			assertTerminal(after, "abandoned.swept-to-terminal");
		},
	},
	{
		id: "interrupted-task-survives-restart",
		title: "A Task waiting on the caller is not swept by a restart",
		criterion: "Task state survives a restart of the Habitat under test",
		requires: { intents: ["input-required"], restart: true },
		async run(ctx) {
			const sent = await ctx.step("send.input-required", () =>
				ctx.subject.send({ text: ctx.prompt("input-required"), blocking: false }),
			);
			const task = assertIsTask(sent, "send.returns-task");
			await ctx.awaitTask({
				taskId: task.id,
				until: (t) => isInterruptedTaskState(t.status?.state),
				assertion: "interrupted.reaches-input-required",
				describe: "reach `input-required` before the restart",
			});

			await ctx.restart("interrupted.agent-restarts");

			// A Task waiting for a follow-up message or an authorization is not
			// abandoned work. Sweeping it destroys something resumable, so the
			// recovery pass has to leave it exactly where it was.
			const after = await ctx.step("interrupted.get-after", () =>
				ctx.subject.getTask(task.id),
			);
			assertTaskState(
				after,
				TaskState.TASK_STATE_INPUT_REQUIRED,
				"interrupted.survives-the-sweep",
			);
		},
	},
];
