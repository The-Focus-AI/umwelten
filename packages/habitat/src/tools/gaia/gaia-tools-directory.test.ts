import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentCardSummary } from "@umwelten/protocols";
import { GaiaRegistryManager } from "./registry.js";
import type { ContainerStatus, GaiaHabitatEntry } from "./types.js";
import {
	buildDirectory,
	type AgentCardFetcher,
	type DirectoryEntry,
} from "./gaia-tools/directory.js";

function card(name: string): AgentCardSummary {
	return {
		name,
		description: `${name} agent`,
		skills: [{ id: "ask", name: "Ask", description: "Answer questions" }],
	};
}

/** Docker stand-in: a fixed status per habitat id, no daemon. */
function fakeDocker(statuses: Record<string, ContainerStatus>) {
	return {
		getStatus: async (id: string): Promise<ContainerStatus> =>
			statuses[id] ?? "not-found",
	};
}

/** Card fetcher stand-in: per-id card or thrown error, plus a call log. */
function fakeFetcher(
	responses: Record<string, AgentCardSummary | Error>,
): AgentCardFetcher & { calls: string[] } {
	const calls: string[] = [];
	const fn = async (entry: GaiaHabitatEntry) => {
		calls.push(entry.id);
		const r = responses[entry.id];
		if (r instanceof Error) throw r;
		if (!r) throw new Error(`no response configured for ${entry.id}`);
		return r;
	};
	return Object.assign(fn, { calls });
}

const AT = new Date("2026-07-26T12:00:00.000Z");
const clock = () => AT;

function byId(directory: DirectoryEntry[], id: string): DirectoryEntry {
	const found = directory.find((d) => d.id === id);
	if (!found) throw new Error(`${id} missing from directory`);
	return found;
}

