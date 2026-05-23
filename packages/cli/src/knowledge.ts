/**
 * knowledge — Standalone CLI for the Exploration-centered knowledge workflow.
 *
 * Discovers Source Sessions, projects them into Explorations, lists them,
 * reflects on selected ones, and promotes results to knowledge targets.
 */
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import chalk from "chalk";
import { buildReflectionContext } from "@umwelten/core/interaction/reflection/reflection.js";
import { classifyReflectionAnswer } from "@umwelten/core/interaction/promotion/classifier.js";
import { PromotionRouter } from "@umwelten/core/interaction/promotion/router.js";
import { adapterRegistry } from "@umwelten/core/interaction/adapters/index.js";
import { loadBrowseProjection } from "@umwelten/sessions/introspect.js";
import type {
	Exploration,
	SourceSession,
} from "@umwelten/core/interaction/types/domain-types.js";

// ── Types ───────────────────────────────────────────────────────────────

export interface KnowledgeCommandOptions {
	project: string;
	sessionsDir?: string;
	model?: string;
}

// ── Main ────────────────────────────────────────────────────────────────

export async function runKnowledgeCommand(
	options: KnowledgeCommandOptions,
): Promise<void> {
	const projectPath = resolve(options.project);
	const sessionsDir = options.sessionsDir
		? resolve(options.sessionsDir)
		: undefined;

	// If a Habitat sessions dir is provided, register a Habitat adapter on
	// the global registry before projection runs. loadBrowseProjection will
	// initialize the standard adapters.
	if (sessionsDir) {
		const { HabitatSessionAdapter } = await import(
			"@umwelten/habitat/adapters/habitat-session-adapter.js"
		);
		adapterRegistry.register(new HabitatSessionAdapter(sessionsDir));
	}

	console.log(chalk.bold("\n🧠 Umwelten Knowledge Browser\n"));
	console.log(chalk.dim(`Project: ${projectPath}`));
	if (sessionsDir) console.log(chalk.dim(`Sessions: ${sessionsDir}`));
	console.log();

	// ---- 1. Project sessions into Explorations ----
	console.log(chalk.dim("Discovering sessions and projecting Explorations..."));
	const projection = await loadBrowseProjection({ projectPath });

	if (projection.explorations.length === 0) {
		console.log(chalk.yellow("\nNo sessions found for this project."));
		console.log(
			chalk.dim(
				"Use the project with pi, Claude Code, or Cursor to create sessions first.",
			),
		);
		return;
	}

	console.log(
		chalk.green(
			`\nFound ${projection.explorations.length} Explorations across ${projection.sources.length} source(s):`,
		),
	);
	console.log();

	// ---- 2. List Explorations ----
	listExplorations(
		projection.explorations,
		projection.sources,
		projection.sourceSessions,
	);

	// ---- 3. Select an Exploration ----
	const selected = await selectExploration(projection.explorations);
	if (!selected) {
		console.log(chalk.yellow("No exploration selected."));
		return;
	}

	console.log(chalk.bold(`\nSelected: ${selected.name}`));
	console.log(
		chalk.dim(`ID: ${selected.id} · ${selected.memberCount} session(s)`),
	);
	console.log();

	// ---- 4. Ask a reflection question ----
	const question = await promptQuestion();
	if (!question) {
		console.log(chalk.yellow("No question asked."));
		return;
	}

	console.log(chalk.cyan(`\nReflecting: "${question}"`));
	console.log(
		chalk.dim("(This would call the LLM with the Exploration context.)\n"),
	);

	// Build the reflection context to show what would be sent
	const contextMessages = buildReflectionContext([selected]);
	console.log(chalk.dim("Context would include:"));
	for (const msg of contextMessages) {
		const preview = (
			typeof msg.content === "string"
				? msg.content
				: JSON.stringify(msg.content)
		).slice(0, 200);
		console.log(chalk.dim(`  [${msg.role}] ${preview}...`));
	}
	console.log();

	// For now, simulate a reflection result (since we can't call an LLM without a configured model)
	const simulatedResult = `Based on the exploration "${selected.name}" with ${selected.memberCount} session(s), I found the following key insight: The work involved ${selected.members.map((m) => m.source).join(", ")} sources.`;

	console.log(chalk.bold("\n📝 Reflection Result:"));
	console.log(chalk.white(simulatedResult));
	console.log();

	// ---- 5. Classify and promote ----
	await handlePromotion(simulatedResult, projectPath);

	console.log(chalk.green("\n✅ Done."));
}

// ── Display ─────────────────────────────────────────────────────────────

