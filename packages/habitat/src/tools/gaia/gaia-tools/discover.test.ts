import { describe, expect, it, vi } from "vitest";
import type { AgentCardSummary } from "@umwelten/protocols";
import type { GaiaHabitatEntry } from "../types.js";
import { discoverHabitats } from "./context.js";

const CARD: AgentCardSummary = { name: "Upperhand", description: "client agent" };
const OLD_CARD: AgentCardSummary = { name: "Upperhand", description: "older" };

function entry(overrides: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
	return {
		id: "uh",
		name: "Upperhand",
		config: { name: "Upperhand", agents: [] },
		secretBindings: [],
		apiKey: "k",
		createdAt: "2026-07-01T00:00:00.000Z",
		...overrides,
	} as GaiaHabitatEntry;
}

const now = () => "2026-07-26T00:00:00.000Z";

describe("discoverHabitats", () => {
	it("queries a running habitat live", async () => {
		const fetchCard = vi.fn().mockResolvedValue(CARD);
		const [result] = await discoverHabitats([entry({ containerPort: 7440 })], {
			fetchCard,
			now,
		});

		expect(result).toMatchObject({ id: "uh", card: CARD, cached: false });
		expect(fetchCard).toHaveBeenCalledOnce();
	});

	/**
	 * The whole point of the cache: a fleet that sleeps by design would
	 * otherwise report almost nothing (ADR 0008).
	 */
	it("reports a dormant habitat from its cached card", async () => {
		const fetchCard = vi.fn();
		const [result] = await discoverHabitats(
			[entry({ cachedCard: { card: CARD, fetchedAt: "2026-07-20T00:00:00.000Z" } })],
			{ fetchCard, now },
		);

		expect(result).toMatchObject({
			id: "uh",
			card: CARD,
			cached: true,
			fetchedAt: "2026-07-20T00:00:00.000Z",
		});
		// Finding out what a habitat can do must never wake it.
		expect(fetchCard).not.toHaveBeenCalled();
	});

	it("distinguishes a never-started habitat from a stale one", async () => {
		const [result] = await discoverHabitats([entry()], { fetchCard: vi.fn(), now });
		expect(result).toMatchObject({ id: "uh" });
		expect((result as { error: string }).error).toMatch(/not been started/);
		expect((result as { card?: unknown }).card).toBeUndefined();
	});

	it("stamps a freshly fetched card with the time it was captured", async () => {
		const [result] = await discoverHabitats([entry({ containerPort: 7440 })], {
			fetchCard: vi.fn().mockResolvedValue(CARD),
			now,
		});
		expect(result).toMatchObject({ fetchedAt: "2026-07-26T00:00:00.000Z" });
	});

	it("warms the cache from a running habitat", async () => {
		const saveCard = vi.fn().mockResolvedValue(undefined);
		await discoverHabitats([entry({ containerPort: 7440 })], {
			fetchCard: vi.fn().mockResolvedValue(CARD),
			saveCard,
			now,
		});
		expect(saveCard).toHaveBeenCalledWith("uh", CARD, "2026-07-26T00:00:00.000Z");
	});

	it("does not warm the cache for a dormant habitat", async () => {
		const saveCard = vi.fn();
		await discoverHabitats(
			[entry({ cachedCard: { card: CARD, fetchedAt: "2026-07-20T00:00:00.000Z" } })],
			{ fetchCard: vi.fn(), saveCard, now },
		);
		expect(saveCard).not.toHaveBeenCalled();
	});

	it("still answers when the cache write fails", async () => {
		const [result] = await discoverHabitats([entry({ containerPort: 7440 })], {
			fetchCard: vi.fn().mockResolvedValue(CARD),
			saveCard: vi.fn().mockRejectedValue(new Error("registry is read-only")),
			now,
		});
		// A registry hiccup must not take discovery down with it.
		expect(result).toMatchObject({ card: CARD, cached: false });
	});

	/**
	 * A transient blip should degrade the Directory to stale, not to empty.
	 */
	it("keeps the previous card when a live fetch fails", async () => {
		const [result] = await discoverHabitats(
			[
				entry({
					containerPort: 7440,
					cachedCard: { card: OLD_CARD, fetchedAt: "2026-07-20T00:00:00.000Z" },
				}),
			],
			{ fetchCard: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")), now },
		);

		expect(result).toMatchObject({
			id: "uh",
			card: OLD_CARD,
			fetchedAt: "2026-07-20T00:00:00.000Z",
		});
		expect((result as { error: string }).error).toMatch(/ECONNREFUSED/);
	});

	it("reports a fetch failure with no cache as a plain error", async () => {
		const [result] = await discoverHabitats([entry({ containerPort: 7440 })], {
			fetchCard: vi.fn().mockRejectedValue(new Error("boom")),
			now,
		});
		expect(result).toMatchObject({ id: "uh", error: "boom" });
		expect((result as { card?: unknown }).card).toBeUndefined();
	});

	it("reports every habitat in the fleet, mixed states and all", async () => {
		const results = await discoverHabitats(
			[
				entry({ id: "awake", containerPort: 7440 }),
				entry({
					id: "asleep",
					cachedCard: { card: CARD, fetchedAt: "2026-07-20T00:00:00.000Z" },
				}),
				entry({ id: "never-run" }),
			],
			{ fetchCard: vi.fn().mockResolvedValue(CARD), now },
		);

		expect(results.map((r) => r.id)).toEqual(["awake", "asleep", "never-run"]);
		expect(results.filter((r) => "card" in r && r.card)).toHaveLength(2);
	});

	it("returns nothing for an empty fleet", async () => {
		expect(await discoverHabitats([], { now })).toEqual([]);
	});
});
