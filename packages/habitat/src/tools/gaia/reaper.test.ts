import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TaskStateSummary } from "@umwelten/protocols";
import { GaiaRegistryManager } from "./registry.js";
import type { ContainerStatus, GaiaHabitatEntry } from "./types.js";
import {
	DEFAULT_REAPER_CONFIG,
	decideReap,
	lastActivityFor,
	recordHabitatActivity,
	resolveReaperConfig,
	runReapPass,
	type HabitatActivityReport,
	type ReaperConfig,
} from "./reaper.js";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const minutesAgo = (m: number) =>
	new Date(NOW.getTime() - m * 60_000).toISOString();

function tasks(overrides: Partial<TaskStateSummary> = {}): TaskStateSummary {
	return {
		total: 0,
		active: 0,
		interrupted: 0,
		terminal: 0,
		activeTaskIds: [],
		byState: {},
		...overrides,
	};
}

function report(
	overrides: Partial<HabitatActivityReport> = {},
): HabitatActivityReport {
	return { lastRequestAt: minutesAgo(90), tasks: tasks(), ...overrides };
}

function entry(overrides: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
	return {
		id: "h",
		name: "H",
		config: { name: "H", agents: [] },
		secretBindings: [],
		apiKey: "k",
		containerPort: 7440,
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	} as GaiaHabitatEntry;
}

const config: ReaperConfig = {
	enabled: true,
	idleThresholdMs: 30 * 60_000,
	intervalMs: 60_000,
};

describe("decideReap", () => {
	it("stops a habitat idle past the threshold", () => {
		const d = decideReap({
			entry: entry(),
			containerStatus: "running",
			activity: report({ lastRequestAt: minutesAgo(45) }),
			config,
			now: NOW,
		});
		expect(d.action).toBe("stop");
		expect(d.code).toBe("stopped-idle");
		expect(d.reason).toContain("45m");
	});

	it("never stops a habitat holding mid-flight tasks, however idle", () => {
		const d = decideReap({
			entry: entry(),
			containerStatus: "running",
			// Idle for a week, but still holding work.
			activity: report({
				lastRequestAt: minutesAgo(60 * 24 * 7),
				tasks: tasks({ total: 2, active: 2, activeTaskIds: ["t1", "t2"] }),
			}),
			config,
			now: NOW,
		});
		expect(d.action).toBe("keep");
		expect(d.code).toBe("holds-active-tasks");
		expect(d.blockingTaskIds).toEqual(["t1", "t2"]);
	});

	it("treats a habitat whose only tasks await input as reapable", () => {
		// input-required / auth-required are waiting on a human who may take
		// days. They survive the stop (#267), so they must not pin the fleet.
		const d = decideReap({
			entry: entry(),
			containerStatus: "running",
			activity: report({
				lastRequestAt: minutesAgo(45),
				tasks: tasks({ total: 3, interrupted: 3 }),
			}),
			config,
			now: NOW,
		});
		expect(d.action).toBe("stop");
		expect(d.reason).toContain("awaiting input");
	});

	it("keeps a habitat inside the threshold", () => {
		const d = decideReap({
			entry: entry(),
			containerStatus: "running",
			activity: report({ lastRequestAt: minutesAgo(5) }),
			config,
			now: NOW,
		});
		expect(d.action).toBe("keep");
		expect(d.code).toBe("within-threshold");
		expect(d.idleMs).toBe(5 * 60_000);
	});

	it("names recent preview use even when agent traffic is stale", () => {
		const d = decideReap({
			entry: entry(),
			containerStatus: "running",
			activity: report({
				lastRequestAt: minutesAgo(90),
				lastPreviewRequestAt: minutesAgo(3),
			}),
			config,
			now: NOW,
		});
		expect(d.action).toBe("keep");
		expect(d.code).toBe("active-preview");
	});

	it("uses recent agent traffic when preview traffic is stale", () => {
		const d = decideReap({
			entry: entry({ lastPreviewActivityAt: minutesAgo(90) }),
			containerStatus: "running",
			activity: report({ lastRequestAt: minutesAgo(3) }),
			config,
			now: NOW,
		});
		expect(d.action).toBe("keep");
		expect(d.code).toBe("within-threshold");
	});

	it("refuses to stop a habitat it could not reach", () => {
		// Unreachable means its task load is unknown, and a wrong stop costs
		// abandoned work while a wrong keep costs one container's memory.
		const d = decideReap({
			entry: entry({ lastActivityAt: minutesAgo(600) }),
			containerStatus: "running",
			activity: null,
			activityError: "ECONNREFUSED",
			config,
			now: NOW,
		});
		expect(d.action).toBe("keep");
		expect(d.code).toBe("activity-unknown");
		expect(d.reason).toContain("ECONNREFUSED");
	});

	it("refuses to stop a habitat with no activity evidence at all", () => {
		const d = decideReap({
			entry: entry(),
			containerStatus: "running",
			activity: { tasks: tasks() },
			config,
			now: NOW,
		});
		expect(d.action).toBe("keep");
		expect(d.code).toBe("activity-unknown");
	});

	it("leaves a habitat that is not running alone", () => {
		for (const status of [
			"exited",
			"not-found",
			"created",
			"dead",
		] as ContainerStatus[]) {
			const d = decideReap({
				entry: entry({ lastActivityAt: minutesAgo(9999) }),
				containerStatus: status,
				activity: null,
				config,
				now: NOW,
			});
			expect(d.action).toBe("keep");
			expect(d.code).toBe("not-running");
		}
	});

	it("honours a configured threshold rather than a fixed one", () => {
		const activity = report({ lastRequestAt: minutesAgo(45) });
		const strict = decideReap({
			entry: entry(),
			containerStatus: "running",
			activity,
			config: { ...config, idleThresholdMs: 10 * 60_000 },
			now: NOW,
		});
		const lenient = decideReap({
			entry: entry(),
			containerStatus: "running",
			activity,
			config: { ...config, idleThresholdMs: 4 * 60 * 60_000 },
			now: NOW,
		});
		expect(strict.action).toBe("stop");
		expect(lenient.action).toBe("keep");
	});

	it("gives every decision a reason, refusals included", () => {
		const inputs = [
			{ containerStatus: "exited" as ContainerStatus, activity: null },
			{ containerStatus: "running" as ContainerStatus, activity: null },
			{
				containerStatus: "running" as ContainerStatus,
				activity: report({ tasks: tasks({ active: 1, activeTaskIds: ["t"] }) }),
			},
			{
				containerStatus: "running" as ContainerStatus,
				activity: report({ lastRequestAt: minutesAgo(1) }),
			},
			{
				containerStatus: "running" as ContainerStatus,
				activity: report({ lastRequestAt: minutesAgo(200) }),
			},
		];
		for (const input of inputs) {
			const d = decideReap({ entry: entry(), config, now: NOW, ...input });
			expect(d.reason.length).toBeGreaterThan(10);
			expect(d.code).toBeTruthy();
		}
	});
});

