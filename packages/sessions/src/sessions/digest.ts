/**
 * `umwelten sessions digest` — cross-project digest tree.
 *   overview / build / search / stats / topics / knowledge / patterns / ask
 *
 * `build` is the LLM-driven digester (compaction + analysis + beats +
 * phases + facts). The other seven query the existing digest store.
 */

import { resolve, join, basename } from "node:path";
import { stat } from "node:fs/promises";
import { writeFile as writeFileFs, mkdir as mkdirFs } from "node:fs/promises";
import chalk from "chalk";
import { Command } from "commander";
import {
	digestAllProjects,
	digestSession,
	askAboutSession,
	buildSessionAnalysisInteraction,
} from "@umwelten/core/interaction/analysis/session-digester.js";
import type { SessionDigest } from "@umwelten/core/interaction/analysis/analysis-types.js";
// Stats and knowledge reading come from digest-search (backed by SessionAnalysisIndex + FileLearningsStore)
import {
	searchDigests,
	searchKnowledge as searchKnowledgeFromIndex,
	getDigestTopics,
	getDigestPatterns,
	getDigestStats as getDigestStatsFromStore,
	readAllKnowledge as readKnowledgeFromStore,
	formatDigestResults,
	formatDigestResultsJSON,
	buildOverview,
	formatOverview,
} from "@umwelten/core/interaction/analysis/digest-search.js";
import { CLIInterface } from "@umwelten/ui/cli/CLIInterface.js";

