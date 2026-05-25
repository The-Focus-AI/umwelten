/**
 * `umwelten sessions transcript compact` — freeze the live tail of a
 * habitat session's transcript into a frozen segment and start a new
 * live one, mirroring what `compactHabitatTranscriptSegment` from
 * `@umwelten/core/session-record/compaction-habitat.js` does.
 */

import { resolve } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { FileLearningsStore } from "@umwelten/core/session-record/learnings-store.js";
import { LEARNING_KINDS } from "@umwelten/core/session-record/types.js";
import type { LearningKind } from "@umwelten/core/session-record/types.js";
import { compactHabitatTranscriptSegment } from "@umwelten/core/session-record/compaction-habitat.js";

export function registerTranscriptCommands(parent: Command): void {
const transcriptCommand = new Command("transcript").description(
	"Habitat session-directory transcript utilities (on-disk layout under sessions/)",
);

transcriptCommand
	.command("compact")
	.description(
		"Rename live transcript.jsonl to transcript.{iso}.jsonl and write a new live file whose first line is the compaction marker",
	)
	.requiredOption("--session-dir <path>", "Habitat session directory")
	.requiredOption("--summary <text>", "Summary stored in the compaction marker")
	.option("--run-id <id>", "Optional run id (default: random UUID)")
	.option(
		"--learning-counts <json>",
		"Optional JSON object of learning kind → integer count",
	)
	.action(
		async (options: {
			sessionDir: string;
			summary: string;
			runId?: string;
			learningCounts?: string;
		}) => {
			try {
				let learningCounts:
					| import("@umwelten/core/session-record/types.js").CompactionEventV1["learningCounts"]
					| undefined;
				if (options.learningCounts?.trim()) {
					const raw = JSON.parse(options.learningCounts) as Record<
						string,
						number
					>;
					const out: Partial<Record<LearningKind, number>> = {};
					for (const k of LEARNING_KINDS) {
						const v = raw[k];
						if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
							out[k] = v;
						}
					}
					learningCounts = Object.keys(out).length > 0 ? out : undefined;
				}
				const result = await compactHabitatTranscriptSegment({
					sessionDir: resolve(options.sessionDir),
					summary: options.summary,
					runId: options.runId,
					learningCounts,
				});
				console.log(JSON.stringify(result, null, 2));
			} catch (e) {
				console.error(chalk.red(e instanceof Error ? e.message : String(e)));
				process.exit(1);
			}
		},
	);

parent.addCommand(transcriptCommand);
}
