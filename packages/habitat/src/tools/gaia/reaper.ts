/**
 * The idle reaper — stop Habitats nobody is using, and never stop one that
 * is holding work.
 *
 * The runtime plane is a single 16 GB host with no swap, which moved off a
 * smaller box because a fleet of about two was OOM-killing it. Twenty
 * always-on containers is not a thing that fits. ADR 0007 makes sleeping the
 * normal state and gives Tasks somewhere durable to live so that stopping is
 * survivable; this is the part that does the stopping.
 *
 * The safety property is the point, not the feature. A Habitat holding
 * mid-flight Tasks is never stopped, because stopping it is exactly the
 * failure the boot sweep (#273) exists to clean up after — and a cleanup is a
 * worse outcome than a container that stayed up ten minutes longer. Tasks in
 * an interrupted state are a different matter: `input-required` and
 * `auth-required` are waiting on a human who may take days, they survive the
 * stop, and treating them as blocking would keep the whole fleet awake
 * forever.
 *
 * Every decision — including every refusal — carries a reason. A reaper that
 * silently declines to reap is indistinguishable from one that is switched
 * off, and the difference matters at 3am on a host that is out of memory.
 *
 * The reaper only ever stops. It never starts a Habitat, so one stopped
 * deliberately stays stopped.
 */

import type { TaskStateSummary } from "@umwelten/protocols";
import type { GaiaRegistryManager } from "./registry.js";
import type { DockerManager } from "./docker.js";
import type { ContainerStatus, GaiaHabitatEntry } from "./types.js";
import { fetchFromContainer } from "./proxy.js";

/** What a Habitat reports about its own idleness and Task load. */
export interface HabitatActivityReport {
	/** When the habitat's server process started. */
	startedAt?: string;
	/** Last request that was not a health check or an idle probe. */
	lastRequestAt?: string | null;
	/** Last request routed to a supervised project preview. */
	lastPreviewRequestAt?: string | null;
	tasks: TaskStateSummary;
}

/** Why the reaper did or did not stop a Habitat. Stable, greppable codes. */
export type ReapCode =
	| "stopped-idle"
	| "not-running"
	| "holds-active-tasks"
	| "activity-unknown"
	| "within-threshold"
	| "active-preview"
	| "stop-failed";

export interface ReapDecision {
	habitatId: string;
	action: "stop" | "keep";
	code: ReapCode;
	/** One line, written to be read in a log without further context. */
	reason: string;
	/** Milliseconds since the last observed activity, when known. */
	idleMs?: number;
	/** Active Task ids, when those are what blocked the reap. */
	blockingTaskIds?: string[];
}

export interface ReaperConfig {
	/** When false, no pass runs and nothing is ever stopped. */
	enabled: boolean;
	/** Idle time after which a Habitat is eligible to be stopped. */
	idleThresholdMs: number;
	/** How often a pass runs. */
	intervalMs: number;
}

export const DEFAULT_REAPER_CONFIG: ReaperConfig = {
	enabled: true,
	idleThresholdMs: 30 * 60_000,
	intervalMs: 5 * 60_000,
};

/**
 * Reaper settings from the environment.
 *
 * - `GAIA_IDLE_REAP` — `off` / `false` / `0` disables reaping entirely.
 * - `GAIA_IDLE_REAP_MINUTES` — idle threshold.
 * - `GAIA_IDLE_REAP_INTERVAL_MINUTES` — how often to look.
 *
 * Unparseable or non-positive values fall back to the default rather than
 * disabling: a typo in a threshold should not silently switch off the thing
 * keeping the host alive.
 */
export function resolveReaperConfig(
	env: NodeJS.ProcessEnv = process.env,
): ReaperConfig {
	const flag = (env.GAIA_IDLE_REAP ?? "").trim().toLowerCase();
	const enabled = !["off", "false", "0", "no", "disabled"].includes(flag);

	const minutes = (raw: string | undefined, fallbackMs: number): number => {
		const n = Number(raw);
		return Number.isFinite(n) && n > 0 ? n * 60_000 : fallbackMs;
	};

	return {
		enabled,
		idleThresholdMs: minutes(
			env.GAIA_IDLE_REAP_MINUTES,
			DEFAULT_REAPER_CONFIG.idleThresholdMs,
		),
		intervalMs: minutes(
			env.GAIA_IDLE_REAP_INTERVAL_MINUTES,
			DEFAULT_REAPER_CONFIG.intervalMs,
		),
	};
}

