/**
 * `broadcast_standards` — fan out a standards audit message to every
 * running habitat that has a standards agent. The actual audit
 * machinery lives in `./standards-audit.ts` (also called from REST
 * routes); this file is just the AI SDK tool wrapper plus the
 * markdown formatting of the summary.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { GaiaToolsContext } from "./context.js";
import { runStandardsAudit } from "./standards-audit.js";

export function createStandardsTools(
	ctx: GaiaToolsContext,
): Record<string, Tool> {
	return {
		broadcast_standards: tool({
			description:
				"Send a standards audit message to one or all running habitats that have a standards agent. Each habitat pulls the latest standards, reviews its own project, and returns structured findings. Uses A2A blocking messaging — waits for each habitat to respond.",
			inputSchema: z.object({
				habitatId: z
					.string()
					.optional()
					.describe(
						"Audit only this habitat. If omitted, audits all running habitats with a standards agent.",
					),
			}),
			execute: async ({ habitatId }) => {
				const summary = await runStandardsAudit(ctx, { habitatId });

				if (summary.total === 0) {
					return habitatId
						? `Habitat "${habitatId}" not found.`
						: "No habitats registered.";
				}

				if (summary.results.every((r) => r.status === "skipped")) {
					const skippedReasons = summary.results
						.map((r) => `  - ${r.error}`)
						.join("\n");
					return `No eligible habitats to audit.\n\n${skippedReasons}`;
				}

				const responded = summary.results.filter(
					(r) => r.status === "responded",
				);
				const unresponsive = summary.results.filter(
					(r) => r.status === "unresponsive",
				);
				const skipped = summary.results.filter((r) => r.status === "skipped");

				const lines: string[] = [];
				lines.push("## Standards Audit");
				lines.push(
					`Responded: ${responded.length}/${summary.total - skipped.length}`,
				);
				lines.push(
					`Unresponsive: ${unresponsive.length}/${summary.total - skipped.length}`,
				);
				if (skipped.length > 0) {
					lines.push(`Skipped: ${skipped.length}`);
				}
				lines.push("");

				for (const r of responded) {
					lines.push(`### ${r.name} (${r.habitatId})`);
					lines.push(r.findings ?? "(no findings)");
					lines.push("");
				}

				for (const r of unresponsive) {
					lines.push(`### ${r.name} (${r.habitatId})`);
					lines.push(`⚠️ Unresponsive: ${r.error}`);
					lines.push("");
				}

				if (skipped.length > 0) {
					lines.push("### Warnings");
					for (const s of skipped) {
						lines.push(`  - ${s.error}`);
					}
				}

				return lines.join("\n");
			},
		}),
	};
}