function listExplorations(
	explorations: Exploration[],
	sources: Array<{
		source: string;
		displayName: string;
		sessionCount: number;
		explorationCount: number;
	}>,
	sourceSessions: SourceSession[],
): void {
	// Source summary
	for (const source of sources) {
		const color =
			source.source === "pi"
				? "magenta"
				: source.source === "habitat"
					? "yellow"
					: "cyan";
		console.log(
			chalk.dim(
				`  ${chalk[color](source.displayName)}: ${source.sessionCount} session(s), ${source.explorationCount} exploration(s)`,
			),
		);
	}
	console.log();

	// Exploration table
	const sourceSessionsById = new Map(
		sourceSessions.map((session) => [session.id, session]),
	);
	const header = `${chalk.bold("#")}  ${chalk.bold("Name".padEnd(40))} ${chalk.bold("Source".padEnd(12))} ${chalk.bold("Msgs".padEnd(5))} ${chalk.bold("Tools".padEnd(5))} ${chalk.bold("Date")}`;
	console.log(header);
	console.log(chalk.dim("─".repeat(88)));

	explorations.forEach((exp, i) => {
		const idx = String(i + 1).padEnd(3);
		const name = exp.name.slice(0, 38).padEnd(40);
		const member = exp.members[0];
		const sourceSession = member
			? sourceSessionsById.get(member.sourceSessionId)
			: undefined;
		const src = member?.source ?? "?".padEnd(12);
		const msgs = String(sourceSession?.messageCount ?? exp.memberCount).padEnd(
			5,
		);
		const tools = String(sourceSession?.metrics?.toolCalls ?? 0).padEnd(5);
		const date = exp.created.slice(0, 10);
		const color =
			exp.kind === "virtual"
				? "yellow"
				: exp.kind === "saved"
					? "green"
					: "white";
		console.log(
			` ${idx}${chalk[color](name)} ${chalk.dim(src.padEnd(12))} ${chalk.dim(msgs)} ${chalk.dim(tools)} ${chalk.dim(date)}`,
		);
	});
	console.log();
}

async function selectExploration(
	explorations: Exploration[],
): Promise<Exploration | null> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	return new Promise((resolve) => {
		rl.question(
			chalk.cyan("Select an exploration (number) or press Enter to skip: "),
			(answer) => {
				rl.close();
				const num = parseInt(answer, 10);
				if (isNaN(num) || num < 1 || num > explorations.length) {
					resolve(null);
				} else {
					resolve(explorations[num - 1]);
				}
			},
		);
	});
}

async function promptQuestion(): Promise<string | null> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });

	return new Promise((resolve) => {
		rl.question(
			chalk.cyan(
				'Ask a question about this exploration\n(e.g. "what did we learn?", "what failed?", press Enter to skip): ',
			),
			(answer) => {
				rl.close();
				resolve(answer.trim() || null);
			},
		);
	});
}

// ── Promotion ──────────────────────────────────────────────────────────

async function handlePromotion(
	result: string,
	projectPath: string,
): Promise<void> {
	const classification = classifyReflectionAnswer(result);
	const { primary, alternatives } = classification;

	console.log(chalk.bold("\n📊 Classification:"));
	console.log(
		`  ${chalk.green("Primary:")} ${primary.label} (${Math.round(primary.confidence * 100)}% confidence)`,
	);

	if (alternatives.length > 0) {
		console.log(chalk.dim("  Alternatives:"));
		for (const alt of alternatives.slice(0, 3)) {
			console.log(
				chalk.dim(`    ${alt.label} (${Math.round(alt.confidence * 100)}%)`),
			);
		}
	}
	console.log();

	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => {
		rl.question(
			chalk.cyan("Promote this result?\n") +
				chalk.dim("  [1] ") +
				chalk.white("Save as reflection") +
				"\n" +
				chalk.dim("  [2] ") +
				chalk.white(`Promote to ${primary.label}`) +
				"\n" +
				chalk.dim("  [3] ") +
				chalk.white("Skip") +
				"\n" +
				chalk.cyan("Choice [1-3]: "),
			(a) => {
				rl.close();
				resolve(a.trim());
			},
		);
	});

	const router = new PromotionRouter({ projectRoot: projectPath });

	switch (answer) {
		case "1": {
			const title = result.split("\n")[0].slice(0, 60);
			const reflectionPath = await router.promote({
				target: "saved-reflection",
				confidence: primary.confidence,
				label: "Saved Reflection",
				content: result,
				title,
				source: "heuristic",
			});
			console.log(
				chalk.green(
					`\n  ✓ Saved reflection: ${chalk.underline(reflectionPath.filePath)}`,
				),
			);
			break;
		}
		case "2": {
			const promoteResult = await router.promote({
				target: primary.target,
				confidence: primary.confidence,
				label: primary.label,
				content: result,
				title: result.split("\n")[0].slice(0, 60),
				source: "heuristic",
			});
			if (promoteResult.success) {
				console.log(
					chalk.green(
						`\n  ✓ Promoted to: ${chalk.underline(promoteResult.filePath)}`,
					),
				);
			} else {
				console.log(
					chalk.red(`\n  ✗ Promotion failed: ${promoteResult.error}`),
				);
			}
			break;
		}
		case "3":
		default:
			console.log(chalk.dim("  Skipped."));
			break;
	}
}

// ── Commander command ───────────────────────────────────────────────────

import { Command } from "commander";

export const knowledgeCommand = new Command("knowledge")
	.description(
		"Browse project knowledge: discover sessions, reflect, and promote",
	)
	.option("-p, --project <path>", "Project root path", process.cwd())
	.option("--sessions-dir <path>", "Habitat sessions directory (optional)")
	.action(async (options) => {
		await runKnowledgeCommand({
			project: options.project,
			sessionsDir: options.sessionsDir,
		});
	});
