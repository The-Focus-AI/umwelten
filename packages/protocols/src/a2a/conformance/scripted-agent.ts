/**
 * A scripted agent that can be driven to any point in the Task lifecycle.
 *
 * The suite needs an agent that ends `failed` on request, sits `working` until
 * something stops it, and stops waiting for input on cue. A model cannot be
 * relied on for any of that, so the reference target is this: an
 * `AgentExecutor` that reads a directive out of the message text and produces
 * exactly the lifecycle asked for.
 *
 * It is also the reference for what a *correct* v1 A2A agent looks like from
 * the task surface's point of view (same idiom as `HabitatAgentExecutor`):
 * the first published event is the Task snapshot, then working status
 * updates, then **one terminal (or deliberately interrupting) status update
 * whose `status.message` carries the reply**. There is no `final` flag in the
 * v1 event model — the stream ends because the state itself is terminal
 * (completed / canceled / failed / rejected) or INPUT_REQUIRED. An agent
 * whose last event leaves the Task `working` strands every poller forever.
 */

import { TaskState, type Task } from "@a2a-js/sdk";
import {
	AgentEvent,
	type AgentExecutor,
	type ExecutionEventBus,
	type RequestContext,
} from "../server.js";
import { agentMessage, messageText } from "../v1-compat.js";
import type { ConformanceIntent } from "./types.js";

/** Directive text that drives each intent. */
export const CONFORMANCE_DIRECTIVES: Record<ConformanceIntent, string> = {
	quick: "conformance:quick",
	slow: "conformance:slow",
	fail: "conformance:fail",
	reject: "conformance:reject",
	"input-required": "conformance:input-required",
};

/** The intent a message asks for; anything unrecognised answers quickly. */
export function intentFromText(text: string): ConformanceIntent {
	const found = (
		Object.entries(CONFORMANCE_DIRECTIVES) as [ConformanceIntent, string][]
	).find(([, directive]) => text.includes(directive));
	return found?.[0] ?? "quick";
}

interface ActiveRun {
	contextId: string;
	bus: ExecutionEventBus;
	/** Ends the run's wait. `killed` means the process is going away. */
	release(outcome: "canceled" | "killed"): void;
}

export class ScriptedConformanceAgent implements AgentExecutor {
	private readonly active = new Map<string, ActiveRun>();

	async execute(
		context: RequestContext,
		eventBus: ExecutionEventBus,
	): Promise<void> {
		const { taskId, contextId, userMessage } = context;
		const intent = intentFromText(messageText(userMessage));

		// The v1 executor contract: the FIRST event of every execute() call
		// MUST be a `task` or `message` event — including follow-up turns where
		// the Task already exists, so the snapshot is published unconditionally.
		// It is also what makes the run addressable: without a Task record,
		// `tasks/cancel` reports taskNotFound and every status update after this
		// is dropped as belonging to an unknown task.
		const initialTask: Task = context.task ?? {
			id: taskId,
			contextId,
			status: {
				state: TaskState.TASK_STATE_SUBMITTED,
				message: undefined,
				timestamp: new Date().toISOString(),
			},
			artifacts: [],
			history: [userMessage],
			metadata: undefined,
		};
		eventBus.publish(AgentEvent.task(initialTask));

		this.publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_WORKING);

		switch (intent) {
			case "quick":
				this.publishStatus(
					eventBus,
					taskId,
					contextId,
					TaskState.TASK_STATE_COMPLETED,
					"Done.",
				);
				eventBus.finished();
				return;

			case "fail":
				// The v1 failure idiom: one FAILED terminal status update whose
				// `status.message` carries the error text.
				this.publishStatus(
					eventBus,
					taskId,
					contextId,
					TaskState.TASK_STATE_FAILED,
					"Failed on request.",
				);
				eventBus.finished();
				return;

			case "reject":
				this.publishStatus(
					eventBus,
					taskId,
					contextId,
					TaskState.TASK_STATE_REJECTED,
					"Rejected on request.",
				);
				eventBus.finished();
				return;

			case "input-required":
				// Non-terminal, but stream-interrupting under the v1 model: the
				// run stops here and waits for the caller, and the queue closes.
				this.publishStatus(
					eventBus,
					taskId,
					contextId,
					TaskState.TASK_STATE_INPUT_REQUIRED,
					"Waiting for input.",
				);
				eventBus.finished();
				return;

			case "slow": {
				// Stay `working` until something stops us. A cancel publishes the
				// terminal status itself; a kill publishes nothing at all, which is
				// precisely the state the boot sweep exists to clean up.
				const outcome = await new Promise<"canceled" | "killed">((resolve) => {
					this.active.set(taskId, { contextId, bus: eventBus, release: resolve });
				});
				this.active.delete(taskId);
				if (outcome === "killed") return;
				return;
			}
		}
	}

	async cancelTask(
		taskId: string,
		eventBus: ExecutionEventBus,
	): Promise<void> {
		const run = this.active.get(taskId);
		// Terminal state — ends the stream under the v1 model.
		this.publishStatus(
			eventBus,
			taskId,
			run?.contextId ?? "",
			TaskState.TASK_STATE_CANCELED,
			"Canceled by the caller.",
		);
		eventBus.finished();
		run?.release("canceled");
	}

	/**
	 * Drop every in-flight run the way a stopped container does: no terminal
	 * event, no chance to tidy up. The bus is closed so nothing is left waiting
	 * on a generation of the agent that no longer exists, but the Task record
	 * stays exactly as it was — mid-flight, with nobody working on it.
	 */
	kill(): void {
		for (const [taskId, run] of this.active) {
			this.active.delete(taskId);
			run.release("killed");
			run.bus.finished();
		}
	}

	private publishStatus(
		eventBus: ExecutionEventBus,
		taskId: string,
		contextId: string,
		state: TaskState,
		text?: string,
	): void {
		// No `final` flag in v1 — whether this ends the stream is decided by
		// the server from `status.state` itself (terminal or INPUT_REQUIRED).
		eventBus.publish(
			AgentEvent.statusUpdate({
				taskId,
				contextId,
				status: {
					state,
					timestamp: new Date().toISOString(),
					message: text
						? agentMessage({ text, taskId, contextId })
						: undefined,
				},
				metadata: undefined,
			}),
		);
	}
}