describe("buildDirectory", () => {
	let dataDir: string;
	let registry: GaiaRegistryManager;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "gaia-directory-"));
		registry = new GaiaRegistryManager(dataDir);
		await registry.load();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	/** Register a habitat, optionally awake (port assigned) with a cached card. */
	async function register(
		id: string,
		opts: { port?: number; cachedAt?: string } = {},
	): Promise<GaiaHabitatEntry> {
		const entry = await registry.create({ id, name: id });
		const updates: Parameters<GaiaRegistryManager["update"]>[1] = {};
		if (opts.port !== undefined) updates.containerPort = opts.port;
		if (opts.cachedAt !== undefined)
			updates.cachedCard = {
				card: card(`${id}-old`),
				capturedAt: opts.cachedAt,
			};
		if (Object.keys(updates).length > 0) await registry.update(id, updates);
		return entry;
	}

	it("returns every registered habitat, including dormant ones", async () => {
		await register("awake-one", { port: 7440 });
		await register("dormant-one", { cachedAt: "2026-07-01T00:00:00.000Z" });
		await register("never-started");

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ "awake-one": "running" }),
			fetchCard: fakeFetcher({ "awake-one": card("awake-one") }),
			now: clock,
		});

		expect(directory.map((d) => d.id).sort()).toEqual([
			"awake-one",
			"dormant-one",
			"never-started",
		]);
	});

	it("reports a dormant habitat's cached capabilities without starting it", async () => {
		await register("dormant-one", { cachedAt: "2026-07-01T00:00:00.000Z" });
		const fetcher = fakeFetcher({});

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ "dormant-one": "exited" }),
			fetchCard: fetcher,
			now: clock,
		});

		const entry = byId(directory, "dormant-one");
		expect(entry.awake).toBe(false);
		expect(entry.containerStatus).toBe("exited");
		expect(entry.cardSource).toBe("cache");
		expect(entry.card?.name).toBe("dormant-one-old");
		expect(entry.card?.skills?.[0]?.id).toBe("ask");
		expect(entry.stale).toBe(true);
		// Nothing was woken, and nothing was even asked.
		expect(fetcher.calls).toEqual([]);
	});

	it("refreshes the card of a habitat that is awake, and persists it", async () => {
		await register("awake-one", {
			port: 7440,
			cachedAt: "2026-07-01T00:00:00.000Z",
		});
		const fetcher = fakeFetcher({ "awake-one": card("awake-one-fresh") });

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ "awake-one": "running" }),
			fetchCard: fetcher,
			now: clock,
		});

		const entry = byId(directory, "awake-one");
		expect(fetcher.calls).toEqual(["awake-one"]);
		expect(entry.cardSource).toBe("live");
		expect(entry.card?.name).toBe("awake-one-fresh");
		expect(entry.stale).toBe(false);
		expect(entry.capturedAt).toBe(AT.toISOString());

		// The refresh survives Gaia restarting: it is on the registry file,
		// which is what a later dormant lookup reads.
		const reloaded = new GaiaRegistryManager(dataDir);
		await reloaded.load();
		expect(reloaded.get("awake-one")?.cachedCard).toEqual({
			card: card("awake-one-fresh"),
			capturedAt: AT.toISOString(),
		});
	});

	it("carries the capture time on every cached card", async () => {
		await register("awake-one", { port: 7440 });
		await register("dormant-one", { cachedAt: "2026-07-01T00:00:00.000Z" });

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ "awake-one": "running" }),
			fetchCard: fakeFetcher({ "awake-one": card("awake-one") }),
			now: clock,
		});

		expect(byId(directory, "awake-one").capturedAt).toBe(AT.toISOString());
		expect(byId(directory, "dormant-one").capturedAt).toBe(
			"2026-07-01T00:00:00.000Z",
		);
	});

	it("distinguishes a never-started habitat from one with a stale card", async () => {
		await register("never-started");
		await register("dormant-one", { cachedAt: "2026-07-01T00:00:00.000Z" });

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({}),
			fetchCard: fakeFetcher({}),
			now: clock,
		});

		const never = byId(directory, "never-started");
		expect(never.cardSource).toBe("none");
		expect(never.card).toBeNull();
		expect(never.capturedAt).toBeNull();
		expect(never.stale).toBe(false);
		expect(never.containerStatus).toBe("not-found");

		const dormant = byId(directory, "dormant-one");
		expect(dormant.cardSource).toBe("cache");
		expect(dormant.card).not.toBeNull();
		expect(dormant.stale).toBe(true);
	});

	it("keeps the previous card when a fetch against a running habitat fails", async () => {
		await register("awake-one", {
			port: 7440,
			cachedAt: "2026-07-01T00:00:00.000Z",
		});

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ "awake-one": "running" }),
			fetchCard: fakeFetcher({ "awake-one": new Error("ECONNREFUSED") }),
			now: clock,
		});

		const entry = byId(directory, "awake-one");
		expect(entry.awake).toBe(true);
		expect(entry.cardSource).toBe("cache");
		expect(entry.card?.name).toBe("awake-one-old");
		expect(entry.capturedAt).toBe("2026-07-01T00:00:00.000Z");
		expect(entry.stale).toBe(true);
		expect(entry.cardError).toContain("ECONNREFUSED");

		// The stored card is untouched — a failed fetch is not evidence that
		// the old answer was wrong.
		expect(registry.get("awake-one")?.cachedCard?.card.name).toBe(
			"awake-one-old",
		);
	});

	it("reports a failing habitat with no cached card as having none, with the error", async () => {
		await register("awake-one", { port: 7440 });

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ "awake-one": "running" }),
			fetchCard: fakeFetcher({ "awake-one": new Error("boom") }),
			now: clock,
		});

		const entry = byId(directory, "awake-one");
		expect(entry.cardSource).toBe("none");
		expect(entry.card).toBeNull();
		expect(entry.cardError).toContain("boom");
	});

	it("treats a stopped container that still carries a port as dormant", async () => {
		// stop_habitat calls update({ containerPort: undefined }), which does
		// not clear the field — so the port outlives the container. Docker is
		// the authority on whether a habitat is awake.
		await register("stopped-one", {
			port: 7441,
			cachedAt: "2026-07-01T00:00:00.000Z",
		});
		const fetcher = fakeFetcher({});

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ "stopped-one": "exited" }),
			fetchCard: fetcher,
			now: clock,
		});

		const entry = byId(directory, "stopped-one");
		expect(entry.awake).toBe(false);
		expect(entry.cardSource).toBe("cache");
		expect(fetcher.calls).toEqual([]);
	});

	it("treats a running container with no port as dormant rather than fetching", async () => {
		await register("portless", { cachedAt: "2026-07-01T00:00:00.000Z" });
		const fetcher = fakeFetcher({});

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ portless: "running" }),
			fetchCard: fetcher,
			now: clock,
		});

		expect(byId(directory, "portless").awake).toBe(false);
		expect(fetcher.calls).toEqual([]);
	});

	it("refreshes several awake habitats in one pass without dropping dormant ones", async () => {
		await register("a", { port: 7440 });
		await register("b", { port: 7441, cachedAt: "2026-07-01T00:00:00.000Z" });
		await register("c", { cachedAt: "2026-06-01T00:00:00.000Z" });

		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({ a: "running", b: "running" }),
			fetchCard: fakeFetcher({ a: card("a-fresh"), b: card("b-fresh") }),
			now: clock,
		});

		expect(byId(directory, "a").cardSource).toBe("live");
		expect(byId(directory, "b").cardSource).toBe("live");
		expect(byId(directory, "c").cardSource).toBe("cache");

		const reloaded = new GaiaRegistryManager(dataDir);
		await reloaded.load();
		expect(reloaded.get("a")?.cachedCard?.card.name).toBe("a-fresh");
		expect(reloaded.get("b")?.cachedCard?.card.name).toBe("b-fresh");
		expect(reloaded.get("c")?.cachedCard?.card.name).toBe("c-old");
	});

	it("returns an empty directory when nothing is registered", async () => {
		const directory = await buildDirectory({
			registry,
			docker: fakeDocker({}),
			fetchCard: fakeFetcher({}),
			now: clock,
		});
		expect(directory).toEqual([]);
	});
});
