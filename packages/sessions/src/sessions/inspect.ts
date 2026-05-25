/**
 * `umwelten sessions list / show / messages / tools / stats` — the
 * "inspect one session" subcommands. Each registers itself on a
 * parent `Command` (Commander's chained `parent.command(...)` API).
 */

import { cwd } from "node:process";
import { resolve } from "node:path";
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { hasAnalysisIndex } from "@umwelten/core/interaction/persistence/session-store.js";
import { getAdapterRegistry } from "@umwelten/core/interaction/adapters/index.js";
import type {
	NormalizedSessionEntry,
	SessionSource,
} from "@umwelten/core/interaction/types/normalized-types.js";
import {
	findSessionById,
	formatDate,
	formatDuration,
	getSourceColor,
	getSourceLabel,
	resolveSessionEntry,
	shortSessionId,
	truncatePrompt,
	type ListOptions,
} from "./helpers.js";

export function registerInspectCommands(parent: Command): void {
// List subcommand
parent
	.command("list")
	.description(
		"List sessions for a project (auto-detects Claude Code and Cursor)",
	)
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option("--limit <number>", "Number of sessions to show", "10")
	.option("--branch <branch>", "Filter by git branch")
	.option(
		"--sort <field>",
		"Sort by field (created, modified, messages)",
		"modified",
	)
	.option(
		"--source <source>",
		"Filter by source (claude-code, cursor, all)",
		"all",
	)
	.option("--json", "Output in JSON format")
	.action(async (options: ListOptions) => {
		try {
			const projectPath = resolve(options.project);
			const registry = getAdapterRegistry();
			const limit = parseInt(options.limit);
			const sourceFilter = options.source || "all";

			// Collect sessions from all requested sources
			const allSessions: NormalizedSessionEntry[] = [];
			const sourceCounts: Record<string, number> = {};

			// Get adapters to query
			const adaptersToQuery =
				sourceFilter === "all"
					? registry.getAll()
					: [registry.get(sourceFilter as SessionSource)].filter(Boolean);

			if (adaptersToQuery.length === 0) {
				console.error(chalk.red(`Unknown source: ${sourceFilter}`));
				console.log(chalk.dim("Available sources: claude-code, cursor, all"));
				process.exit(1);
			}

			// Query each adapter
			for (const adapter of adaptersToQuery) {
				if (!adapter) continue;

				try {
					const result = await adapter.discoverSessions({
						projectPath,
						gitBranch: options.branch,
						sortBy: options.sort === "messages" ? "messageCount" : options.sort,
						sortOrder: "desc",
					});

					sourceCounts[adapter.source] = result.totalCount;
					allSessions.push(...result.sessions);
				} catch {
					// Source not available for this project, skip silently
					sourceCounts[adapter.source] = 0;
				}
			}

			// Group sessions by source for interleaving
			const sessionsBySource = new Map<string, NormalizedSessionEntry[]>();
			for (const session of allSessions) {
				const list = sessionsBySource.get(session.source) || [];
				list.push(session);
				sessionsBySource.set(session.source, list);
			}

			// Sort each source's sessions
			const sortFn = (a: NormalizedSessionEntry, b: NormalizedSessionEntry) => {
				switch (options.sort) {
					case "created":
						return (
							new Date(b.created).getTime() - new Date(a.created).getTime()
						);
					case "modified":
						return (
							new Date(b.modified).getTime() - new Date(a.modified).getTime()
						);
					case "messages":
						return b.messageCount - a.messageCount;
					default:
						return 0;
				}
			};

			for (const [_source, sessions] of sessionsBySource) {
				sessions.sort(sortFn);
			}

			// Interleave sessions from different sources to ensure representation
			// If we have multiple sources, ensure each gets at least a few slots
			let limitedSessions: NormalizedSessionEntry[];
			const activeSources = [...sessionsBySource.entries()].filter(
				([, s]) => s.length > 0,
			);

			if (activeSources.length > 1) {
				// Multiple sources: interleave to guarantee representation
				// Reserve at least 2 slots per source, then fill remaining with most recent
				const minPerSource = Math.min(
					2,
					Math.floor(limit / activeSources.length),
				);
				const reserved: NormalizedSessionEntry[] = [];
				const remaining: NormalizedSessionEntry[] = [];

				for (const [_source, sessions] of activeSources) {
					// Take the minimum reserved slots from each source
					reserved.push(...sessions.slice(0, minPerSource));
					// Put the rest in remaining pool
					remaining.push(...sessions.slice(minPerSource));
				}

				// Sort remaining by the sort criteria
				remaining.sort(sortFn);

				// Combine: reserved first, then fill with remaining up to limit
				limitedSessions = [...reserved, ...remaining].slice(0, limit);

				// Re-sort the final combined list so display is consistent
				limitedSessions.sort(sortFn);
			} else {
				// Single source: just sort and limit normally
				allSessions.sort(sortFn);
				limitedSessions = allSessions.slice(0, limit);
			}

			// Output JSON if requested
			if (options.json) {
				console.log(
					JSON.stringify(
						{
							sessions: limitedSessions,
							totalCount: allSessions.length,
							sourceCounts,
						},
						null,
						2,
					),
				);
				return;
			}

			// Display results
			if (limitedSessions.length === 0) {
				console.log(chalk.yellow("\nNo sessions found."));

				// Show which sources were checked
				const checkedSources = Object.keys(sourceCounts).join(", ");
				console.log(chalk.dim(`\nChecked sources: ${checkedSources}`));
				console.log(
					chalk.dim(
						"Make sure this is a project directory with sessions (Claude Code, Cursor).",
					),
				);
				return;
			}

			// Show source summary
			const sourcesSummary = Object.entries(sourceCounts)
				.filter(([, count]) => count > 0)
				.map(([source, count]) => {
					const colorFn = getSourceColor(source as SessionSource);
					return colorFn(
						`${getSourceLabel(source as SessionSource)}: ${count}`,
					);
				})
				.join(", ");

			console.log(
				chalk.bold(
					`\nFound ${allSessions.length} sessions (showing ${limitedSessions.length})`,
				),
			);
			if (Object.keys(sourceCounts).length > 1 || sourceFilter === "all") {
				console.log(chalk.dim(`Sources: ${sourcesSummary}`));
			}
			console.log();

			// Build table with source column
			const showSourceColumn =
				sourceFilter === "all" &&
				Object.keys(sourceCounts).filter((k) => sourceCounts[k] > 0).length > 1;

			const tableHead = showSourceColumn
				? ["Source", "ID", "Branch", "Msgs", "Modified", "First Prompt"]
				: ["ID", "Branch", "Msgs", "Modified", "First Prompt"];

			const tableWidths = showSourceColumn
				? [8, 10, 12, 6, 10, 45]
				: [10, 15, 8, 12, 50];

			const table = new Table({
				head: tableHead,
				colWidths: tableWidths,
				style: {
					head: [],
					border: [],
				},
			});

			for (const session of limitedSessions) {
				const colorFn = getSourceColor(session.source);
				const row = showSourceColumn
					? [
							colorFn(getSourceLabel(session.source)),
							chalk.cyan(shortSessionId(session.sourceId)),
							session.gitBranch || "-",
							session.messageCount.toString(),
							formatDate(session.modified),
							truncatePrompt(session.firstPrompt, 42),
						]
					: [
							chalk.cyan(shortSessionId(session.sourceId)),
							session.gitBranch || "-",
							session.messageCount.toString(),
							formatDate(session.modified),
							truncatePrompt(session.firstPrompt),
						];

				table.push(row);
			}

			console.log(table.toString());

			console.log(chalk.dim('\nTip: Use "sessions show <id>" to view details'));
			console.log(
				chalk.dim("     Use --source claude-code or --source cursor to filter"),
			);
		} catch (error) {
			console.error(chalk.red("Error listing sessions:"), error);
			process.exit(1);
		}
	});

// Show subcommand
interface ShowOptions {
	project: string;
	json?: boolean;
	file?: string;
	sessionDir?: string;
}

parent
	.command("show")
	.description("Show details for a specific session")
	.argument(
		"[session-id]",
		"Session ID (omit when using --file or --session-dir)",
	)
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option(
		"--file <path>",
		"Load session from transcript JSONL path (e.g. Jeeves session)",
	)
	.option(
		"--session-dir <path>",
		"Load session from directory containing transcript.jsonl (e.g. JEEVES_SESSIONS_DIR/session-id)",
	)
	.option("--json", "Output in JSON format")
	.action(async (sessionId: string, options: ShowOptions) => {
		try {
			const projectPath = resolve(options.project);
			const session = await resolveSessionEntry(
				projectPath,
				sessionId ?? "",
				options.file,
				options.sessionDir,
			);

			if (!session) {
				if (options.file || options.sessionDir) {
					console.error(chalk.red("File or session directory not found."));
				} else {
					console.error(chalk.red(`Session not found: ${sessionId}`));
					console.log(
						chalk.dim(
							'\nTip: Use "sessions list" to see available sessions, or --file / --session-dir for Jeeves sessions',
						),
					);
				}
				process.exit(1);
			}

			// Load session content — adapter sessions use the adapter; file sessions use parseSessionFile
			let messages: any[] = [];
			let summary: any = null;

			if (session.fullPath) {
				const { parseSessionFile, summarizeSession } = await import(
					"@umwelten/core/interaction/persistence/session-parser.js"
				);
				messages = await parseSessionFile(session.fullPath);
				summary = summarizeSession(messages);
			} else if (session.source && session.source !== "claude-code") {
				const registry = getAdapterRegistry();
				const adapter = registry.get(session.source);
				if (adapter) {
					try {
						const normalizedSession = await adapter.getSession(
							session.sessionId,
						);
						if (normalizedSession) {
							messages = normalizedSession.messages;
							const userMsgs = messages.filter(
								(m: any) => m.role === "user" || m.role === "assistant",
							);
							summary = {
								userMessages: userMsgs.filter((m: any) => m.role === "user")
									.length,
								assistantMessages: userMsgs.filter(
									(m: any) => m.role === "assistant",
								).length,
								toolCalls: messages.filter(
									(m: any) => m.role === "tool" || m.tool,
								).length,
								tokenUsage: null,
								estimatedCost: normalizedSession.metrics?.estimatedCost ?? 0,
								duration: null,
							};
						}
					} catch (e) {
						console.error(
							chalk.yellow(`Warning: could not load messages: ${e}`),
						);
					}
				}
			}

			// Calculate duration in a human-readable format
			const durationStr = summary?.duration
				? formatDuration(summary.duration)
				: "N/A";

			// Output JSON if requested
			if (options.json) {
				const output = {
					sessionId: session.sessionId,
					projectPath: session.projectPath,
					gitBranch: session.gitBranch,
					created: session.created,
					modified: session.modified,
					duration: durationStr,
					isSidechain: session.isSidechain,
					messageCount: session.messageCount,
					userMessages: summary.userMessages,
					assistantMessages: summary.assistantMessages,
					toolCalls: summary.toolCalls,
					tokenUsage: summary.tokenUsage,
					estimatedCost: summary.estimatedCost,
					firstPrompt: session.firstPrompt,
				};
				console.log(JSON.stringify(output, null, 2));
				return;
			}

			// Display formatted output
			console.log(chalk.bold(`\nSession: ${chalk.cyan(session.sessionId)}\n`));
			if (session.source) {
				console.log(chalk.dim(`Source: ${session.source}`));
			}

			const tableData: Array<[string, string]> = [
				["Created", formatDate(session.created)],
				["Modified", formatDate(session.modified)],
				["Branch", session.gitBranch || "N/A"],
				["Duration", durationStr],
			];

			if (summary) {
				tableData.push(
					["", ""],
					["Messages", session.messageCount.toString()],
					["User msgs", String(summary.userMessages ?? "N/A")],
					["Assistant msgs", String(summary.assistantMessages ?? "N/A")],
					["Tool calls", String(summary.toolCalls ?? "N/A")],
				);
				if (summary.tokenUsage) {
					tableData.push(
						["", ""],
						[
							"Input tokens",
							summary.tokenUsage.input_tokens?.toLocaleString() ?? "N/A",
						],
						[
							"Output tokens",
							summary.tokenUsage.output_tokens?.toLocaleString() ?? "N/A",
						],
					);
					if (summary.tokenUsage.cache_creation_input_tokens) {
						tableData.push(
							[
								"Cache writes",
								summary.tokenUsage.cache_creation_input_tokens.toLocaleString(),
							],
							[
								"Cache reads",
								summary.tokenUsage.cache_read_input_tokens?.toLocaleString() ??
									"0",
							],
						);
					}
				}
				if (summary.estimatedCost) {
					tableData.push(
						["", ""],
						["Est. cost", chalk.green(`$${summary.estimatedCost.toFixed(4)}`)],
					);
				}
			} else if (session.messageCount > 0) {
				tableData.push(["Messages", session.messageCount.toString()]);
			}

			const table = new Table({
				colWidths: [25, 55],
				style: { head: [], border: [] },
			});
			table.push(...tableData);
			console.log(table.toString());

			if (session.firstPrompt) {
				console.log(chalk.bold("\nFirst Prompt:"));
				console.log(chalk.dim(truncatePrompt(session.firstPrompt, 100)));
			}

			const previewMsgs = messages.slice(0, 10);
			if (previewMsgs.length > 0) {
				console.log(chalk.dim("\n--- First messages ---"));
				for (const msg of previewMsgs) {
					const role = msg.role ?? msg.sourceData?.piType ?? "?";
					const content =
						typeof msg.content === "string"
							? msg.content
							: JSON.stringify(msg.content).slice(0, 80);
					const truncated =
						content.length > 80 ? content.slice(0, 77) + "..." : content;
					console.log(`  [${role}] ${truncated}`);
				}
				if (messages.length > 10) {
					console.log(
						chalk.dim(`  ... and ${messages.length - 10} more messages`),
					);
				}
			}

			console.log(
				chalk.dim('\nTip: use "sessions messages <id>" for full message view'),
			);
		} catch (error) {
			console.error(chalk.red("Error showing session:"), error);
			process.exit(1);
		}
	});

// Messages subcommand
interface MessagesOptions {
	project: string;
	userOnly?: boolean;
	assistantOnly?: boolean;
	limit?: string;
	json?: boolean;
	file?: string;
	sessionDir?: string;
}

parent
	.command("messages")
	.description("Display conversation messages from a session")
	.argument(
		"[session-id]",
		"Session ID (omit when using --file or --session-dir)",
	)
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option(
		"--file <path>",
		"Load session from transcript JSONL path (e.g. Jeeves session)",
	)
	.option(
		"--session-dir <path>",
		"Load session from directory containing transcript.jsonl",
	)
	.option("--user-only", "Show only user messages")
	.option("--assistant-only", "Show only assistant messages")
	.option("--limit <number>", "Number of messages to show (most recent first)")
	.option("--json", "Output in JSON format")
	.action(async (sessionId: string, options: MessagesOptions) => {
		try {
			const projectPath = resolve(options.project);
			const session = await resolveSessionEntry(
				projectPath,
				sessionId ?? "",
				options.file,
				options.sessionDir,
			);

			if (!session) {
				if (options.file || options.sessionDir) {
					console.error(chalk.red("File or session directory not found."));
				} else {
					console.error(chalk.red(`Session not found: ${sessionId}`));
					console.log(
						chalk.dim(
							'\nTip: Use "sessions list" or --file/--session-dir for Jeeves sessions',
						),
					);
				}
				process.exit(1);
			}

			let normalized: any[] = [];

			if (session.fullPath) {
				const { parseSessionFile, sessionMessagesToNormalized } = await import(
					"@umwelten/core/interaction/persistence/session-parser.js"
				);
				const rawMessages = await parseSessionFile(session.fullPath);
				normalized = sessionMessagesToNormalized(rawMessages);
			} else if (session.source) {
				const registry = getAdapterRegistry();
				const adapter = registry.get(session.source);
				if (adapter) {
					try {
						const sess = await adapter.getSession(session.sessionId);
						if (sess) normalized = sess.messages;
					} catch (e) {
						console.error(
							chalk.yellow(
								`Warning: could not load messages via adapter: ${e}`,
							),
						);
					}
				}
			}

			// Apply role filters

			// Apply role filters
			if (options.userOnly) {
				normalized = normalized.filter((m) => m.role === "user");
			} else if (options.assistantOnly) {
				normalized = normalized.filter(
					(m) => m.role === "assistant" || m.role === "tool",
				);
			}

			// Apply limit (most recent)
			if (options.limit) {
				const limit = parseInt(options.limit);
				normalized = normalized.slice(-limit);
			}

			// JSON output
			if (options.json) {
				const output = normalized.map((m) => ({
					id: m.id,
					role: m.role,
					content: m.content,
					timestamp: m.timestamp,
					...(m.tool && { tool: m.tool }),
					...(m.tokens && { tokens: m.tokens }),
					...(m.model && { model: m.model }),
					...(m.sourceData && { sourceData: m.sourceData }),
				}));
				console.log(JSON.stringify(output, null, 2));
				return;
			}

			if (normalized.length === 0) {
				console.log(chalk.yellow("\nNo messages found."));
				return;
			}

			console.log(chalk.bold(`\nSession: ${chalk.cyan(session.sessionId)}`));

			// Helper to format tool input for display
			const formatToolInput = (
				input: Record<string, unknown> | undefined,
			): string => {
				if (!input) return "";
				const keys = Object.keys(input);
				if (keys.length === 0) return "";
				const parts: string[] = [];
				for (const key of keys.slice(0, 3)) {
					const value = input[key];
					let displayValue: string;
					if (typeof value === "string") {
						displayValue =
							value.length > 60 ? value.slice(0, 60) + "..." : value;
					} else if (typeof value === "object") {
						const json = JSON.stringify(value);
						displayValue = json.length > 60 ? json.slice(0, 60) + "..." : json;
					} else {
						displayValue = String(value);
					}
					parts.push(`${key}: ${displayValue}`);
				}
				if (keys.length > 3) parts.push(`... +${keys.length - 3} more`);
				return parts.join(", ");
			};

			const maxContentLen = 500;

			for (const msg of normalized) {
				const timestamp = msg.timestamp ? formatDate(msg.timestamp) : "";
				const tsPrefix = timestamp ? `[${timestamp}] ` : "";

				if (msg.role === "user") {
					console.log(chalk.bold(`${tsPrefix}${chalk.green("User")}:`));
					const text = msg.content.trim();
					if (text.length > maxContentLen) {
						console.log(text.slice(0, maxContentLen) + "...");
						console.log(
							chalk.dim(`(${text.length - maxContentLen} more characters)`),
						);
					} else {
						console.log(text);
					}
					console.log("");
				} else if (msg.role === "assistant") {
					// Show reasoning/thinking if present
					const reasoning = (
						msg.sourceData as Record<string, unknown> | undefined
					)?.reasoning as string | undefined;
					if (reasoning) {
						console.log(chalk.bold(`${tsPrefix}${chalk.yellow("Thinking")}:`));
						const trimmed = reasoning.trim();
						if (trimmed.length > maxContentLen) {
							console.log(chalk.dim(trimmed.slice(0, maxContentLen) + "..."));
							console.log(
								chalk.dim(
									`(${trimmed.length - maxContentLen} more characters)`,
								),
							);
						} else {
							console.log(chalk.dim(trimmed));
						}
						console.log("");
					}

					const text = msg.content.trim();
					if (text) {
						console.log(chalk.bold(`${tsPrefix}${chalk.blue("Assistant")}:`));
						if (text.length > maxContentLen) {
							console.log(text.slice(0, maxContentLen) + "...");
							console.log(
								chalk.dim(`(${text.length - maxContentLen} more characters)`),
							);
						} else {
							console.log(text);
						}
						console.log("");
					}
				} else if (msg.role === "tool" && msg.tool) {
					const inputSummary = formatToolInput(msg.tool.input);
					console.log(
						chalk.magenta(`  ↳ ${msg.tool.name}`) +
							(inputSummary ? chalk.dim(` (${inputSummary})`) : ""),
					);

					// Show tool result
					if (msg.tool.output) {
						const output = msg.tool.output.trim();
						const errorPrefix = msg.tool.isError ? chalk.red("[ERROR] ") : "";
						if (output.length > 200) {
							console.log(
								chalk.dim(`    ${errorPrefix}→ ${output.slice(0, 200)}...`),
							);
							console.log(
								chalk.dim(`    (${output.length - 200} more characters)`),
							);
						} else {
							console.log(chalk.dim(`    ${errorPrefix}→ ${output}`));
						}
					}
					console.log("");
				}
			}

			console.log(chalk.dim(`Displayed ${normalized.length} message(s)\n`));

			console.log(
				chalk.dim(
					"Tip: Use --limit <number> to show specific number of messages",
				),
			);
			console.log(
				chalk.dim("     Use --user-only or --assistant-only to filter by role"),
			);
			console.log(
				chalk.dim(
					"     Use --json to get full message content including tool results",
				),
			);
		} catch (error) {
			console.error(chalk.red("Error displaying messages:"), error);
			process.exit(1);
		}
	});

// Tools subcommand
interface ToolsOptions {
	project: string;
	tool?: string;
	json?: boolean;
}

parent
	.command("tools")
	.description("Show tool calls from a session")
	.argument("<session-id>", "Session ID to extract tool calls from")
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option("--tool <name>", "Filter by tool name")
	.option("--json", "Output in JSON format")
	.action(async (sessionId: string, options: ToolsOptions) => {
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

			let toolCalls: any[] = [];

			if (session.fullPath) {
				const { parseSessionFile, extractToolCalls } = await import(
					"@umwelten/core/interaction/persistence/session-parser.js"
				);
				const messages = await parseSessionFile(session.fullPath);
				toolCalls = extractToolCalls(messages);
			} else if (session.source) {
				const registry = getAdapterRegistry();
				const adapter = registry.get(session.source);
				if (adapter) {
					try {
						const sess = await adapter.getSession(session.sessionId);
						if (sess) {
							toolCalls = sess.messages
								.filter((m: any) => m.role === "tool" || m.tool)
								.map((m: any) => ({
									name: m.tool?.name ?? "unknown",
									input: typeof m.content === "string" ? {} : m.content,
									output:
										typeof m.content === "string"
											? m.content.slice(0, 100)
											: "[object]",
									timestamp: m.timestamp,
								}));
						}
					} catch (e) {
						console.error(
							chalk.yellow(`Warning: could not load via adapter: ${e}`),
						);
					}
				}
			}

			// Filter by tool name if specified
			if (options.tool) {
				toolCalls = toolCalls.filter((tc) => tc.name === options.tool);
			}

			// Output JSON if requested
			if (options.json) {
				console.log(JSON.stringify(toolCalls, null, 2));
				return;
			}

			// Display formatted output
			if (toolCalls.length === 0) {
				if (options.tool) {
					console.log(
						chalk.yellow(`\nNo tool calls found for tool: ${options.tool}`),
					);
				} else {
					console.log(chalk.yellow("\nNo tool calls found in this session."));
				}
				return;
			}

			console.log(chalk.bold(`\nSession: ${chalk.cyan(session.sessionId)}`));
			console.log(chalk.dim(`Found ${toolCalls.length} tool call(s)\n`));

			const table = new Table({
				head: ["Time", "Tool", "Input"],
				colWidths: [12, 20, 70],
				style: {
					head: [],
					border: [],
				},
				wordWrap: true,
			});

			for (const toolCall of toolCalls) {
				const timestamp = toolCall.timestamp
					? formatDate(toolCall.timestamp)
					: "unknown";

				// Format input parameters - show as compact JSON
				let inputStr = "";
				if (toolCall.input && typeof toolCall.input === "object") {
					// Get key parameter names for common tools
					const keys = Object.keys(toolCall.input);
					if (keys.length === 0) {
						inputStr = "{}";
					} else {
						// Show first few keys with truncated values
						const maxKeys = 3;
						const displayKeys = keys.slice(0, maxKeys);
						const parts = displayKeys.map((key) => {
							const value = toolCall.input[key];
							let valueStr = String(value);
							if (valueStr.length > 40) {
								valueStr = valueStr.slice(0, 37) + "...";
							}
							return `${key}: ${valueStr}`;
						});

						if (keys.length > maxKeys) {
							parts.push(`... +${keys.length - maxKeys} more`);
						}

						inputStr = parts.join("\n");
					}
				} else {
					inputStr = String(toolCall.input);
				}

				table.push([timestamp, chalk.cyan(toolCall.name), chalk.dim(inputStr)]);
			}

			console.log(table.toString());

			console.log(
				chalk.dim("\nTip: Use --tool <name> to filter by specific tool"),
			);
			console.log(chalk.dim("     Use --json to get full tool call details"));
		} catch (error) {
			console.error(chalk.red("Error extracting tool calls:"), error);
			process.exit(1);
		}
	});