export function registerDigestCommands(parent: Command): void {
const digestCommand = new Command("digest").description(
	"Digest sessions across all projects: compaction, analysis, and cross-project search",
);

// digest overview (default view)
digestCommand
	.command("overview")
	.description("Command center: full overview of all digested sessions")
	.option("--json", "Output as JSON", false)
	.action(async (options: { json?: boolean }) => {
		try {
			const overview = await buildOverview();
			if (options.json) {
				// Serialize Sets to arrays for JSON
				const serializable = {
					...overview,
					activityByWeek: overview.activityByWeek.map((w) => ({
						...w,
						projects: Array.from(w.projects),
					})),
				};
				console.log(JSON.stringify(serializable, null, 2));
			} else {
				console.log(formatOverview(overview));
			}
		} catch (error) {
			console.error(
				chalk.red("Error:"),
				error instanceof Error ? error.message : error,
			);
			process.exit(1);
		}
	});

// digest build
digestCommand
	.command("build")
	.description("Digest all sessions (compaction + analysis + fact extraction)")
	.option("-p, --project <path>", "Digest only this project path")
	.option("-f, --file <path>", "Digest a single session JSONL file")
	.option(
		"-m, --model <model>",
		"Model for analysis (format: provider:model)",
		"google:gemini-3-flash-preview",
	)
	.option("-o, --output <dir>", "Write markdown output to this directory")
	.option("--force", "Re-digest already digested sessions", false)
	.option("-v, --verbose", "Show detailed progress", false)
	.action(
		async (options: {
			project?: string;
			file?: string;
			model: string;
			output?: string;
			force: boolean;
			verbose: boolean;
		}) => {
			try {
				// Single file mode
				if (options.file) {
					const filePath = resolve(options.file);
					const sessionId = basename(filePath, ".jsonl");
					const [provider, ...modelParts] = options.model.split(":");
					const modelName = modelParts.join(":");
					const model = {
						name: modelName,
						provider: provider as any,
						temperature: 0.2,
					};

					console.log(chalk.bold(`Digesting ${basename(filePath)}...`));
					console.log(`  Loading session file...`);

					const { parseSessionFile, summarizeSession } = await import(
						"@umwelten/core/interaction/persistence/session-parser.js"
					);
					const msgs = await parseSessionFile(filePath);
					console.log(`  Loaded ${msgs.length} entries`);
					const summary = summarizeSession(msgs);
					console.log(
						`  Messages: ${summary.totalMessages} (${summary.userMessages} user, ${summary.assistantMessages} assistant)`,
					);
					console.log(`  Tool calls: ${summary.toolCalls}`);
					console.log(
						`  Duration: ${Math.round((summary.duration || 0) / 60000)} min`,
					);
					console.log(`  Model: ${options.model}\n`);

					const session = {
						sessionId,
						fullPath: filePath,
						fileMtime: Date.now(),
						firstPrompt: "",
						messageCount: summary.totalMessages,
						created: new Date().toISOString(),
						modified: new Date().toISOString(),
						gitBranch: "main",
						projectPath: resolve(filePath, "..", ".."),
						isSidechain: false,
					};

					const digest = await digestSession(
						session,
						session.projectPath,
						basename(resolve(filePath, "..")),
						model,
						(p) =>
							console.log(`  [${p.phase}${p.detail ? ": " + p.detail : ""}]`),
					);

					if (!digest) {
						console.error(chalk.red("Digest failed"));
						process.exit(1);
					}

					// Write output
					const outDir = options.output
						? resolve(options.output)
						: resolve(".");
					await writeDigestMarkdown(digest, outDir);

					console.log(
						chalk.green(
							`\n✓ Digest complete: ${digest.segments.length} segments, ${digest.allFacts.length} facts`,
						),
					);
					return;
				}

				// Multi-project mode
				console.log(chalk.bold("Digesting sessions...\n"));

				const result = await digestAllProjects({
					projectPath: options.project ? resolve(options.project) : undefined,
					model: options.model,
					force: options.force,
					verbose: options.verbose,
				});

				console.log("");
				console.log(chalk.green("✓ Digest complete"));
				console.log(`  Projects processed: ${result.projectsProcessed}`);
				console.log(`  Sessions digested: ${result.digested}`);
				console.log(`  Sessions skipped: ${result.skipped} (already digested)`);
				if (result.failed > 0) {
					console.log(chalk.yellow(`  Failed: ${result.failed}`));
				}
				console.log("");
				console.log(
					chalk.dim(
						'Use "sessions digest search <query>" to search across all sessions',
					),
				);
			} catch (error) {
				console.error(
					chalk.red("Error:"),
					error instanceof Error ? error.message : error,
				);
				process.exit(1);
			}
		},
	);


async function writeDigestMarkdown(
	digest: SessionDigest,
	outDir: string,
): Promise<void> {
	await mkdirFs(outDir, { recursive: true });

	// 1. Summary
	const summaryMd = [
		`# Session Digest: ${digest.sessionId.slice(0, 8)}`,
		"",
		`**Project:** ${digest.projectName}`,
		`**Date:** ${new Date(digest.created).toLocaleDateString()}`,
		`**Messages:** ${digest.metrics.messageCount} | **Segments:** ${digest.metrics.segmentCount} | **Facts:** ${digest.allFacts.length}`,
		`**Solution type:** ${digest.analysis.solutionType} | **Success:** ${digest.analysis.successIndicators}`,
		"",
		"---",
		"",
		"## Summary",
		"",
		digest.overallSummary,
		"",
		"## Topics",
		"",
		digest.analysis.topics.map((t) => `- ${t}`).join("\n"),
		"",
		"## Tags",
		"",
		digest.analysis.tags.join(", "),
		"",
		"## Key Learnings",
		"",
		digest.analysis.keyLearnings,
		"",
	].join("\n");
	await writeFileFs(join(outDir, "summary.md"), summaryMd);
	console.log(`  wrote ${join(outDir, "summary.md")}`);

	// 2. Beats (the conversation arc)
	if (digest.beats && digest.beats.length > 0) {
		const beatsMd = [
			`# Session Beats (${digest.beats.length})`,
			"",
			...digest.beats.flatMap((beat, i) => {
				const toolList =
					beat.toolsUsed.length > 0
						? beat.toolsUsed.map((t) => `${t.name} (${t.count}x)`).join(", ")
						: "none";
				const userPreview =
					beat.userRequest.length > 500
						? beat.userRequest.slice(0, 500) + "..."
						: beat.userRequest;
				const outcomePreview =
					beat.outcome.length > 500
						? beat.outcome.slice(0, 500) + "..."
						: beat.outcome;
				return [
					`## Beat ${i + 1}`,
					"",
					`**User:** ${userPreview.replace(/<[^>]+>/g, "").trim()}`,
					"",
					`**Tools:** ${toolList}`,
					"",
					`**Outcome:** ${outcomePreview.replace(/<[^>]+>/g, "").trim()}`,
					"",
					...(beat.narrative ? [`**Narrative:** ${beat.narrative}`, ""] : []),
					...(beat.keyFacts.length > 0
						? ["**Facts:**", ...beat.keyFacts.map((f) => `- ${f}`), ""]
						: []),
					"---",
					"",
				];
			}),
		].join("\n");
		await writeFileFs(join(outDir, "beats.md"), beatsMd);
		console.log(`  wrote ${join(outDir, "beats.md")}`);
	}

	// 3. Phases (conversation arc)
	if (digest.phases && digest.phases.length > 0) {
		const phasesMd = [
			`# Conversation Phases (${digest.phases.length})`,
			"",
			...digest.phases.flatMap((phase, i) => {
				const beatStart = phase.beatRange[0] + 1;
				const beatEnd = phase.beatRange[1] + 1;
				const phaseBeats =
					digest.beats?.slice(phase.beatRange[0], phase.beatRange[1] + 1) || [];
				return [
					`## Phase ${i + 1}: ${phase.name} (beats ${beatStart}–${beatEnd})`,
					"",
					phase.description,
					"",
					...phaseBeats.map((b) => `- **Beat ${b.index + 1}:** ${b.narrative}`),
					"",
					"---",
					"",
				];
			}),
		].join("\n");
		await writeFileFs(join(outDir, "phases.md"), phasesMd);
		console.log(`  wrote ${join(outDir, "phases.md")}`);
	}

	// 4. Segments (group-level compaction)
	const segmentsMd = [
		`# Compaction Groups (${digest.segments.length})`,
		"",
		...digest.segments.flatMap((seg, i) => [
			`## Group ${i + 1} (beats ${seg.messageRange[0] + 1}–${seg.messageRange[1] + 1})`,
			"",
			seg.throughLine,
			"",
			...(seg.keyFacts.length > 0
				? ["**Key Facts:**", ...seg.keyFacts.map((f) => `- ${f}`), ""]
				: []),
			"---",
			"",
		]),
	].join("\n");
	await writeFileFs(join(outDir, "chapters.md"), segmentsMd);
	console.log(`  wrote ${join(outDir, "chapters.md")}`);

	// 3. Facts
	const factsMd = [
		`# All Facts (${digest.allFacts.length})`,
		"",
		...digest.allFacts.map((f, i) => `${i + 1}. ${f}`),
		"",
	].join("\n");
	await writeFileFs(join(outDir, "facts.md"), factsMd);
	console.log(`  wrote ${join(outDir, "facts.md")}`);

	// 4. Files touched
	if (digest.analysis.relatedFiles.length > 0) {
		const filesMd = [
			`# Related Files (${digest.analysis.relatedFiles.length})`,
			"",
			...digest.analysis.relatedFiles.map((f) => `- \`${f}\``),
			"",
		].join("\n");
		await writeFileFs(join(outDir, "files.md"), filesMd);
		console.log(`  wrote ${join(outDir, "files.md")}`);
	}

	// 5. Full JSON
	await writeFileFs(
		join(outDir, "digest.json"),
		JSON.stringify(digest, null, 2),
	);
	console.log(`  wrote ${join(outDir, "digest.json")}`);
}

// digest search
digestCommand
	.command("search")
	.description("Search across all digested sessions")
	.argument("<query>", "Search query")
	.option("-l, --limit <limit>", "Max results", "10")
	.option("--project <name>", "Filter by project name")
	.option("--tags <tags>", "Filter by tags (comma-separated)")
	.option("--topic <topic>", "Filter by topic")
	.option("--type <type>", "Filter by solution type")
	.option(
		"--success <indicator>",
		"Filter by success (yes, partial, no, unclear)",
	)
	.option("--json", "Output as JSON", false)
	.action(
		async (
			query: string,
			options: {
				limit: string;
				project?: string;
				tags?: string;
				topic?: string;
				type?: string;
				success?: string;
				json?: boolean;
			},
		) => {
			try {
				const results = await searchDigests(query, {
					limit: parseInt(options.limit, 10),
					project: options.project,
					tags: options.tags?.split(",").map((t) => t.trim()),
					topic: options.topic,
					solutionType: options.type,
					success: options.success,
				});

				if (options.json) {
					console.log(formatDigestResultsJSON(results));
				} else {
					console.log(formatDigestResults(results));
				}
			} catch (error) {
				console.error(
					chalk.red("Error:"),
					error instanceof Error ? error.message : error,
				);
				process.exit(1);
			}
		},
	);

// digest stats
digestCommand
	.command("stats")
	.description("Show digest statistics")
	.option("--json", "Output as JSON", false)
	.action(async (options: { json?: boolean }) => {
		try {
			const stats = await getDigestStatsFromStore();

			if (options.json) {
				console.log(JSON.stringify(stats, null, 2));
				return;
			}

			console.log(chalk.bold("Digest Statistics\n"));
			console.log(`  Total sessions: ${stats.totalSessions}`);
			console.log(`  Projects: ${stats.projectCount}`);

			if (stats.dateRange) {
				const oldest = new Date(stats.dateRange.oldest).toLocaleDateString();
				const newest = new Date(stats.dateRange.newest).toLocaleDateString();
				console.log(`  Date range: ${oldest} — ${newest}`);
			}

			if (stats.projects.length > 0) {
				console.log(chalk.bold("\nTop Projects:"));
				for (const p of stats.projects.slice(0, 10)) {
					console.log(`  ${p.name}: ${p.count} sessions`);
				}
			}
		} catch (error) {
			console.error(
				chalk.red("Error:"),
				error instanceof Error ? error.message : error,
			);
			process.exit(1);
		}
	});

// digest topics
digestCommand
	.command("topics")
	.description("Show top topics across all digested sessions")
	.option("-l, --limit <limit>", "Max topics", "20")
	.option("--json", "Output as JSON", false)
	.action(async (options: { limit: string; json?: boolean }) => {
		try {
			const topics = await getDigestTopics(parseInt(options.limit, 10));

			if (options.json) {
				console.log(JSON.stringify(topics, null, 2));
				return;
			}

			console.log(chalk.bold(`Top Topics (${topics.length}):\n`));
			for (let i = 0; i < topics.length; i++) {
				const t = topics[i];
				const projectList =
					t.projects.length <= 3
						? t.projects.join(", ")
						: `${t.projects.slice(0, 3).join(", ")} +${t.projects.length - 3} more`;
				console.log(
					`  ${i + 1}. ${t.topic} (${t.count} sessions) — ${projectList}`,
				);
			}
		} catch (error) {
			console.error(
				chalk.red("Error:"),
				error instanceof Error ? error.message : error,
			);
			process.exit(1);
		}
	});

// digest knowledge
digestCommand
	.command("knowledge")
	.description("Show accumulated knowledge from digestion")
	.option(
		"--kind <kind>",
		"Filter to a specific kind (facts, skill_candidates, preferences, open_loops, mistakes)",
	)
	.option("-q, --query <query>", "Search within knowledge")
	.option("-l, --limit <limit>", "Max results", "20")
	.option("--json", "Output as JSON", false)
	.action(
		async (options: {
			kind?: string;
			query?: string;
			limit: string;
			json?: boolean;
		}) => {
			try {
				if (options.query) {
					const results = await searchKnowledgeFromIndex(options.query, {
						limit: parseInt(options.limit, 10),
						kind: options.kind as any,
					});

					if (options.json) {
						console.log(JSON.stringify(results, null, 2));
						return;
					}

					console.log(
						chalk.bold(
							`Knowledge search: "${options.query}" (${results.length} results)\n`,
						),
					);
					for (const { record, projectName } of results) {
						const text =
							(record.payload as any)?.text || JSON.stringify(record.payload);
						console.log(`  [${record.kind}] ${text}`);
						console.log(
							chalk.dim(`    from: ${projectName} | ${record.id.slice(0, 8)}`),
						);
					}
					return;
				}

				// List all knowledge
				const records = await readKnowledgeFromStore(options.kind as any);

				if (options.json) {
					console.log(JSON.stringify(records, null, 2));
					return;
				}

				console.log(
					chalk.bold(
						`Knowledge${options.kind ? ` (${options.kind})` : ""}: ${records.length} records\n`,
					),
				);
				const limit = parseInt(options.limit, 10);
				for (const record of records.slice(0, limit)) {
					const text =
						(record.payload as any)?.text || JSON.stringify(record.payload);
					const project = record.provenance?.claudeProjectPath || "";
					console.log(`  [${record.kind}] ${text}`);
					if (project) console.log(chalk.dim(`    from: ${project}`));
				}
				if (records.length > limit) {
					console.log(chalk.dim(`\n  ... and ${records.length - limit} more`));
				}
			} catch (error) {
				console.error(
					chalk.red("Error:"),
					error instanceof Error ? error.message : error,
				);
				process.exit(1);
			}
		},
	);

// digest patterns
digestCommand
	.command("patterns")
	.description("Show patterns across all digested sessions")
	.option("--json", "Output as JSON", false)
	.action(async (options: { json?: boolean }) => {
		try {
			const patterns = await getDigestPatterns();

			if (options.json) {
				console.log(JSON.stringify(patterns, null, 2));
				return;
			}

			console.log(
				chalk.bold(
					`Patterns (${patterns.totalSessions} sessions across ${patterns.projectCount} projects)\n`,
				),
			);

			console.log(chalk.bold("Solution Types:"));
			for (const st of patterns.solutionTypes) {
				console.log(`  ${st.type}: ${st.count} sessions`);
			}

			console.log(chalk.bold("\nSuccess Rates:"));
			for (const sr of patterns.successRates) {
				console.log(
					`  ${sr.indicator}: ${sr.count} sessions (${sr.percentage.toFixed(1)}%)`,
				);
			}

			console.log(chalk.bold("\nTop Projects:"));
			for (const p of patterns.topProjects.slice(0, 10)) {
				console.log(`  ${p.name}: ${p.count} sessions`);
			}
		} catch (error) {
			console.error(
				chalk.red("Error:"),
				error instanceof Error ? error.message : error,
			);
			process.exit(1);
		}
	});

// digest ask — one-shot question or interactive chat about a session

digestCommand
	.command("ask")
	.description(
		"Ask questions about a session (interactive chat if no question given)",
	)
	.argument("[question]", "Question to ask (omit for interactive chat)")
	.requiredOption("-f, --file <path>", "Session JSONL file to analyze")
	.option(
		"-m, --model <model>",
		"Model (format: provider:model)",
		"ollama:gemma4:26b",
	)
	.action(
		async (
			question: string | undefined,
			options: { file: string; model: string },
		) => {
			try {
				const filePath = resolve(options.file);
				const sessionId = basename(filePath, ".jsonl");
				const projectPath = resolve(filePath, "..", "..");
				const [provider, ...modelParts] = options.model.split(":");
				const modelName = modelParts.join(":");
				const model = {
					name: modelName,
					provider: provider as any,
					temperature: 0.3,
				};

				if (question) {
					// One-shot mode
					const answer = await askAboutSession({
						sessionFile: filePath,
						projectPath,
						sessionId,
						question,
						model,
					});
					console.log("\n" + answer);
				} else {
					// Interactive chat mode
					console.log(
						chalk.bold("Loading session for interactive analysis...\n"),
					);

					const interaction = await buildSessionAnalysisInteraction({
						sessionFile: filePath,
						projectPath,
						sessionId,
						model,
					});

					console.log(
						chalk.dim(
							`Session loaded. Ask questions about it. Type "exit" to quit.\n`,
						),
					);

					const cli = new CLIInterface();
					await cli.startChat(interaction);
				}
			} catch (error) {
				console.error(
					chalk.red("Error:"),
					error instanceof Error ? error.message : error,
				);
				process.exit(1);
			}
		},
	);

parent.addCommand(digestCommand);
}
