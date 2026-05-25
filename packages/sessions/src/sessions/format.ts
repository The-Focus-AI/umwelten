/**
 * `umwelten sessions format` — pretty-print a Claude Code JSONL
 * transcript from stdin. Six display modes via --assistant-only /
 * --user-only / --no-tools / --quiet / --short.
 *
 * Pure stream processor; doesn't touch the session store or any
 * helper from helpers.ts.
 */

import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";

export function registerFormatCommand(parent: Command): void {
// Format subcommand
interface FormatOptions {
	assistantOnly?: boolean;
	userOnly?: boolean;
	tools?: boolean; // Default true, can be disabled with --no-tools
	quiet?: boolean;
	short?: boolean; // Compact table view
}

parent
	.command("format")
	.description(
		"Format JSONL session stream from stdin to readable text with rich metrics",
	)
	.option("--assistant-only", "Show only assistant messages")
	.option("--user-only", "Show only user messages")
	.option("--no-tools", "Hide tool calls and execution details")
	.option("--quiet", "Minimal output - just conversation")
	.option("--short", "Compact table view with key metrics")
	.action(async (options: FormatOptions) => {
		try {
			const { createInterface } = await import("node:readline");
			const { stdin } = await import("node:process");

			// Check if stdin is being piped
			if (stdin.isTTY) {
				console.error(
					chalk.red("Error: This command requires input from stdin"),
				);
				console.log(
					chalk.dim(
						'\nUsage: claude -p "prompt" --output-format stream-json | umwelten sessions format',
					),
				);
				console.log(
					chalk.dim("       cat session.jsonl | umwelten sessions format"),
				);
				process.exit(1);
			}

			const rl = createInterface({
				input: stdin,
				crlfDelay: Infinity,
			});

			// Default to showing tools unless explicitly disabled
			const showTools = options.tools !== false;
			const isQuiet = options.quiet === true;
			const isShort = options.short === true;

			// Session tracking
			let sessionStartTime: number | null = null;
			let lastMessageTime: number | null = null;
			let messageCount = 0;
			let totalInputTokens = 0;
			let totalOutputTokens = 0;
			let totalCacheRead = 0;
			let totalCacheWrite = 0;
			const toolCalls: Array<{
				name: string;
				timestamp: number;
				resultSize?: number;
				duration?: number;
			}> = [];
			const pendingTools = new Map<
				string,
				{ name: string; timestamp: number }
			>();
			let sessionMetadata: any = null;
			let finalResult: any = null;

			// Pricing (Claude Sonnet 4.5)
			const INPUT_PRICE_PER_MTK = 3.0;
			const OUTPUT_PRICE_PER_MTK = 15.0;
			const CACHE_WRITE_PRICE_PER_MTK = 3.75;
			const CACHE_READ_PRICE_PER_MTK = 0.3;

			for await (const line of rl) {
				if (!line.trim()) continue;

				try {
					const message = JSON.parse(line);
					const now = Date.now();

					// Track session start
					if (message.type === "system" && message.subtype === "init") {
						sessionStartTime = now;
						sessionMetadata = message;

						if (!isShort && !options.userOnly && !options.assistantOnly) {
							console.log(chalk.dim("━".repeat(80)));
							console.log(chalk.cyan.bold("📡 Session started"));
							console.log(
								chalk.dim(
									`ID: ${message.session_id?.split("-")[0] || "unknown"}`,
								),
							);
							console.log(chalk.dim(`Model: ${message.model || "unknown"}`));
							console.log(chalk.dim(`CWD: ${message.cwd || "unknown"}`));
							console.log(
								chalk.dim(
									`Claude Code: v${message.claude_code_version || "unknown"}`,
								),
							);

							if (message.agents && message.agents.length > 0) {
								console.log(
									chalk.dim(
										`Agents: ${message.agents.slice(0, 5).join(", ")}${message.agents.length > 5 ? ` +${message.agents.length - 5} more` : ""}`,
									),
								);
							}

							if (message.plugins && message.plugins.length > 0) {
								console.log(
									chalk.dim(`Plugins: ${message.plugins.length} loaded`),
								);
							}

							if (message.mcp_servers && message.mcp_servers.length > 0) {
								console.log(
									chalk.dim(`MCP Servers: ${message.mcp_servers.length}`),
								);
							}

							console.log(chalk.dim("━".repeat(80)));
						}
					}

					// Filter based on options
					if (options.userOnly && message.type !== "user") continue;
					if (options.assistantOnly && message.type !== "assistant") continue;

					// Handle different message types
					if (
						message.type === "user" &&
						!message.message?.content?.some(
							(b: any) => b.type === "tool_result",
						)
					) {
						messageCount++;
						const timeSinceLast = lastMessageTime ? now - lastMessageTime : 0;
						lastMessageTime = now;

						if (!isShort) {
							console.log(
								chalk.bold.green(`\n👤 User`) +
									(timeSinceLast > 1000
										? chalk.dim(` (+${(timeSinceLast / 1000).toFixed(1)}s)`)
										: ""),
							);

							const content = message.message?.content;
							if (typeof content === "string") {
								console.log(content);
							} else if (Array.isArray(content)) {
								for (const block of content) {
									if (block.type === "text") {
										console.log(block.text);
									}
								}
							}
						}
					} else if (message.type === "assistant") {
						const timeSinceLast = lastMessageTime ? now - lastMessageTime : 0;
						lastMessageTime = now;

						const content = message.message?.content;
						const usage = message.message?.usage;

						// Track tokens
						if (usage) {
							totalInputTokens += usage.input_tokens || 0;
							totalOutputTokens += usage.output_tokens || 0;
							totalCacheRead += usage.cache_read_input_tokens || 0;
							totalCacheWrite += usage.cache_creation_input_tokens || 0;
						}

						// Check if this is a text response or tool call
						const hasText =
							Array.isArray(content) &&
							content.some((b: any) => b.type === "text" && b.text);
						const toolUses = Array.isArray(content)
							? content.filter((b: any) => b.type === "tool_use")
							: [];

						if (hasText) {
							messageCount++;

							if (!isShort) {
								console.log(
									chalk.bold.blue(`\n🤖 Assistant`) +
										(timeSinceLast > 1000
											? chalk.dim(` (+${(timeSinceLast / 1000).toFixed(1)}s)`)
											: ""),
								);

								if (typeof content === "string") {
									console.log(content);
								} else if (Array.isArray(content)) {
									for (const block of content) {
										if (block.type === "text") {
											console.log(block.text);
										}
									}
								}

								// Show token usage inline
								if (usage && (showTools || !isQuiet)) {
									const inputCost =
										(usage.input_tokens / 1_000_000) * INPUT_PRICE_PER_MTK;
									const outputCost =
										(usage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_MTK;
									const cacheReadCost =
										((usage.cache_read_input_tokens || 0) / 1_000_000) *
										CACHE_READ_PRICE_PER_MTK;
									const totalCost = inputCost + outputCost + cacheReadCost;

									console.log(
										chalk.dim(
											`\n  💰 Cost: $${totalCost.toFixed(4)} | ` +
												`📊 Tokens: ${usage.output_tokens} out, ${usage.input_tokens} in` +
												(usage.cache_read_input_tokens
													? chalk.green(
															` | ⚡ ${usage.cache_read_input_tokens.toLocaleString()} cached`,
														)
													: ""),
										),
									);
								}
							}
						}

						// Handle tool calls
						for (const toolUse of toolUses) {
							if (!isShort && (showTools || !isQuiet)) {
								console.log(
									chalk.yellow(`\n🔧 Tool: ${chalk.bold(toolUse.name)}`),
								);

								// Show compact input
								const inputStr = JSON.stringify(toolUse.input, null, 2);
								const inputLines = inputStr.split("\n");
								if (inputLines.length > 10) {
									console.log(
										chalk.dim(`   ${inputLines.slice(0, 5).join("\n   ")}`),
									);
									console.log(
										chalk.dim(`   ... (${inputLines.length - 10} more lines)`),
									);
									console.log(
										chalk.dim(`   ${inputLines.slice(-5).join("\n   ")}`),
									);
								} else {
									console.log(
										chalk.dim(`   ${inputStr.split("\n").join("\n   ")}`),
									);
								}
							}

							// Track pending tool call
							pendingTools.set(toolUse.id, {
								name: toolUse.name,
								timestamp: now,
							});
						}
					} else if (message.type === "tool_result") {
						const toolUseId =
							message.tool_use_id || message.message?.content?.[0]?.tool_use_id;
						const pending = pendingTools.get(toolUseId);

						if (pending && !isShort && (showTools || !isQuiet)) {
							const duration = now - pending.timestamp;

							// Get result size
							let resultSize = 0;
							const content = message.message?.content;
							if (typeof content === "string") {
								resultSize = content.length;
							} else if (Array.isArray(content)) {
								for (const block of content) {
									if (block.type === "text") {
										resultSize += block.text?.length || 0;
									} else if (block.content) {
										resultSize +=
											typeof block.content === "string"
												? block.content.length
												: JSON.stringify(block.content).length;
									}
								}
							}

							toolCalls.push({
								name: pending.name,
								timestamp: pending.timestamp,
								resultSize,
								duration,
							});
							pendingTools.delete(toolUseId);

							console.log(
								chalk.green(`   ✓ Completed in ${duration}ms`) +
									(resultSize > 0
										? chalk.dim(
												` | ${(resultSize / 1024).toFixed(1)} KB result`,
											)
										: ""),
							);
						}
					} else if (message.type === "result") {
						finalResult = message;

						if (!isShort && message.subtype === "success" && isQuiet) {
							// Don't show success messages in quiet mode
						} else if (!isShort && !isQuiet) {
							console.log(
								chalk.dim(`\n[Result: ${message.subtype || "unknown"}]`),
							);
							if (message.result) {
								console.log(chalk.dim(`  ${message.result}`));
							}
						}
					}
				} catch (parseError) {
					if (!isQuiet) {
						console.error(chalk.red(`Failed to parse line: ${parseError}`));
					}
				}
			}

			// Print summary
			const totalDuration = sessionStartTime
				? Date.now() - sessionStartTime
				: 0;
			const actualDuration = finalResult?.duration_ms || totalDuration;
			const apiDuration = finalResult?.duration_api_ms || 0;
			const numTurns = finalResult?.num_turns || 0;
			const actualCost = finalResult?.total_cost_usd || null;

			const totalCost =
				(totalInputTokens / 1_000_000) * INPUT_PRICE_PER_MTK +
				(totalOutputTokens / 1_000_000) * OUTPUT_PRICE_PER_MTK +
				(totalCacheRead / 1_000_000) * CACHE_READ_PRICE_PER_MTK +
				(totalCacheWrite / 1_000_000) * CACHE_WRITE_PRICE_PER_MTK;

			// SHORT TABLE VIEW
			if (isShort) {
				if (finalResult) {
					console.log(chalk.bold.cyan("\n📊 Session summary (short)\n"));

					const summaryTable = new Table({
						head: ["Metric", "Value"],
						colWidths: [30, 50],
						style: {
							head: [],
							border: [],
						},
					});

					summaryTable.push(
						[
							"Session ID",
							sessionMetadata?.session_id?.split("-")[0] || "unknown",
						],
						["Model", sessionMetadata?.model || "unknown"],
						[
							"Duration",
							`${(actualDuration / 1000).toFixed(1)}s (API: ${(apiDuration / 1000).toFixed(1)}s)`,
						],
						["Turns", numTurns.toString()],
						["Messages", messageCount.toString()],
						["Tool Calls", toolCalls.length.toString()],
						[
							"Total Tokens",
							(
								totalInputTokens +
								totalOutputTokens +
								totalCacheRead +
								totalCacheWrite
							).toLocaleString(),
						],
						["Cost", chalk.green(`$${(actualCost || totalCost).toFixed(4)}`)],
					);

					console.log(summaryTable.toString());

					// Model usage breakdown if multiple models
					if (
						finalResult.modelUsage &&
						Object.keys(finalResult.modelUsage).length > 1
					) {
						console.log(chalk.bold("\n🤖 Models Used:\n"));

						const modelTable = new Table({
							head: ["Model", "In/Out Tokens", "Cache", "Cost"],
							colWidths: [30, 20, 20, 15],
							style: {
								head: [],
								border: [],
							},
						});

						for (const [modelName, usage] of Object.entries(
							finalResult.modelUsage,
						)) {
							const u = usage as any;
							modelTable.push([
								modelName.replace("claude-", ""),
								`${u.inputTokens}/${u.outputTokens}`,
								u.cacheReadInputTokens
									? `${u.cacheReadInputTokens.toLocaleString()}`
									: "0",
								chalk.green(`$${u.costUSD.toFixed(4)}`),
							]);
						}

						console.log(modelTable.toString());
					}

					// Tool usage table
					if (toolCalls.length > 0) {
						console.log(chalk.bold("\n🔧 Tool Usage:\n"));

						const toolTable = new Table({
							head: ["Tool", "Calls", "Avg Time", "Total Size"],
							colWidths: [20, 10, 15, 15],
							style: {
								head: [],
								border: [],
							},
						});

						const toolStats = new Map<
							string,
							{ count: number; totalDuration: number; totalSize: number }
						>();
						for (const call of toolCalls) {
							const stats = toolStats.get(call.name) || {
								count: 0,
								totalDuration: 0,
								totalSize: 0,
							};
							stats.count++;
							stats.totalDuration += call.duration || 0;
							stats.totalSize += call.resultSize || 0;
							toolStats.set(call.name, stats);
						}

						for (const [name, stats] of toolStats) {
							const avgDuration = stats.totalDuration / stats.count;
							toolTable.push([
								name,
								stats.count.toString(),
								avgDuration > 0 ? `${avgDuration.toFixed(0)}ms` : "-",
								stats.totalSize > 0
									? `${(stats.totalSize / 1024).toFixed(1)} KB`
									: "-",
							]);
						}

						console.log(toolTable.toString());
					}
				} else {
					console.log(chalk.yellow("\nNo session data available yet."));
				}
			}
			// DETAILED VIEW
			else if (messageCount > 0 || toolCalls.length > 0) {
				console.log(chalk.dim("\n" + "━".repeat(80)));
				console.log(chalk.cyan.bold("📊 Session summary"));
				console.log(chalk.dim("━".repeat(80)));

				if (actualDuration > 0) {
					const wallClock = (actualDuration / 1000).toFixed(1);
					const api =
						apiDuration > 0
							? ` (API: ${(apiDuration / 1000).toFixed(1)}s)`
							: "";
					console.log(
						chalk.white(
							`⏱️  Duration: ${chalk.bold(wallClock)}s${chalk.dim(api)}`,
						),
					);
				}

				if (numTurns > 0) {
					console.log(
						chalk.white(`🔄 Conversation Turns: ${chalk.bold(numTurns)}`),
					);
				}

				if (messageCount > 0) {
					console.log(chalk.white(`💬 Messages: ${chalk.bold(messageCount)}`));
				}

				if (toolCalls.length > 0) {
					console.log(
						chalk.white(`🔧 Tool Calls: ${chalk.bold(toolCalls.length)}`),
					);

					// Group by tool name
					const toolStats = new Map<
						string,
						{ count: number; totalDuration: number; totalSize: number }
					>();
					for (const call of toolCalls) {
						const stats = toolStats.get(call.name) || {
							count: 0,
							totalDuration: 0,
							totalSize: 0,
						};
						stats.count++;
						stats.totalDuration += call.duration || 0;
						stats.totalSize += call.resultSize || 0;
						toolStats.set(call.name, stats);
					}

					for (const [name, stats] of toolStats) {
						const avgDuration = stats.totalDuration / stats.count;
						console.log(
							chalk.dim(
								`   • ${name}: ${stats.count}x` +
									(avgDuration > 0 ? `, avg ${avgDuration.toFixed(0)}ms` : "") +
									(stats.totalSize > 0
										? `, ${(stats.totalSize / 1024).toFixed(1)} KB`
										: ""),
							),
						);
					}
				}

				// Model usage breakdown if available
				if (
					finalResult?.modelUsage &&
					Object.keys(finalResult.modelUsage).length > 0
				) {
					console.log(chalk.white(`\n🤖 Models Used:`));

					for (const [modelName, usage] of Object.entries(
						finalResult.modelUsage,
					)) {
						const u = usage as any;
						const shortName = modelName
							.replace("claude-", "")
							.replace("-20250929", "")
							.replace("-20251001", "");
						console.log(chalk.dim(`   • ${shortName}:`));
						console.log(
							chalk.dim(
								`     - Tokens: ${u.inputTokens} in, ${u.outputTokens} out` +
									(u.cacheReadInputTokens
										? chalk.green(
												`, ${u.cacheReadInputTokens.toLocaleString()} cached`,
											)
										: ""),
							),
						);
						console.log(
							chalk.dim(
								`     - Cost: ${chalk.green(`$${u.costUSD.toFixed(4)}`)}`,
							),
						);
					}
				}

				if (totalInputTokens > 0 || totalOutputTokens > 0) {
					console.log(chalk.white(`\n📊 Total Tokens:`));
					console.log(
						chalk.dim(`   • Input: ${totalInputTokens.toLocaleString()}`),
					);
					console.log(
						chalk.dim(`   • Output: ${totalOutputTokens.toLocaleString()}`),
					);
					if (totalCacheRead > 0) {
						console.log(
							chalk.green(
								`   • Cache Read: ${totalCacheRead.toLocaleString()}`,
							),
						);
					}
					if (totalCacheWrite > 0) {
						console.log(
							chalk.yellow(
								`   • Cache Write: ${totalCacheWrite.toLocaleString()}`,
							),
						);
					}
					console.log(
						chalk.dim(
							`   • Total: ${(totalInputTokens + totalOutputTokens + totalCacheRead + totalCacheWrite).toLocaleString()}`,
						),
					);
				}

				const displayCost = actualCost !== null ? actualCost : totalCost;
				if (displayCost > 0) {
					const costLabel =
						actualCost !== null ? "Actual Cost" : "Estimated Cost";
					console.log(
						chalk.white(
							`\n💰 ${costLabel}: ${chalk.bold.green(`$${displayCost.toFixed(4)}`)}`,
						),
					);
				}

				// Permission denials if any
				if (
					finalResult?.permission_denials &&
					finalResult.permission_denials.length > 0
				) {
					console.log(
						chalk.yellow(
							`\n⚠️  Permission Denials: ${finalResult.permission_denials.length}`,
						),
					);
				}

				// Web usage if any
				if (finalResult?.usage?.server_tool_use) {
					const webSearch =
						finalResult.usage.server_tool_use.web_search_requests || 0;
					const webFetch =
						finalResult.usage.server_tool_use.web_fetch_requests || 0;
					if (webSearch > 0 || webFetch > 0) {
						console.log(chalk.white(`\n🌐 Web Usage:`));
						if (webSearch > 0)
							console.log(chalk.dim(`   • Search Requests: ${webSearch}`));
						if (webFetch > 0)
							console.log(chalk.dim(`   • Fetch Requests: ${webFetch}`));
					}
				}

				console.log(chalk.dim("━".repeat(80)));
			} else if (isQuiet) {
				console.log(chalk.yellow("\nNo messages found in stream."));
			}
		} catch (error) {
			console.error(chalk.red("Error formatting stream:"), error);
			process.exit(1);
		}
	});

}
