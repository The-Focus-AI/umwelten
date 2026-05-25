/**
 * Standards audit machinery: types + the audit runner that the
 * `broadcast_standards` tool and the REST API both call.
 *
 * Audit-runs send `STANDARDS_AUDIT_MSG` to each running habitat that
 * has a standards agent, with a 60s per-habitat timeout, and
 * aggregate the responses.
 */

import { sendA2AMessage } from "@umwelten/protocols";
import type { GaiaHabitatEntry } from "../types.js";
import type { GaiaRegistryManager } from "../registry.js";
import type { DockerManager } from "../docker.js";
import { STANDARDS_AGENT_ID } from "../gaia-seed.js";
import { entryToEndpoint } from "./context.js";

export const STANDARDS_AUDIT_MSG =
	"Pull the latest standards from the standards agent at /data/agents/standards/repo. Review the current best-practices against this habitat's own project and configuration. Return a structured findings report with: compliant items, non-compliant items with severity, and suggested remediations.";

/** Result for a single habitat in a standards audit. */
export interface AuditResult {
	habitatId: string;
	name: string;
	status: "responded" | "unresponsive" | "skipped";
	findings?: string;
	error?: string;
}

/** Summary of a standards audit run. */
export interface AuditSummary {
	timestamp: string;
	total: number;
	passed: number;
	findings: number;
	unresponsive: number;
	skipped: number;
	results: AuditResult[];
}

/** Minimal context needed to run a standards audit. */
export interface StandardsAuditContext {
	registry: GaiaRegistryManager;
	docker: DockerManager;
}

/**
 * Run a standards audit across habitats with standards agents.
 * Used both by the broadcast_standards tool and the REST API.
 */
export async function runStandardsAudit(
	ctx: StandardsAuditContext,
	options?: { habitatId?: string },
): Promise<AuditSummary> {
	const PER_HABITAT_TIMEOUT_MS = 60_000;
	const { registry, docker } = ctx;

	const entries = registry.list();
	const targets = options?.habitatId
		? entries.filter((e) => e.id === options.habitatId)
		: entries;

	if (targets.length === 0) {
		return {
			timestamp: new Date().toISOString(),
			total: 0,
			passed: 0,
			findings: 0,
			unresponsive: 0,
			skipped: 0,
			results: [],
		};
	}

	const auditTargets: GaiaHabitatEntry[] = [];
	const skipped: AuditResult[] = [];

	for (const entry of targets) {
		const hasStandards =
			entry.config.agents?.some((a) => a.id === STANDARDS_AGENT_ID) ?? false;
		const isRunning =
			entry.containerPort != null &&
			(await docker.getStatus(entry.id)) === "running";

		if (!isRunning) {
			skipped.push({
				habitatId: entry.id,
				name: entry.name,
				status: "skipped",
				error: `Habitat "${entry.id}" is not running — skipped.`,
			});
			continue;
		}
		if (!hasStandards) {
			skipped.push({
				habitatId: entry.id,
				name: entry.name,
				status: "skipped",
				error: `Habitat "${entry.id}" has no standards agent — skipped.`,
			});
			continue;
		}
		auditTargets.push(entry);
	}

	if (auditTargets.length === 0) {
		return {
			timestamp: new Date().toISOString(),
			total: skipped.length,
			passed: 0,
			findings: 0,
			unresponsive: 0,
			skipped: skipped.length,
			results: skipped,
		};
	}

	const results = await Promise.allSettled(
		auditTargets.map(async (entry) => {
			try {
				const result = await Promise.race([
					sendA2AMessage(entryToEndpoint(entry), STANDARDS_AUDIT_MSG),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("timeout")),
							PER_HABITAT_TIMEOUT_MS,
						),
					),
				]);
				return {
					habitatId: entry.id,
					name: entry.name,
					status: "responded" as const,
					findings: result.text,
				};
			} catch (err: any) {
				const reason =
					err.message === "timeout"
						? `Timed out after ${PER_HABITAT_TIMEOUT_MS / 1000}s`
						: err.message;
				return {
					habitatId: entry.id,
					name: entry.name,
					status: "unresponsive" as const,
					error: reason,
				};
			}
		}),
	);

	const allResults: AuditResult[] = results.map((r) =>
		r.status === "fulfilled"
			? r.value
			: {
					habitatId: "unknown",
					name: "unknown",
					status: "unresponsive" as const,
					error: r.reason?.message ?? "Unknown error",
				},
	);

	const responded = allResults.filter((r) => r.status === "responded");
	const unresponsive = allResults.filter((r) => r.status === "unresponsive");

	return {
		timestamp: new Date().toISOString(),
		total: allResults.length + skipped.length,
		passed: responded.filter(
			(r) => r.findings && !/non-compliant|violation|finding/i.test(r.findings),
		).length,
		findings: responded.filter(
			(r) => r.findings && /non-compliant|violation|finding/i.test(r.findings),
		).length,
		unresponsive: unresponsive.length,
		skipped: skipped.length,
		results: [...allResults, ...skipped],
	};
}
