import { describe, expect, it, vi } from "vitest";
import { HabitatWaker, isServing, type WakeContext } from "./waker.js";
import type { ContainerStatus, GaiaHabitatEntry } from "./types.js";

function entry(overrides: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
	return {
		id: "upperhand",
		name: "UpperHand",
		config: {} as GaiaHabitatEntry["config"],
		secretBindings: [],
		createdAt: "2026-07-01T00:00:00.000Z",
		...overrides,
	} as GaiaHabitatEntry;
}

/** A waker over a fake fleet, with the knobs each test needs. */
function makeWaker(opts: {
	entries?: Record<string, GaiaHabitatEntry>;
	status?: ContainerStatus | (() => Promise<ContainerStatus>);
	start?: WakeContext["start"];
} = {}) {
	const entries = opts.entries ?? { upperhand: entry({ containerPort: undefined }) };
	const getStatus = vi.fn(async (_id: string) => {
		if (typeof opts.status === "function") return await opts.status();
		return opts.status ?? ("exited" as ContainerStatus);
	});
	const start =
		opts.start ??
		vi.fn(async (id: string) => {
			entries[id] = { ...entries[id], containerPort: 7440 };
			return 7440;
		});
	const waker = new HabitatWaker({
		getEntry: (id) => entries[id],
		getStatus,
		start,
	});
	return { waker, entries, getStatus, start: start as ReturnType<typeof vi.fn> };
}

describe("isServing", () => {
	it("requires both a running container and a known port", () => {
		expect(isServing("running", { containerPort: 7440 })).toBe(true);
		expect(isServing("running", { containerPort: undefined })).toBe(false);
		expect(isServing("exited", { containerPort: 7440 })).toBe(false);
	});
});

describe("HabitatWaker", () => {
	it("starts a dormant habitat rather than refusing it", async () => {
		const { waker, start } = makeWaker({ status: "exited" });

		const outcome = await waker.wake("upperhand");

		expect(outcome.action).toBe("woken");
		expect(outcome.port).toBe(7440);
		expect(start).toHaveBeenCalledOnce();
	});

	it("leaves a running habitat alone", async () => {
		const { waker, start } = makeWaker({
			entries: { upperhand: entry({ containerPort: 7440 }) },
			status: "running",
		});

		const outcome = await waker.wake("upperhand");

		expect(outcome.action).toBe("already-running");
		expect(outcome.port).toBe(7440);
		expect(start).not.toHaveBeenCalled();
	});

	/**
	 * A container Docker calls running but whose port Gaia has lost is not
	 * serving anything a caller can reach. Restarting is the only way to
	 * learn the port again.
	 */
	it("restarts a running container whose port Gaia has lost track of", async () => {
		const { waker, start } = makeWaker({
			entries: { upperhand: entry({ containerPort: undefined }) },
			status: "running",
		});

		const outcome = await waker.wake("upperhand");

		expect(outcome.action).toBe("woken");
		expect(start).toHaveBeenCalledOnce();
	});

	it("reports a habitat it does not know, without starting anything", async () => {
		const { waker, start } = makeWaker();

		const outcome = await waker.wake("nope");

		expect(outcome.action).toBe("not-found");
		expect(outcome.detail).toContain("not found");
		expect(start).not.toHaveBeenCalled();
	});

	/**
	 * The acceptance criterion is that a failed start surfaces its reason so
	 * the caller's Task can move to `failed`. A Task left pending against a
	 * container that will never come up is worse than an error.
	 */
	it("reports why a start failed instead of throwing", async () => {
		const { waker } = makeWaker({
			status: "exited",
			start: async () => {
				throw new Error("no such image: habitat:latest");
			},
		});

		const outcome = await waker.wake("upperhand");

		expect(outcome.action).toBe("failed");
		expect(outcome.detail).toContain("no such image");
	});

	it("reports a docker status probe that fails, without starting blindly", async () => {
		const { waker, start } = makeWaker({
			status: async () => {
				throw new Error("docker daemon unreachable");
			},
		});

		const outcome = await waker.wake("upperhand");

		expect(outcome.action).toBe("failed");
		expect(outcome.detail).toContain("docker daemon unreachable");
		expect(start).not.toHaveBeenCalled();
	});

	describe("concurrency", () => {
		it("starts one container when several callers ask at once", async () => {
			let release!: () => void;
			const gate = new Promise<void>((r) => {
				release = r;
			});
			const start = vi.fn(async () => {
				await gate;
				return 7441;
			});
			const { waker } = makeWaker({ status: "exited", start });

			const asks = [
				waker.wake("upperhand"),
				waker.wake("upperhand"),
				waker.wake("upperhand"),
			];
			expect(waker.pendingCount).toBe(1);
			release();
			const outcomes = await Promise.all(asks);

			expect(start).toHaveBeenCalledOnce();
			// Every caller gets the same answer; the ones that joined say so.
			expect(outcomes.every((o) => o.action === "woken")).toBe(true);
			expect(outcomes.every((o) => o.port === 7441)).toBe(true);
			expect(outcomes.filter((o) => o.coalesced).length).toBe(2);
		});

		it("does not coalesce wakes of different habitats", async () => {
			const entries = {
				a: entry({ id: "a", containerPort: undefined }),
				b: entry({ id: "b", containerPort: undefined }),
			};
			const start = vi.fn(async () => 7442);
			const { waker } = makeWaker({ entries, status: "exited", start });

			await Promise.all([waker.wake("a"), waker.wake("b")]);

			expect(start).toHaveBeenCalledTimes(2);
		});

		/**
		 * A failed wake must not be remembered as failed. The operator may
		 * have fixed the thing that broke it between one ask and the next.
		 */
		it("retries on the next ask after a failed wake", async () => {
			let attempt = 0;
			const start = vi.fn(async () => {
				attempt += 1;
				if (attempt === 1) throw new Error("port 7440 already allocated");
				return 7443;
			});
			const { waker } = makeWaker({ status: "exited", start });

			const first = await waker.wake("upperhand");
			const second = await waker.wake("upperhand");

			expect(first.action).toBe("failed");
			expect(second.action).toBe("woken");
			expect(second.port).toBe(7443);
			expect(start).toHaveBeenCalledTimes(2);
		});

		it("holds nothing in flight once a wake settles", async () => {
			const { waker } = makeWaker({ status: "exited" });

			await waker.wake("upperhand");

			expect(waker.pendingCount).toBe(0);
		});

		it("holds nothing in flight once a wake fails", async () => {
			const { waker } = makeWaker({
				status: "exited",
				start: async () => {
					throw new Error("boom");
				},
			});

			await waker.wake("upperhand");

			expect(waker.pendingCount).toBe(0);
		});
	});
});
