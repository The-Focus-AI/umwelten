/**
 * `umwelten sessions learnings append / list` — append or list per-kind
 * learnings JSONL files. Backs the Claude Code session-record substrate
 * via FileLearningsStore.
 */

import chalk from "chalk";
import { Command } from "commander";
import { FileLearningsStore } from "@umwelten/core/session-record/learnings-store.js";
import { LEARNING_KINDS } from "@umwelten/core/session-record/types.js";
import { isLearningKind, resolveLearningsRootForCli } from "./helpers.js";

export function registerLearningsCommands(parent: Command): void {
const learningsCommand = new Command("learnings").description(
	"Append or list per-kind learnings JSONL (Habitat session dir or Claude mirror under workDir)",
);

learningsCommand
	.command("append")
	.description("Append one learning row")
	.option(
		"--session-dir <path>",
		"Habitat session directory (learnings files live here)",
	)
	.option(
		"--work-dir <path>",
		"Habitat work directory (with .umwelten/learnings/claude/...)",
	)
	.option("--claude-project <path>", "Claude Code project root (with .claude)")
	.option("--claude-uuid <uuid>", "Claude session file name without .jsonl")
	.requiredOption("--kind <kind>", `One of: ${LEARNING_KINDS.join(", ")}`)
	.requiredOption("--payload <json>", "JSON object for the stored payload")
	.option("--provenance <json>", "Optional provenance JSON object")
	.action(
		async (options: {
			sessionDir?: string;
			workDir?: string;
			claudeProject?: string;
			claudeUuid?: string;
			kind: string;
			payload: string;
			provenance?: string;
		}) => {
			try {
				if (!isLearningKind(options.kind)) {
					console.error(
						chalk.red(`Invalid kind. Use one of: ${LEARNING_KINDS.join(", ")}`),
					);
					process.exit(1);
				}
				const root = await resolveLearningsRootForCli({
					sessionDir: options.sessionDir,
					workDir: options.workDir,
					claudeProject: options.claudeProject,
					claudeUuid: options.claudeUuid,
				});
				const payload = JSON.parse(options.payload) as Record<string, unknown>;
				const provenance = options.provenance
					? (JSON.parse(options.provenance) as Record<string, unknown>)
					: undefined;
				const store = new FileLearningsStore(root);
				const rec = await store.append(options.kind, { payload, provenance });
				console.log(JSON.stringify(rec, null, 2));
			} catch (e) {
				console.error(chalk.red(e instanceof Error ? e.message : String(e)));
				process.exit(1);
			}
		},
	);

learningsCommand
	.command("list")
	.description("List learnings (all kinds or one)")
	.option("--session-dir <path>", "Habitat session directory")
	.option("--work-dir <path>", "Habitat work directory")
	.option("--claude-project <path>", "Claude Code project root")
	.option("--claude-uuid <uuid>", "Claude session uuid")
	.option("--kind <kind>", "Filter to a single kind")
	.option("--json", "Print JSON")
	.action(
		async (options: {
			sessionDir?: string;
			workDir?: string;
			claudeProject?: string;
			claudeUuid?: string;
			kind?: string;
			json?: boolean;
		}) => {
			try {
				const root = await resolveLearningsRootForCli({
					sessionDir: options.sessionDir,
					workDir: options.workDir,
					claudeProject: options.claudeProject,
					claudeUuid: options.claudeUuid,
				});
				const store = new FileLearningsStore(root);
				if (options.kind) {
					if (!isLearningKind(options.kind)) {
						console.error(
							chalk.red(
								`Invalid kind. Use one of: ${LEARNING_KINDS.join(", ")}`,
							),
						);
						process.exit(1);
					}
					const rows = await store.read(options.kind);
					if (options.json) {
						console.log(JSON.stringify(rows, null, 2));
					} else {
						console.log(chalk.bold(`${options.kind} (${rows.length} rows)`));
						for (const r of rows) {
							console.log(JSON.stringify(r));
						}
					}
					return;
				}
				const all = await store.readAll();
				if (options.json) {
					console.log(JSON.stringify(all, null, 2));
				} else {
					for (const k of LEARNING_KINDS) {
						console.log(chalk.bold(`${k}: ${all[k].length} rows`));
					}
				}
			} catch (e) {
				console.error(chalk.red(e instanceof Error ? e.message : String(e)));
				process.exit(1);
			}
		},
	);

parent.addCommand(learningsCommand);

}
