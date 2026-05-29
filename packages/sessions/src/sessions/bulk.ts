/**
 * `umwelten sessions export / index / search / analyze` — bulk
 * operations across a project's session collection.
 *
 *   export — dump all sessions to a JSONL file or directory.
 *   index   — build/refresh the analysis index that drives search.
 *   search  — full-text search across indexed sessions.
 *   analyze — single-session LLM analysis (one-off, doesn't index).
 */

import { cwd } from "node:process";
import { resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { hasAnalysisIndex } from "@umwelten/core/interaction/persistence/session-store.js";
import { indexProject } from "@umwelten/core/interaction/persistence/session-indexer.js";
import {
	searchSessions,
	formatSearchResults,
	formatSearchResultsJSON,
	getTopTopics,
	getTopTools,
	getPatterns,
} from "@umwelten/core/interaction/analysis/session-search.js";
import type { SearchOptions } from "@umwelten/core/interaction/analysis/analysis-types.js";
import { getAdapterRegistry } from "@umwelten/core/interaction/adapters/index.js";
import type { SessionIndexEntry } from "@umwelten/core/interaction/types/types.js";
import type {
	NormalizedSession,
	NormalizedSessionEntry,
} from "@umwelten/core/interaction/types/normalized-types.js";
import { FileLearningsStore } from "@umwelten/core/session-record/learnings-store.js";
import type { LearningKind } from "@umwelten/core/session-record/types.js";
import { LEARNING_KINDS } from "@umwelten/core/session-record/types.js";
import { resolveClaudeCodeSessionHandle } from "@umwelten/core/session-record/resolve-claude.js";
import {
	findSessionById,
	formatDuration,
} from "./helpers.js";

export function registerBulkCommands(parent: Command): void {
// Export subcommand
interface ExportOptions {
	project: string;
	format: "markdown" | "json";
	output?: string;
	includeToolCalls?: boolean;
	includeMetadata?: boolean;
}

parent
	.command("export")
	.description("Export session to markdown or JSON format")
	.argument("<session-id>", "Session ID to export")
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option("-f, --format <format>", "Output format (markdown, json)", "markdown")
	.option(
		"-o, --output <file>",
		"Output file (prints to stdout if not specified)",
	)
	.option("--no-tool-calls", "Exclude tool calls from export")
	.option("--no-metadata", "Exclude metadata from export")
	.action(async (sessionId: string, options: ExportOptions) => {
		try {
			const projectPath = resolve(options.project);

			const session = await findSessionById(projectPath, sessionId);

			if (!session) {
				console.error(chalk.red(`Session not found: ${sessionId}`));
				console.log(
					chalk.dim('\nTip: Use "sessions list" to see available sessions'),
				);
				process.exit(1);
			}

			// Two paths: Claude Code (file-based, with rich token/cost metrics) and
			// any other adapter source (Antigravity, Cursor, Pi, habitat) which we
			// resolve through the adapter registry → NormalizedSession.
			if (!session.fullPath) {
				const exportContent = await exportAdapterSession(
					session,
					sessionId,
					options,
				);
				if (exportContent == null) {
					console.error(
						chalk.red(
							`No adapter could load session ${sessionId} (source: ${session.source ?? "unknown"}).`,
						),
					);
					process.exit(1);
				}
				if (options.output) {
					const { writeFile } = await import("node:fs/promises");
					await writeFile(options.output, exportContent, "utf-8");
					console.log(chalk.green(`✓ Exported session to ${options.output}`));
				} else {
					console.log(exportContent);
				}
				return;
			}

			// Parse the session file
			const {
				parseSessionFile,
				summarizeSession,
				extractToolCalls,
				extractTextContent,
			} = await import(
				"@umwelten/core/interaction/persistence/session-parser.js"
			);
			const messages = await parseSessionFile(session.fullPath);
			const summary = summarizeSession(messages);
			const toolCalls = extractToolCalls(messages);

			// Generate export content based on format
			let exportContent: string;

			if (options.format === "json") {
				// JSON export
				const jsonExport: any = {
					sessionId: session.sessionId,
					metadata:
						options.includeMetadata !== false
							? {
									projectPath: session.projectPath,
									gitBranch: session.gitBranch,
									created: session.created,
									modified: session.modified,
									isSidechain: session.isSidechain,
									messageCount: session.messageCount,
									firstPrompt: session.firstPrompt,
								}
							: undefined,
					summary: {
						totalMessages: summary.totalMessages,
						userMessages: summary.userMessages,
						assistantMessages: summary.assistantMessages,
						toolCalls: summary.toolCalls,
						duration: summary.duration,
						tokenUsage: summary.tokenUsage,
						estimatedCost: summary.estimatedCost,
					},
					conversation: messages
						.filter((m) => m.type === "user" || m.type === "assistant")
						.map((msg) => {
							if (msg.type === "user" || msg.type === "assistant") {
								const content = msg.message.content;
								const texts = extractTextContent(content);

								return {
									type: msg.type,
									role: msg.message.role,
									timestamp: msg.timestamp,
									uuid: msg.uuid,
									content: texts.join("\n"),
									usage:
										msg.type === "assistant" ? msg.message.usage : undefined,
								};
							}
							return msg;
						}),
					toolCalls: options.includeToolCalls !== false ? toolCalls : undefined,
				};

				// Remove undefined fields
				if (jsonExport.metadata === undefined) delete jsonExport.metadata;
				if (jsonExport.toolCalls === undefined) delete jsonExport.toolCalls;

				exportContent = JSON.stringify(jsonExport, null, 2);
			} else {
				// Markdown export
				const lines: string[] = [];

				// Header
				lines.push(`# Session: ${session.sessionId}`);
				lines.push("");

				// Metadata section
				if (options.includeMetadata !== false) {
					lines.push("## Metadata");
					lines.push("");
					lines.push(`- **Project Path**: ${session.projectPath}`);
					lines.push(`- **Git Branch**: ${session.gitBranch}`);
					lines.push(
						`- **Created**: ${new Date(session.created).toLocaleString()}`,
					);
					lines.push(
						`- **Modified**: ${new Date(session.modified).toLocaleString()}`,
					);
					if (summary.duration) {
						const durationStr = formatDuration(summary.duration);
						lines.push(`- **Duration**: ${durationStr}`);
					}
					lines.push(`- **Sidechain**: ${session.isSidechain ? "Yes" : "No"}`);
					lines.push("");
				}

				// Summary section
				lines.push("## Summary");
				lines.push("");
				lines.push(`- **Total Messages**: ${summary.totalMessages}`);
				lines.push(`- **User Messages**: ${summary.userMessages}`);
				lines.push(`- **Assistant Messages**: ${summary.assistantMessages}`);
				lines.push(`- **Tool Calls**: ${summary.toolCalls}`);
				lines.push(
					`- **Input Tokens**: ${summary.tokenUsage.input_tokens.toLocaleString()}`,
				);
				lines.push(
					`- **Output Tokens**: ${summary.tokenUsage.output_tokens.toLocaleString()}`,
				);
				if (summary.tokenUsage.cache_read_input_tokens) {
					lines.push(
						`- **Cache Read Tokens**: ${summary.tokenUsage.cache_read_input_tokens.toLocaleString()}`,
					);
				}
				if (summary.tokenUsage.cache_creation_input_tokens) {
					lines.push(
						`- **Cache Write Tokens**: ${summary.tokenUsage.cache_creation_input_tokens.toLocaleString()}`,
					);
				}
				lines.push(
					`- **Estimated Cost**: $${summary.estimatedCost.toFixed(4)}`,
				);
				lines.push("");

				// Conversation section
				lines.push("## Conversation");
				lines.push("");

				const conversationMessages = messages.filter(
					(m) => m.type === "user" || m.type === "assistant",
				);
				for (const msg of conversationMessages) {
					if (msg.type !== "user" && msg.type !== "assistant") {
						continue;
					}

					const timestamp = msg.timestamp
						? new Date(msg.timestamp).toLocaleString()
						: "unknown";
					const role = msg.type === "user" ? "User" : "Assistant";

					lines.push(`### ${role} (${timestamp})`);
					lines.push("");

					const content = msg.message.content;
					const texts = extractTextContent(content);

					for (const text of texts) {
						lines.push(text);
						lines.push("");
					}

					// Add token usage for assistant messages
					if (msg.type === "assistant" && msg.message.usage) {
						const usage = msg.message.usage;
						lines.push(
							`*Tokens: ${usage.input_tokens} in, ${usage.output_tokens} out*`,
						);
						if (usage.cache_read_input_tokens) {
							lines.push(
								`*Cache: ${usage.cache_read_input_tokens} tokens read*`,
							);
						}
						lines.push("");
					}
				}

				// Tool calls section
				if (options.includeToolCalls !== false && toolCalls.length > 0) {
					lines.push("## Tool Calls");
					lines.push("");

					for (const toolCall of toolCalls) {
						const timestamp = toolCall.timestamp
							? new Date(toolCall.timestamp).toLocaleString()
							: "unknown";
						lines.push(`### ${toolCall.name} (${timestamp})`);
						lines.push("");
						lines.push("**Input:**");
						lines.push("");
						lines.push("```json");
						lines.push(JSON.stringify(toolCall.input, null, 2));
						lines.push("```");
						lines.push("");
					}
				}

				exportContent = lines.join("\n");
			}

			// Output to file or stdout
			if (options.output) {
				const { writeFile } = await import("node:fs/promises");
				await writeFile(options.output, exportContent, "utf-8");
				console.log(chalk.green(`✓ Exported session to ${options.output}`));
			} else {
				console.log(exportContent);
			}
		} catch (error) {
			console.error(chalk.red("Error exporting session:"), error);
			process.exit(1);
		}
	});

// Index subcommand
interface IndexCommandOptions {
	project: string;
	model?: string;
	force?: boolean;
	batchSize?: string;
	verbose?: boolean;
}

parent
	.command("index")
	.description("Index sessions using LLM analysis for intelligent search")
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option(
		"-m, --model <model>",
		"Model for analysis (format: provider:model)",
		"google:gemini-3-flash-preview",
	)
	.option("--force", "Force reindex all sessions", false)
	.option(
		"-b, --batch-size <size>",
		"Number of sessions to process concurrently",
		"5",
	)
	.option("-v, --verbose", "Show detailed progress", false)
	.action(async (options: IndexCommandOptions) => {
		try {
			const projectPath = resolve(options.project);

			// Use same discovery as list (adapters) so index sees every session list shows
			const registry = getAdapterRegistry();
			const adapters = registry.getAll();
			const allNormalized: NormalizedSessionEntry[] = [];
			for (const adapter of adapters) {
				if (!adapter) continue;
				try {
					const result = await adapter.discoverSessions({
						projectPath,
						sortBy: "modified",
						sortOrder: "desc",
					});
					allNormalized.push(...result.sessions);
				} catch {
					// Source not available for this project
				}
			}

			// Build indexable entries for all sources: Claude (file-based) and Cursor/others (adapter-based)
			const sessionsOverride: SessionIndexEntry[] = allNormalized.map((s) => {
				const hasFullPath =
					s.source === "claude-code" &&
					s.sourceData != null &&
					typeof (s.sourceData as any).fullPath === "string" &&
					typeof (s.sourceData as any).fileMtime === "number";

				const fileMtime = hasFullPath
					? (s.sourceData as any).fileMtime
					: new Date(s.modified).getTime();
				const sessionId = hasFullPath ? s.sourceId : s.id;

				return {
					sessionId,
					...(hasFullPath && {
						fullPath: (s.sourceData as any).fullPath,
					}),
					fileMtime,
					firstPrompt: s.firstPrompt ?? "",
					messageCount: s.messageCount ?? 0,
					created: s.created ?? "",
					modified: s.modified ?? "",
					gitBranch: s.gitBranch ?? "main",
					projectPath: s.projectPath ?? projectPath,
					isSidechain: s.isSidechain ?? false,
					...(!hasFullPath && { source: s.source }),
				};
			});

			if (sessionsOverride.length === 0) {
				console.error(
					chalk.red(`No sessions found for project: ${projectPath}`),
				);
				process.exit(1);
			}

			const bySource = sessionsOverride.reduce(
				(acc, s) => {
					const src = s.fullPath ? "claude-code" : (s.source ?? "unknown");
					acc[src] = (acc[src] ?? 0) + 1;
					return acc;
				},
				{} as Record<string, number>,
			);
			const sourceSummary = Object.entries(bySource)
				.map(([k, n]) => `${n} ${k}`)
				.join(", ");

			console.log(chalk.bold("Indexing sessions..."));
			console.log(chalk.dim(`Project: ${projectPath}`));
			console.log(
				chalk.dim(`Sessions: ${sessionsOverride.length} (${sourceSummary})`),
			);
			console.log(chalk.dim(`Model: ${options.model}`));
			console.log("");

			const batchSize = parseInt(options.batchSize || "5", 10);

			const result = await indexProject({
				projectPath,
				model: options.model,
				force: options.force,
				batchSize,
				verbose: options.verbose,
				sessionsOverride,
			});

			console.log("");
			console.log(chalk.green("✓ Indexing complete"));
			console.log(`  Indexed: ${result.indexed} sessions`);
			console.log(`  Skipped: ${result.skipped} sessions (already indexed)`);
			if (result.failed > 0) {
				console.log(chalk.yellow(`  Failed: ${result.failed} sessions`));
			}

			// Show index location
			if (await hasAnalysisIndex(projectPath)) {
				console.log("");
				console.log(
					chalk.dim('Use "sessions search" to search indexed sessions'),
				);
			}
		} catch (error) {
			console.error(chalk.red("Error indexing sessions:"), error);
			process.exit(1);
		}
	});

// Search subcommand
interface SearchCommandOptions {
	project: string;
	tags?: string;
	topic?: string;
	tool?: string;
	type?: string;
	success?: string;
	branch?: string;
	limit?: string;
	json?: boolean;
}

parent
	.command("search")
	.description("Search indexed sessions by keywords, tags, topics, or filters")
	.argument("[query]", "Search query (optional)")
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option("--tags <tags>", "Filter by tags (comma-separated)")
	.option("--topic <topic>", "Filter by topic")
	.option("--tool <tool>", "Filter by tool usage")
	.option(
		"--type <type>",
		"Filter by solution type (bug-fix, feature, refactor, exploration, question, planning, other)",
	)
	.option(
		"--success <indicator>",
		"Filter by success (yes, partial, no, unclear)",
	)
	.option("--branch <branch>", "Filter by git branch")
	.option("-l, --limit <limit>", "Max results", "10")
	.option("--json", "Output as JSON", false)
	.action(async (query: string | undefined, options: SearchCommandOptions) => {
		try {
			const projectPath = resolve(options.project);

			// Check if analysis index exists
			if (!(await hasAnalysisIndex(projectPath))) {
				console.error(
					chalk.red(`No analysis index found for project: ${projectPath}`),
				);
				console.log(
					chalk.dim(
						'\nTip: Run "sessions index" first to create the analysis index.',
					),
				);
				process.exit(1);
			}

			const searchOptions: SearchOptions = {
				projectPath,
				tags: options.tags
					? options.tags.split(",").map((t) => t.trim())
					: undefined,
				topic: options.topic,
				tool: options.tool,
				solutionType: options.type,
				successIndicator: options.success,
				branch: options.branch,
				limit: parseInt(options.limit || "10", 10),
				json: options.json,
			};

			const results = await searchSessions(query, searchOptions);

			if (options.json) {
				console.log(formatSearchResultsJSON(results));
			} else {
				console.log(formatSearchResults(results));
			}
		} catch (error) {
			console.error(chalk.red("Error searching sessions:"), error);
			process.exit(1);
		}
	});

// Analyze subcommand
interface AnalyzeCommandOptions {
	project: string;
	type: "topics" | "tools" | "patterns" | "timeline";
	json?: boolean;
}

parent
	.command("analyze")
	.description("Aggregate analysis across all indexed sessions")
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option(
		"-t, --type <type>",
		"Analysis type: topics, tools, patterns, timeline",
		"topics",
	)
	.option("--json", "Output as JSON", false)
	.action(async (options: AnalyzeCommandOptions) => {
		try {
			const projectPath = resolve(options.project);

			// Check if analysis index exists
			if (!(await hasAnalysisIndex(projectPath))) {
				console.error(
					chalk.red(`No analysis index found for project: ${projectPath}`),
				);
				console.log(
					chalk.dim(
						'\nTip: Run "sessions index" first to create the analysis index.',
					),
				);
				process.exit(1);
			}

			if (options.type === "topics") {
				const topics = await getTopTopics(projectPath, 20);

				if (options.json) {
					console.log(JSON.stringify(topics, null, 2));
				} else {
					console.log(chalk.bold(`Top Topics (${topics.length} found):`));
					console.log("");
					for (let i = 0; i < topics.length; i++) {
						console.log(
							`${i + 1}. ${topics[i].topic} (${topics[i].count} sessions)`,
						);
					}
				}
			} else if (options.type === "tools") {
				const tools = await getTopTools(projectPath, 20);

				if (options.json) {
					console.log(JSON.stringify(tools, null, 2));
				} else {
					console.log(
						chalk.bold(`Tool Usage Analysis (${tools.length} tools):`),
					);
					console.log("");

					// Calculate total sessions for percentage
					const { readAnalysisIndex } = await import(
						"@umwelten/core/interaction/persistence/session-store.js"
					);
					const index = await readAnalysisIndex(projectPath);
					const totalSessions = index.entries.length;

					for (let i = 0; i < tools.length; i++) {
						const percentage = ((tools[i].count / totalSessions) * 100).toFixed(
							1,
						);
						console.log(
							`${i + 1}. ${tools[i].tool} - ${tools[i].count} sessions (${percentage}%)`,
						);
					}
				}
			} else if (options.type === "patterns") {
				const patterns = await getPatterns(projectPath);

				if (options.json) {
					console.log(JSON.stringify(patterns, null, 2));
				} else {
					console.log(
						chalk.bold(
							`Session Patterns (${patterns.totalSessions} sessions):`,
						),
					);
					console.log("");

					console.log(chalk.bold("Solution Types:"));
					for (const st of patterns.solutionTypes) {
						console.log(`  ${st.type}: ${st.count} sessions`);
					}
					console.log("");

					console.log(chalk.bold("Success Rates:"));
					for (const sr of patterns.successRates) {
						console.log(
							`  ${sr.indicator}: ${sr.count} sessions (${sr.percentage.toFixed(1)}%)`,
						);
					}
					console.log("");

					console.log(chalk.bold("Languages:"));
					for (const lang of patterns.languages.slice(0, 10)) {
						console.log(`  ${lang.language}: ${lang.count} sessions`);
					}
				}
			} else {
				console.error(chalk.red(`Unknown analysis type: ${options.type}`));
				console.log(
					chalk.dim("Available types: topics, tools, patterns, timeline"),
				);
				process.exit(1);
			}
		} catch (error) {
			console.error(chalk.red("Error analyzing sessions:"), error);
			process.exit(1);
		}
	});

async function resolveLearningsRootForCli(opts: {
	sessionDir?: string;
	workDir?: string;
	claudeProject?: string;
	claudeUuid?: string;
}): Promise<string> {
	if (opts.sessionDir) {
		return resolve(opts.sessionDir);
	}
	if (opts.workDir && opts.claudeProject && opts.claudeUuid) {
		const h = await resolveClaudeCodeSessionHandle({
			workDir: resolve(opts.workDir),
			projectPath: resolve(opts.claudeProject),
			sessionUuid: opts.claudeUuid,
		});
		return h.learningsRoot;
	}
	throw new Error(
		"Provide --session-dir PATH or --work-dir, --claude-project, and --claude-uuid",
	);
}

function isLearningKind(s: string): s is LearningKind {
	return (LEARNING_KINDS as readonly string[]).includes(s);
}

}

/**
 * Adapter-driven export path used by `sessions export` whenever the resolved
 * session entry does not have a Claude-Code `fullPath` (i.e. it came from
 * Antigravity, Cursor, Pi, habitat, or any other adapter source). Resolves the
 * session through the adapter registry and renders the resulting
 * NormalizedSession as JSON or markdown.
 *
 * Returns the rendered string, or null if no adapter could load the session.
 */
async function exportAdapterSession(
	entry: SessionIndexEntry,
	requestedId: string,
	options: {
		format: "markdown" | "json";
		includeToolCalls?: boolean;
		includeMetadata?: boolean;
	},
): Promise<string | null> {
	const registry = getAdapterRegistry();

	// Try every candidate id we know about: the resolved entry's sessionId
	// (already source-prefixed like `antigravity:UUID`), the original requested
	// id, and the bare sourceId if any. Each adapter's `getSession` strips its
	// own prefix, so multiple attempts are safe.
	const candidateIds = Array.from(
		new Set(
			[entry.sessionId, requestedId].filter(
				(s): s is string => typeof s === "string" && s.length > 0,
			),
		),
	);

	const candidateAdapters = entry.source
		? [registry.get(entry.source)].filter(
				(a): a is NonNullable<ReturnType<typeof registry.get>> => a !== undefined,
			)
		: registry.getAll();

	let session: NormalizedSession | null = null;
	for (const adapter of candidateAdapters) {
		for (const id of candidateIds) {
			try {
				const s = await adapter.getSession(id);
				if (s) {
					session = s;
					break;
				}
			} catch {
				// try next combination
			}
		}
		if (session) break;
	}

	if (!session) return null;

	if (options.format === "json") {
		return renderNormalizedSessionJson(session, options);
	}
	return renderNormalizedSessionMarkdown(session, options);
}

function renderNormalizedSessionJson(
	session: NormalizedSession,
	options: { includeToolCalls?: boolean; includeMetadata?: boolean },
): string {
	const conversation = session.messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map((m) => ({
			role: m.role,
			timestamp: m.timestamp,
			id: m.id,
			content: m.content,
			tokens: m.tokens,
			model: m.model,
		}));

	const toolCalls = session.messages
		.filter((m) => m.role === "tool")
		.map((m) => ({
			id: m.id,
			name: m.tool?.name ?? "tool",
			input: m.tool?.input,
			output: m.tool?.output,
			timestamp: m.timestamp,
			content: m.content,
		}));

	const out: Record<string, unknown> = {
		sessionId: session.id,
		source: session.source,
		sourceId: session.sourceId,
		summary: {
			totalMessages: session.messageCount,
			userMessages: session.metrics?.userMessages ?? 0,
			assistantMessages: session.metrics?.assistantMessages ?? 0,
			toolCalls: session.metrics?.toolCalls ?? 0,
			duration: session.duration,
			tokenUsage: {
				input_tokens: session.metrics?.inputTokens ?? 0,
				output_tokens: session.metrics?.outputTokens ?? 0,
				cache_read_input_tokens: session.metrics?.cacheReadTokens ?? 0,
				cache_creation_input_tokens: session.metrics?.cacheWriteTokens ?? 0,
			},
			estimatedCost: session.metrics?.estimatedCost ?? 0,
		},
		conversation,
	};

	if (options.includeMetadata !== false) {
		out.metadata = {
			projectPath: session.projectPath,
			workspacePath: session.workspacePath,
			gitBranch: session.gitBranch,
			gitRepo: session.gitRepo,
			created: session.created,
			modified: session.modified,
			isSidechain: session.isSidechain ?? false,
			messageCount: session.messageCount,
			firstPrompt: session.firstPrompt,
			sourceData: session.sourceData,
		};
	}

	if (options.includeToolCalls !== false) {
		out.toolCalls = toolCalls;
	}

	return JSON.stringify(out, null, 2);
}

function renderNormalizedSessionMarkdown(
	session: NormalizedSession,
	options: { includeToolCalls?: boolean; includeMetadata?: boolean },
): string {
	const lines: string[] = [];
	lines.push(`# Session: ${session.id}`);
	lines.push("");

	if (options.includeMetadata !== false) {
		lines.push("## Metadata");
		lines.push("");
		lines.push(`- **Source**: ${session.source}`);
		lines.push(`- **Source ID**: ${session.sourceId}`);
		if (session.projectPath) {
			lines.push(`- **Project Path**: ${session.projectPath}`);
		}
		if (session.workspacePath) {
			lines.push(`- **Workspace**: ${session.workspacePath}`);
		}
		if (session.gitBranch) {
			lines.push(`- **Git Branch**: ${session.gitBranch}`);
		}
		lines.push(
			`- **Created**: ${new Date(session.created).toLocaleString()}`,
		);
		lines.push(
			`- **Modified**: ${new Date(session.modified).toLocaleString()}`,
		);
		if (session.duration) {
			lines.push(`- **Duration**: ${formatDuration(session.duration)}`);
		}
		lines.push(`- **Sidechain**: ${session.isSidechain ? "Yes" : "No"}`);
		lines.push("");
	}

	lines.push("## Summary");
	lines.push("");
	lines.push(`- **Total Messages**: ${session.messageCount}`);
	lines.push(`- **User Messages**: ${session.metrics?.userMessages ?? 0}`);
	lines.push(
		`- **Assistant Messages**: ${session.metrics?.assistantMessages ?? 0}`,
	);
	lines.push(`- **Tool Calls**: ${session.metrics?.toolCalls ?? 0}`);
	if (session.metrics?.inputTokens) {
		lines.push(
			`- **Input Tokens**: ${session.metrics.inputTokens.toLocaleString()}`,
		);
	}
	if (session.metrics?.outputTokens) {
		lines.push(
			`- **Output Tokens**: ${session.metrics.outputTokens.toLocaleString()}`,
		);
	}
	if (session.metrics?.estimatedCost) {
		lines.push(
			`- **Estimated Cost**: $${session.metrics.estimatedCost.toFixed(4)}`,
		);
	}
	lines.push("");

	lines.push("## Conversation");
	lines.push("");
	for (const msg of session.messages) {
		if (msg.role !== "user" && msg.role !== "assistant") continue;
		const timestamp = msg.timestamp
			? new Date(msg.timestamp).toLocaleString()
			: "unknown";
		const role = msg.role === "user" ? "User" : "Assistant";
		lines.push(`### ${role} (${timestamp})`);
		lines.push("");
		lines.push(msg.content || "*(empty)*");
		lines.push("");
		if (msg.tokens?.input || msg.tokens?.output) {
			lines.push(
				`*Tokens: ${msg.tokens.input ?? 0} in, ${msg.tokens.output ?? 0} out*`,
			);
			lines.push("");
		}
	}

	if (options.includeToolCalls !== false) {
		const toolMessages = session.messages.filter((m) => m.role === "tool");
		if (toolMessages.length > 0) {
			lines.push("## Tool Calls");
			lines.push("");
			for (const t of toolMessages) {
				const timestamp = t.timestamp
					? new Date(t.timestamp).toLocaleString()
					: "unknown";
				lines.push(`### ${t.tool?.name ?? "tool"} (${timestamp})`);
				lines.push("");
				if (t.tool?.input) {
					lines.push("**Input:**");
					lines.push("");
					lines.push("```json");
					lines.push(JSON.stringify(t.tool.input, null, 2));
					lines.push("```");
					lines.push("");
				}
				if (t.content && (!t.tool?.input || t.content.length > 0)) {
					lines.push(t.content);
					lines.push("");
				}
			}
		}
	}

	return lines.join("\n");
}