describe("lastActivityFor", () => {
	it("takes the habitat's own report when it is newer than Gaia's record", () => {
		// The habitat sees traffic that arrives on its public hostname and never
		// touches Gaia — trusting Gaia's record alone would reap a busy habitat.
		expect(
			lastActivityFor(
				entry({ lastActivityAt: minutesAgo(500) }),
				report({ lastRequestAt: minutesAgo(2) }),
			),
		).toBe(minutesAgo(2));
	});

	it("keeps Gaia's record when the habitat has served nothing since booting", () => {
		expect(
			lastActivityFor(entry({ lastActivityAt: minutesAgo(3) }), {
				lastRequestAt: null,
				startedAt: minutesAgo(400),
				tasks: tasks(),
			}),
		).toBe(minutesAgo(3));
	});

	it("falls back to the habitat's start time when nothing else is known", () => {
		expect(
			lastActivityFor(entry(), {
				lastRequestAt: null,
				startedAt: minutesAgo(10),
				tasks: tasks(),
			}),
		).toBe(minutesAgo(10));
	});

	it("returns null when there is no evidence anywhere", () => {
		expect(lastActivityFor(entry(), null)).toBeNull();
	});
});

describe("resolveReaperConfig", () => {
	it("is enabled by default", () => {
		expect(resolveReaperConfig({})).toEqual(DEFAULT_REAPER_CONFIG);
	});

	it("can be disabled entirely", () => {
		for (const v of ["off", "false", "0", "no", "OFF"]) {
			expect(resolveReaperConfig({ GAIA_IDLE_REAP: v }).enabled).toBe(false);
		}
	});

	it("reads the threshold and interval in minutes", () => {
		const c = resolveReaperConfig({
			GAIA_IDLE_REAP_MINUTES: "90",
			GAIA_IDLE_REAP_INTERVAL_MINUTES: "2",
		});
		expect(c.idleThresholdMs).toBe(90 * 60_000);
		expect(c.intervalMs).toBe(2 * 60_000);
	});

	it("falls back to the default on a nonsense value rather than disabling", () => {
		// A typo in a threshold must not silently switch off the thing keeping
		// the host alive.
		const c = resolveReaperConfig({
			GAIA_IDLE_REAP_MINUTES: "soon",
			GAIA_IDLE_REAP_INTERVAL_MINUTES: "-5",
		});
		expect(c.idleThresholdMs).toBe(DEFAULT_REAPER_CONFIG.idleThresholdMs);
		expect(c.intervalMs).toBe(DEFAULT_REAPER_CONFIG.intervalMs);
	});
});

