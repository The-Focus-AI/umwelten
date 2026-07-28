/**
 * A scripted agent that can be driven to any point in the Task lifecycle.
 *
 * The suite needs an agent that ends `failed` on request, sits `working` until
 * something stops it, and stops waiting for input on cue. A model cannot be
 * relied on for any of that, so the reference target is this: an
 * `AgentExecutor` that reads a directive out of the message text and produces
 * exactly the lifecycle asked for.
 *
 * It is also the reference for what a *correct* A2A agent looks like from the
 * task surface's point of view: every run ends by publishing a terminal (or
 * deliberately interrupted) status, so a caller polling `tasks/get` learns the
 * outcome. An agent whose last event is a bare message leaves its Task at
 * `working` forever.
 */

import { randomUUID } from "node:crypto";
import type { Task, TaskState, TextPart } from "@a2a-js/sdk";
import type {
	AgentExecutor,
	ExecutionEventBus,
	RequestContext,
} from "@a2a-js/sdk/server";
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

function textOf(context: RequestContext): string {
	return (context.userMessage.parts ?? [])
		.filter((part): part is TextPart => part.kind === "text")
		.map((part) => part.text)
		.join("\n");
}

export class ScriptedConformanceAgent implements AgentExecutor {
	private readonly active = new Map<string, ActiveRun>();

	async execute(
		context: RequestContext,
		eventBus: ExecutionEventBus,
	): Promise<void> {
		const { taskId, contextId, userMessage } = context;
		const intent = intentFromText(textOf(context));

		// The initial Task record is what makes the run addressable: without it
		// `tasks/cancel` reports taskNotFound and every status update after this
		// is dropped as belonging to an unknown task.
		if (!context.task) {
			eventBus.publish({
				kind: "task",
				id: taskId,
				contextId,
				status: { state: "submitted", timestamp: new Date().toISOString() },
				history: [userMessage],
			} satisfies Task);
		}

		this.publishStatus(eventBus, taskId, contextId, "working", false);

		switch (intent) {
			case "quick":
				this.publishStatus(
					eventBus,
					taskId,
					contextId,
					"completed",
					true,
					"Done.",
				);
				eventBus.finished();
				return;

			case "fail":
				this.publishStatus(
					eventBus,
					taskId,
					contextId,
					"failed",
					true,
					"Failed on request.",
				);
				eventBus.finished();
				return;

			case "reject":
				this.publishStatus(
					eventBus,
					taskId,
					contextId,
					"rejected",
					true,
					"Rejected on request.",
				);
				eventBus.finished();
				return;

			case "input-required":
				this.publishStatus(
					eventBus,
					taskId,
					contextId,
					"input-required",
					true,
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
		this.publishStatus(
			eventBus,
			taskId,
			run?.contextId ?? "",
			"canceled",
			true,
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
		final: boolean,
		text?: string,
	): void {
		eventBus.publish({
			kind: "status-update",
			taskId,
			contextId,
			final,
			status: {
				state,
				timestamp: new Date().toISOString(),
				...(text
					? {
							message: {
								kind: "message" as const,
								messageId: randomUUID(),
								role: "agent" as const,
								taskId,
								contextId,
								parts: [{ kind: "text" as const, text }],
							},
						}
					: {}),
			},
		});
	}
}
