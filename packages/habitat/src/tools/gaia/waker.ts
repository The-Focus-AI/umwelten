/**
 * Wake a Dormant habitat when it is asked (umwelten #279).
 *
 * Once habitats sleep by design (ADR 0007), "Habitat X is not running" stops
 * being an error and starts being the normal state of most of the fleet most
 * of the time. Refusing the caller would make sleeping visible as a failure
 * rather than as latency, which is the whole thing sleeping is supposed to
 * avoid.
 *
 * So asking wakes. Two properties make that safe to do on every ask:
 *
 *  - **Wakes coalesce.** Five callers asking a sleeping habitat at once must
 *    start one container, not five. An in-flight map keyed by habitat id
 *    gives every concurrent caller the same promise. The entry is dropped in
 *    a `finally`, so a failed wake is retried by the next ask rather than
 *    being cached as broken forever.
 *
 *  - **A failed start is reported, not swallowed.** The outcome carries the
 *    reason so the caller's Task can move to `failed` with something
 *    actionable in it. A Task left pending on a container that will never
 *    come up is worse than an error.
 *
 * Refreshing a stale habitat on wake is deliberately *not* implemented here.
 * #276 put the stale mark on the habitat's own volume precisely so the
 * habitat's provisioner promotes its own next start to a refresh and clears
 * the mark afterwards. Doing it from this side would mean Gaia clearing a
 * mark it cannot know was acted on — "I asked" recorded as "it happened".
 */

import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import type { ContainerStatus, GaiaHabitatEntry } from "./types.js";

export type WakeAction = "already-running" | "woken" | "not-found" | "failed";

export interface WakeOutcome {
	id: string;
	action: WakeAction;
	detail: string;
	/** Host port the habitat is serving on. Absent unless it is up. */
	port?: number;
	/** True when this caller's ask joined a wake another caller had started. */
	coalesced?: boolean;
}

/** True when a habitat in this container state can serve a request as-is. */
export function isServing(
	status: ContainerStatus,
	entry: Pick<GaiaHabitatEntry, "containerPort">,
): boolean {
	return status === "running" && typeof entry.containerPort === "number";
}

/**
 * The seam the tests inject.
 *
 * `start` is the whole start path — seeding, boot tokens, `docker run`,
 * recording the port and the activity. Injecting at that altitude keeps this
 * module about *when and how often* to start, not about how starting works.
 */
export interface WakeContext {
	getEntry(id: string): GaiaHabitatEntry | undefined;
	getStatus(id: string): Promise<ContainerStatus>;
	start(id: string): Promise<number>;
}

export class HabitatWaker {
	private readonly inFlight = new Map<string, Promise<WakeOutcome>>();

	constructor(private readonly ctx: WakeContext) {}

	/** How many wakes are running right now. Diagnostics and tests. */
	get pendingCount(): number {
		return this.inFlight.size;
	}

	isPending(id: string): boolean {
		return this.inFlight.has(id);
	}

	/**
	 * Ensure a habitat is serving, starting it if it is not.
	 *
	 * Never throws — a caller asking a habitat wants an answer about the
	 * habitat, and turning "it would not boot" into an exception several
	 * frames up makes that answer harder to give, not easier.
	 */
	async wake(id: string): Promise<WakeOutcome> {
		const existing = this.inFlight.get(id);
		if (existing) {
			const outcome = await existing;
			return { ...outcome, coalesced: true };
		}

		const run = this.doWake(id).finally(() => {
			// Dropped whatever the outcome was. A habitat that failed to boot
			// may boot on the next ask — the operator may have just fixed the
			// thing that broke it — and a habitat that woke fine has nothing
			// left in flight to join.
			this.inFlight.delete(id);
		});
		this.inFlight.set(id, run);
		return await run;
	}

	private async doWake(id: string): Promise<WakeOutcome> {
		const entry = this.ctx.getEntry(id);
		if (!entry) {
			return { id, action: "not-found", detail: `Habitat "${id}" not found` };
		}

		let status: ContainerStatus;
		try {
			status = await this.ctx.getStatus(id);
		} catch (err) {
			return {
				id,
				action: "failed",
				detail: `Could not determine container status for "${id}": ${reasonOf(err)}`,
			};
		}

		if (isServing(status, entry)) {
			return {
				id,
				action: "already-running",
				detail: `Habitat "${id}" is already running.`,
				port: entry.containerPort,
			};
		}

		try {
			const port = await this.ctx.start(id);
			return {
				id,
				action: "woken",
				detail: `Woke habitat "${id}" on port ${port}.`,
				port,
			};
		} catch (err) {
			return {
				id,
				action: "failed",
				detail: `Habitat "${id}" failed to start: ${reasonOf(err)}`,
			};
		}
	}
}

function reasonOf(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

/**
 * A habitat that is running but has no recorded port is not serving — it is
 * a container Gaia has lost track of. Restarting it is the only way to learn
 * the port again, so it takes the wake path rather than the already-running
 * one, which is what `isServing` encodes.
 */
export function createWakeTools(
	waker: HabitatWaker,
	deps: { listIds(): string[] },
): Record<string, Tool> {
	return {
		wake_habitat: tool({
			description:
				"Ensure a habitat is running, starting it if it is dormant. Asking a habitat already does this, so call it explicitly only when you want it warm before a burst of questions. Concurrent calls for the same habitat start it once.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID to wake"),
			}),
			execute: async ({ id }) => {
				const outcome = await waker.wake(id);
				if (outcome.action === "not-found") {
					const known = deps.listIds();
					return known.length
						? `${outcome.detail}. Known habitats: ${known.join(", ")}`
						: outcome.detail;
				}
				return outcome.detail;
			},
		}),
	};
}