describe("runReapPass", () => {
	let dataDir: string;
	let registry: GaiaRegistryManager;
	let stopped: string[];
	let started: string[];
	let removedVolumes: string[];
	let logs: string[];

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "gaia-reaper-"));
		registry = new GaiaRegistryManager(dataDir);
		await registry.load();
		stopped = [];
		started = [];
		removedVolumes = [];
		logs = [];
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	function docker(statuses: Record<string, ContainerStatus>) {
		return {
			getStatus: async (id: string): Promise<ContainerStatus> =>
				statuses[id] ?? "not-found",
			stopContainer: async (id: string) => {
				stopped.push(id);
			},
			// Present so a test can assert the reaper never reaches for them.
			startContainer: async (e: GaiaHabitatEntry) => {
				started.push(e.id);
				return 7440;
			},
			removeVolume: async (id: string) => {
				removedVolumes.push(id);
			},
		};
	}

	async function register(
		id: string,
		opts: { port?: number; lastActivityAt?: string } = {},
	) {
		await registry.create({ id, name: id });
		await registry.update(id, {
			containerPort: opts.port ?? 7440,
			...(opts.lastActivityAt ? { lastActivityAt: opts.lastActivityAt } : {}),
		});
	}

	const deps = (
		statuses: Record<string, ContainerStatus>,
		activity: Record<string, HabitatActivityReport | Error>,
		overrides: Partial<ReaperConfig> = {},
	) => ({
		registry,
		docker: docker(statuses) as any,
		config: { ...config, ...overrides },
		now: () => NOW,
		log: (line: string) => logs.push(line),
		fetchActivity: async (e: GaiaHabitatEntry) => {
			const r = activity[e.id];
			if (!r) throw new Error(`unreachable`);
			if (r instanceof Error) throw r;
			return r;
		},
	});

	it("stops an idle habitat and reports it", async () => {
		await register("idle", { lastActivityAt: minutesAgo(200) });

		const result = await runReapPass(
			deps({ idle: "running" }, { idle: report({ lastRequestAt: minutesAgo(200) }) }),
		);

		expect(result.stopped).toEqual(["idle"]);
		expect(stopped).toEqual(["idle"]);
		expect(result.decisions[0].code).toBe("stopped-idle");
	});

	it("preserves the volume when it stops a habitat", async () => {
		// The next start has to be warm — a reap that destroyed the volume would
		// turn every wake into a full re-provision.
		await register("idle", { lastActivityAt: minutesAgo(200) });
		await runReapPass(
			deps({ idle: "running" }, { idle: report({ lastRequestAt: minutesAgo(200) }) }),
		);
		expect(removedVolumes).toEqual([]);
	});

	it("never starts anything, so a deliberately stopped habitat stays stopped", async () => {
		await register("off-on-purpose", { lastActivityAt: minutesAgo(5) });

		const result = await runReapPass(
			deps({ "off-on-purpose": "exited" }, {}),
		);

		expect(started).toEqual([]);
		expect(stopped).toEqual([]);
		expect(result.decisions[0].code).toBe("not-running");
	});

	it("does not stop a habitat holding mid-flight tasks", async () => {
		await register("busy", { lastActivityAt: minutesAgo(500) });

		const result = await runReapPass(
			deps(
				{ busy: "running" },
				{
					busy: report({
						lastRequestAt: minutesAgo(500),
						tasks: tasks({ total: 1, active: 1, activeTaskIds: ["t1"] }),
					}),
				},
			),
		);

		expect(stopped).toEqual([]);
		expect(result.decisions[0].code).toBe("holds-active-tasks");
	});

	it("does not stop a habitat it cannot reach", async () => {
		await register("unreachable", { lastActivityAt: minutesAgo(500) });

		await runReapPass(
			deps(
				{ unreachable: "running" },
				{ unreachable: new Error("socket hang up") },
			),
		);

		expect(stopped).toEqual([]);
		expect(logs.join("\n")).toContain("socket hang up");
	});

	it("logs every decision with its reason, refusals included", async () => {
		await register("busy", { lastActivityAt: minutesAgo(500) });
		await register("idle", { lastActivityAt: minutesAgo(500) });

		await runReapPass(
			deps(
				{ busy: "running", idle: "running" },
				{
					busy: report({
						lastRequestAt: minutesAgo(500),
						tasks: tasks({ total: 1, active: 1, activeTaskIds: ["t1"] }),
					}),
					idle: report({ lastRequestAt: minutesAgo(500) }),
				},
			),
		);

		expect(logs).toHaveLength(2);
		expect(logs.find((l) => l.includes("busy"))).toContain("KEEP");
		expect(logs.find((l) => l.includes("busy"))).toContain("abandon");
		expect(logs.find((l) => l.includes("idle"))).toContain("STOP");
	});

	it("does nothing at all when reaping is disabled", async () => {
		await register("idle", { lastActivityAt: minutesAgo(9999) });

		const result = await runReapPass(
			deps({ idle: "running" }, { idle: report() }, { enabled: false }),
		);

		expect(result).toEqual({ decisions: [], stopped: [] });
		expect(stopped).toEqual([]);
		expect(logs).toEqual([]);
	});

	it("records what the habitat reported, so the fleet remembers across a Gaia restart", async () => {
		await register("busy", { lastActivityAt: minutesAgo(500) });

		await runReapPass(
			deps(
				{ busy: "running" },
				{
					busy: report({
						lastRequestAt: minutesAgo(1),
						tasks: tasks({ total: 1, active: 1, activeTaskIds: ["t1"] }),
					}),
				},
			),
		);

		const reloaded = new GaiaRegistryManager(dataDir);
		await reloaded.load();
		expect(reloaded.get("busy")?.lastActivityAt).toBe(minutesAgo(1));
	});

	it("keeps a habitat busy on its own hostname, which Gaia never saw", async () => {
		// Gaia last recorded traffic hours ago; the habitat itself served a
		// request a minute ago. Trusting only Gaia's record would reap it.
		await register("direct", { lastActivityAt: minutesAgo(600) });

		const result = await runReapPass(
			deps(
				{ direct: "running" },
				{ direct: report({ lastRequestAt: minutesAgo(1) }) },
			),
		);

		expect(stopped).toEqual([]);
		expect(result.decisions[0].code).toBe("within-threshold");
	});

	it("keeps a habitat when Docker refuses the stop, and says so", async () => {
		await register("stubborn", { lastActivityAt: minutesAgo(500) });
		const base = deps(
			{ stubborn: "running" },
			{ stubborn: report({ lastRequestAt: minutesAgo(500) }) },
		);
		base.docker.stopContainer = async () => {
			throw new Error("docker daemon not responding");
		};

		const result = await runReapPass(base);

		expect(result.stopped).toEqual([]);
		expect(result.decisions[0].code).toBe("stop-failed");
		expect(result.decisions[0].action).toBe("keep");
		expect(logs.join("\n")).toContain("docker daemon not responding");
	});
});

describe("recordHabitatActivity", () => {
	let dataDir: string;
	let registry: GaiaRegistryManager;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "gaia-activity-"));
		registry = new GaiaRegistryManager(dataDir);
		await registry.load();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("persists activity so it survives a Gaia restart", async () => {
		await registry.create({ id: "h", name: "H" });
		await recordHabitatActivity(registry, "h", NOW);

		const reloaded = new GaiaRegistryManager(dataDir);
		await reloaded.load();
		expect(reloaded.get("h")?.lastActivityAt).toBe(NOW.toISOString());
	});

	it("ignores an unknown habitat rather than throwing into the request path", async () => {
		// This runs on the proxy hot path; a stale id must not 500 a request.
		await expect(
			recordHabitatActivity(registry, "gone", NOW),
		).resolves.toBeUndefined();
	});
});