/** Everything one decision needs. Assembled by the pass; pure on the way in. */
export interface ReapInput {
	entry: GaiaHabitatEntry;
	containerStatus: ContainerStatus;
	/** The habitat's own report, or null when it could not be obtained. */
	activity: HabitatActivityReport | null;
	/** Why the report is missing, when it is. */
	activityError?: string;
	config: ReaperConfig;
	now: Date;
}

function formatIdle(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h${minutes % 60}m`;
}

/**
 * Most recent activity we can attest to: what the Habitat itself reports, or
 * what Gaia last recorded, whichever is later. The Habitat sees traffic that
 * never passes through Gaia; Gaia's record survives the Habitat's container.
 * Neither alone is the whole truth.
 */
export function lastActivityFor(
	entry: GaiaHabitatEntry,
	activity: HabitatActivityReport | null,
): string | null {
	const candidates = [
		activity?.lastRequestAt ?? null,
		activity?.lastPreviewRequestAt ?? null,
		activity?.startedAt ?? null,
		entry.lastActivityAt ?? null,
		entry.lastPreviewActivityAt ?? null,
	].filter((v): v is string => typeof v === "string" && v.length > 0);
	if (candidates.length === 0) return null;
	return candidates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/**
 * Decide one Habitat's fate. Pure — no Docker, no clock, no network — so the
 * safety property is a property of a function rather than of a timer.
 */
export function decideReap(input: ReapInput): ReapDecision {
	const { entry, containerStatus, activity, activityError, config, now } =
		input;
	const habitatId = entry.id;

	if (containerStatus !== "running") {
		return {
			habitatId,
			action: "keep",
			code: "not-running",
			reason: `Already dormant (container ${containerStatus}); nothing to reap.`,
		};
	}

	// Refuse before measuring idleness. A Habitat we cannot ask is a Habitat
	// whose Task load we do not know, and the cost of a wrong stop is
	// abandoned work while the cost of a wrong keep is one container's memory.
	if (!activity) {
		return {
			habitatId,
			action: "keep",
			code: "activity-unknown",
			reason: `Could not read activity — refusing to stop a habitat whose task load is unknown${
				activityError ? ` (${activityError})` : ""
			}.`,
		};
	}

	if (activity.tasks.active > 0) {
		return {
			habitatId,
			action: "keep",
			code: "holds-active-tasks",
			reason: `Holding ${activity.tasks.active} task(s) still running; stopping would abandon them.`,
			blockingTaskIds: activity.tasks.activeTaskIds,
		};
	}

	const last = lastActivityFor(entry, activity);
	if (!last) {
		return {
			habitatId,
			action: "keep",
			code: "activity-unknown",
			reason:
				"No activity has ever been recorded for this habitat — refusing to stop on no evidence.",
		};
	}

	const idleMs = now.getTime() - Date.parse(last);
	if (idleMs < config.idleThresholdMs) {
		const previewTimes = [
			activity.lastPreviewRequestAt,
			entry.lastPreviewActivityAt,
		].filter((value): value is string => typeof value === "string");
		const recentPreview = previewTimes.some(
			(value) => now.getTime() - Date.parse(value) < config.idleThresholdMs,
		);
		return {
			habitatId,
			action: "keep",
			code: recentPreview ? "active-preview" : "within-threshold",
			reason: recentPreview
				? `Project preview used ${formatIdle(idleMs)} ago; keeping its Habitat active.`
				: `Idle ${formatIdle(idleMs)}, under the ${formatIdle(config.idleThresholdMs)} threshold.`,
			idleMs,
		};
	}

	const waiting =
		activity.tasks.interrupted > 0
			? ` ${activity.tasks.interrupted} task(s) awaiting input survive the stop.`
			: "";
	return {
		habitatId,
		action: "stop",
		code: "stopped-idle",
		reason: `Idle ${formatIdle(idleMs)}, past the ${formatIdle(config.idleThresholdMs)} threshold.${waiting}`,
		idleMs,
	};
}

/** Fetch a Habitat's activity report. Injected so tests need no container. */
export type ActivityFetcher = (
	entry: GaiaHabitatEntry,
) => Promise<HabitatActivityReport>;

const defaultFetchActivity: ActivityFetcher = (entry) =>
	fetchFromContainer<HabitatActivityReport>(entry, "/api/activity");

export interface ReaperDeps {
	registry: GaiaRegistryManager;
	docker: Pick<DockerManager, "getStatus" | "stopContainer">;
	config?: ReaperConfig;
	fetchActivity?: ActivityFetcher;
	now?: () => Date;
	/** Where decisions go. Defaults to the console. */
	log?: (line: string) => void;
}

export interface ReapPassResult {
	decisions: ReapDecision[];
	stopped: string[];
}

/**
 * Record that someone used a Habitat. Persisted on the registry entry, so the
 * fleet does not forget who was busy when Gaia restarts.
 */
export async function recordHabitatActivity(
	registry: GaiaRegistryManager,
	id: string,
	now: Date = new Date(),
): Promise<void> {
	if (!registry.get(id)) return;
	await registry.update(id, { lastActivityAt: now.toISOString() });
}

/** Run one pass over the fleet. Returns every decision, not only the reaps. */
export async function runReapPass(deps: ReaperDeps): Promise<ReapPassResult> {
	const { registry, docker } = deps;
	const config = deps.config ?? DEFAULT_REAPER_CONFIG;
	const fetchActivity = deps.fetchActivity ?? defaultFetchActivity;
	const now = deps.now ?? (() => new Date());
	const log = deps.log ?? ((line: string) => console.log(line));

	if (!config.enabled) return { decisions: [], stopped: [] };

	const decisions: ReapDecision[] = [];
	const stopped: string[] = [];

	for (const entry of registry.list()) {
		const containerStatus = await docker.getStatus(entry.id);

		let activity: HabitatActivityReport | null = null;
		let activityError: string | undefined;
		if (containerStatus === "running" && entry.containerPort) {
			try {
				activity = await fetchActivity(entry);
			} catch (err: any) {
				activityError = err?.message ?? "unreachable";
			}
		} else if (containerStatus === "running") {
			activityError = "no port recorded for a running container";
		}

		const decision = decideReap({
			entry,
			containerStatus,
			activity,
			activityError,
			config,
			now: now(),
		});

		// Persist what the habitat told us, so its own view of when it was last
		// used outlives its container and survives a Gaia restart.
		const observed = lastActivityFor(entry, activity);
		if (observed && observed !== entry.lastActivityAt) {
			await registry.update(entry.id, { lastActivityAt: observed });
		}
		const observedPreview = activity?.lastPreviewRequestAt;
		if (
			observedPreview &&
			(!entry.lastPreviewActivityAt ||
				Date.parse(observedPreview) > Date.parse(entry.lastPreviewActivityAt))
		) {
			await registry.update(entry.id, {
				lastPreviewActivityAt: observedPreview,
			});
		}

		if (decision.action === "stop") {
			try {
				// stopContainer stops and removes the container; the named volume
				// is untouched, so the next start is warm. The entry keeps its
				// recorded port: registry.update() cannot clear a field (it skips
				// undefined), and Docker's status — not the port — is what every
				// reader here treats as the awake signal.
				await docker.stopContainer(entry.id);
				stopped.push(entry.id);
			} catch (err: any) {
				decisions.push({
					...decision,
					action: "keep",
					code: "stop-failed",
					reason: `Wanted to stop (${decision.reason}) but Docker refused: ${err?.message ?? "unknown error"}`,
				});
				log(
					`[reaper] ${entry.id}: KEEP — stop failed: ${err?.message ?? "unknown error"}`,
				);
				continue;
			}
		}

		decisions.push(decision);
		log(
			`[reaper] ${entry.id}: ${decision.action === "stop" ? "STOP" : "KEEP"} — ${decision.reason}`,
		);
	}

	return { decisions, stopped };
}

export interface RunningReaper {
	stop(): void;
	config: ReaperConfig;
}

/**
 * Start the periodic reaper. Returns a handle even when reaping is disabled,
 * so a caller does not have to branch — the disabled handle simply never
 * fires.
 */
export function startIdleReaper(deps: ReaperDeps): RunningReaper {
	const config = deps.config ?? DEFAULT_REAPER_CONFIG;
	const log = deps.log ?? ((line: string) => console.log(line));

	if (!config.enabled) {
		log("[reaper] Idle reaping disabled (GAIA_IDLE_REAP=off).");
		return { stop: () => {}, config };
	}

	log(
		`[reaper] Idle reaping every ${Math.round(config.intervalMs / 60_000)}m, stopping habitats idle over ${Math.round(config.idleThresholdMs / 60_000)}m.`,
	);

	let running = false;
	const tick = async () => {
		// Passes must not overlap: a slow Docker would otherwise let two passes
		// decide on the same habitat from the same stale reading.
		if (running) return;
		running = true;
		try {
			await runReapPass({ ...deps, config });
		} catch (err: any) {
			log(`[reaper] Pass failed: ${err?.message ?? "unknown error"}`);
		} finally {
			running = false;
		}
	};

	const timer = setInterval(tick, config.intervalMs);
	// Never hold the process open for a reap.
	timer.unref?.();

	return { stop: () => clearInterval(timer), config };
}