// Stats subcommand
interface StatsOptions {
	project: string;
	json?: boolean;
	file?: string;
	sessionDir?: string;
}

parent
	.command("stats")
	.description("Show token usage statistics and costs for a session")
	.argument(
		"[session-id]",
		"Session ID (omit when using --file or --session-dir)",
	)
	.option(
		"-p, --project <path>",
		"Project path (defaults to current directory)",
		cwd(),
	)
	.option(
		"--file <path>",
		"Load session from transcript JSONL path (e.g. Jeeves session)",
	)
	.option(
		"--session-dir <path>",
		"Load session from directory containing transcript.jsonl",
	)
	.option("--json", "Output in JSON format")
	.action(async (sessionId: string, options: StatsOptions) => {
		try {
			const projectPath = resolve(options.project);
			const session = await resolveSessionEntry(
				projectPath,
				sessionId ?? "",
				options.file,
				options.sessionDir,
			);

			if (!session) {
				if (options.file || options.sessionDir) {
					console.error(chalk.red("File or session directory not found."));
				} else {
					console.error(chalk.red(`Session not found: ${sessionId}`));
					console.log(
						chalk.dim(
							'\nTip: Use "sessions list" or --file/--session-dir for Jeeves sessions',
						),
					);
				}
				process.exit(1);
			}

			let messages: any[] = [];
			let summary: any = null;

			if (session.fullPath) {
				const { parseSessionFile, summarizeSession } = await import(
					"@umwelten/core/interaction/persistence/session-parser.js"
				);
				messages = await parseSessionFile(session.fullPath);
				summary = summarizeSession(messages);
			} else if (session.source) {
				const registry = getAdapterRegistry();
				const adapter = registry.get(session.source);
				if (adapter) {
					try {
						const sess = await adapter.getSession(session.sessionId);
						if (sess) {
							messages = sess.messages;
							const userMsgs = messages.filter(
								(m: any) => m.role === "user" || m.role === "assistant",
							);
							summary = {
								userMessages: userMsgs.filter((m: any) => m.role === "user")
									.length,
								assistantMessages: userMsgs.filter(
									(m: any) => m.role === "assistant",
								).length,
								toolCalls: messages.filter(
									(m: any) => m.role === "tool" || m.tool,
								).length,
								tokenUsage: null,
								estimatedCost: sess.metrics?.estimatedCost ?? 0,
							};
						}
					} catch (e) {
						console.error(
							chalk.yellow(`Warning: could not load via adapter: ${e}`),
						);
					}
				}
			}

			if (options.json) {
				const output: any = {
					sessionId: session.sessionId,
					source: session.source,
				};
				if (summary) {
					output.messages = session.messageCount;
					output.userMessages = summary.userMessages;
					output.assistantMessages = summary.assistantMessages;
					output.toolCalls = summary.toolCalls;
					if (summary.tokenUsage) {
						output.tokenUsage = {
							input: summary.tokenUsage.input_tokens ?? 0,
							output: summary.tokenUsage.output_tokens ?? 0,
							cacheWrite: summary.tokenUsage.cache_creation_input_tokens ?? 0,
							cacheRead: summary.tokenUsage.cache_read_input_tokens ?? 0,
						};
					}
					output.estimatedCost = summary.estimatedCost;
					output.duration = summary.duration;
				}
				console.log(JSON.stringify(output, null, 2));
				return;
			}

			console.log(chalk.bold(`\nSession: ${chalk.cyan(session.sessionId)}`));
			if (session.source) console.log(chalk.dim(`Source: ${session.source}`));

			if (!summary || !summary.tokenUsage) {
				console.log(
					chalk.yellow("\nNo token stats available for adapter sessions."),
				);
				if (session.messageCount > 0) {
					console.log(`  Messages: ${session.messageCount}`);
					console.log(
						chalk.dim(
							"  (stats require file-based sessions or indexed Claude Code sessions)",
						),
					);
				}
				return;
			}

			// Calculate cache efficiency
			const totalInputTokens =
				summary.tokenUsage.input_tokens +
				(summary.tokenUsage.cache_creation_input_tokens || 0) +
				(summary.tokenUsage.cache_read_input_tokens || 0);

			const cacheHitRate =
				totalInputTokens > 0
					? ((summary.tokenUsage.cache_read_input_tokens || 0) /
							totalInputTokens) *
						100
					: 0;

			// Calculate cost breakdown
			const INPUT_PRICE_PER_MTK = 3.0;
			const OUTPUT_PRICE_PER_MTK = 15.0;
			const CACHE_WRITE_PRICE_PER_MTK = 3.75;
			const CACHE_READ_PRICE_PER_MTK = 0.3;

			const inputCost =
				(summary.tokenUsage.input_tokens / 1_000_000) * INPUT_PRICE_PER_MTK;
			const outputCost =
				(summary.tokenUsage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_MTK;
			const cacheWriteCost =
				((summary.tokenUsage.cache_creation_input_tokens || 0) / 1_000_000) *
				CACHE_WRITE_PRICE_PER_MTK;
			const cacheReadCost =
				((summary.tokenUsage.cache_read_input_tokens || 0) / 1_000_000) *
				CACHE_READ_PRICE_PER_MTK;

			// Output JSON if requested
			if (options.json) {
				const output = {
					sessionId: session.sessionId,
					tokenUsage: {
						input: summary.tokenUsage.input_tokens,
						output: summary.tokenUsage.output_tokens,
						cacheWrite: summary.tokenUsage.cache_creation_input_tokens || 0,
						cacheRead: summary.tokenUsage.cache_read_input_tokens || 0,
						total: totalInputTokens + summary.tokenUsage.output_tokens,
					},
					cacheStats: {
						hitRate: cacheHitRate,
						writeTokens: summary.tokenUsage.cache_creation_input_tokens || 0,
						readTokens: summary.tokenUsage.cache_read_input_tokens || 0,
					},
					costs: {
						input: inputCost,
						output: outputCost,
						cacheWrite: cacheWriteCost,
						cacheRead: cacheReadCost,
						total: summary.estimatedCost,
					},
					messages: {
						total: summary.totalMessages,
						user: summary.userMessages,
						assistant: summary.assistantMessages,
						toolCalls: summary.toolCalls,
					},
				};
				console.log(JSON.stringify(output, null, 2));
				return;
			}

			// Display formatted output
			console.log(chalk.bold(`\nToken Usage & Cost Statistics`));
			console.log(chalk.dim(`Session: ${chalk.cyan(session.sessionId)}\n`));

			// Token Usage Table
			const tokenTable = new Table({
				head: ["Token Type", "Count", "Cost"],
				colWidths: [25, 20, 15],
				style: {
					head: [],
					border: [],
				},
			});

			tokenTable.push(
				[
					"Input Tokens",
					summary.tokenUsage.input_tokens.toLocaleString(),
					chalk.dim(`$${inputCost.toFixed(4)}`),
				],
				[
					"Output Tokens",
					summary.tokenUsage.output_tokens.toLocaleString(),
					chalk.dim(`$${outputCost.toFixed(4)}`),
				],
				[
					chalk.yellow("Cache Write Tokens"),
					(
						summary.tokenUsage.cache_creation_input_tokens || 0
					).toLocaleString(),
					chalk.dim(`$${cacheWriteCost.toFixed(4)}`),
				],
				[
					chalk.green("Cache Read Tokens"),
					(summary.tokenUsage.cache_read_input_tokens || 0).toLocaleString(),
					chalk.dim(`$${cacheReadCost.toFixed(4)}`),
				],
				["", "", ""],
				[
					chalk.bold("Total"),
					chalk.bold(
						(
							totalInputTokens + summary.tokenUsage.output_tokens
						).toLocaleString(),
					),
					chalk.bold.green(`$${summary.estimatedCost.toFixed(4)}`),
				],
			);

			console.log(tokenTable.toString());

			// Cache Statistics
			console.log(chalk.bold("\nCache Performance\n"));

			const cacheStatsTable = new Table({
				colWidths: [35, 25],
				style: {
					head: [],
					border: [],
				},
			});

			cacheStatsTable.push(
				["Cache Hit Rate", `${cacheHitRate.toFixed(2)}%`],
				[
					"Tokens Written to Cache",
					(
						summary.tokenUsage.cache_creation_input_tokens || 0
					).toLocaleString(),
				],
				[
					"Tokens Read from Cache",
					(summary.tokenUsage.cache_read_input_tokens || 0).toLocaleString(),
				],
			);

			console.log(cacheStatsTable.toString());

			// Overview
			console.log(chalk.bold("\nSession overview\n"));

			const overviewTable = new Table({
				colWidths: [35, 25],
				style: {
					head: [],
					border: [],
				},
			});

			overviewTable.push(
				["Total Messages", summary.totalMessages.toString()],
				["User Messages", summary.userMessages.toString()],
				["Assistant Messages", summary.assistantMessages.toString()],
				["Tool Calls", summary.toolCalls.toString()],
			);

			console.log(overviewTable.toString());

			console.log(
				chalk.dim('\nTip: Use "sessions show <id>" to view full details'),
			);
			console.log(chalk.dim("     Use --json to get structured output"));
		} catch (error) {
			console.error(chalk.red("Error calculating stats:"), error);
			process.exit(1);
		}
	});

}
