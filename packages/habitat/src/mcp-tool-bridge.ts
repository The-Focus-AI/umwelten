/**
 * Bridge a Vercel AI SDK `Tool` into an MCP server tool registration.
 *
 * Both `container-server.ts` (multi-protocol server: MCP + chat + A2A + web)
 * and `mcp-local-server.ts` (MCP-only server) need to expose habitat tools
 * over MCP. The bridging logic is identical: pull description + inputSchema
 * + execute off the AI SDK tool, wrap execute in an MCP-shaped handler,
 * register with the McpServer. Hoisted here so both servers share one
 * implementation.
 *
 * Logging emits `[timestamp] ⚡ <tool> arg=value ...` on call and
 * `[timestamp] ✓ <tool> (N chars)` / `[timestamp] ✗ <tool>: <error>` on
 * completion — kept the same as both pre-extraction copies because the
 * habitat serve modes' transcripts are tail-watched by users.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool } from "ai";

export function registerAiTool(
	mcpServer: McpServer,
	toolName: string,
	aiTool: Tool,
): void {
	const description = (aiTool as any).description ?? "";
	const inputSchema = (aiTool as any).inputSchema;
	const execute = (aiTool as any).execute;

	// Client-side-only tools (no execute) are not exposed over MCP — skip silently.
	if (typeof execute !== "function") return;

	const handler = async (params: Record<string, unknown>) => {
		const ts = new Date().toISOString();
		const argSummary = Object.entries(params)
			.map(
				([k, v]) =>
					`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`,
			)
			.join(" ");
		console.log(
			`[${ts}] ⚡ ${toolName}${argSummary ? " " + argSummary : ""}`,
		);

		try {
			const result = await execute(params, {
				toolCallId: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				messages: [],
				abortSignal: new AbortController().signal,
			});

			// AI SDK tools return arbitrary objects; serialize to text for MCP.
			const text =
				typeof result === "string" ? result : JSON.stringify(result, null, 2);

			console.log(
				`[${new Date().toISOString()}] ✓ ${toolName} (${text.length} chars)`,
			);

			return { content: [{ type: "text" as const, text }] };
		} catch (error: any) {
			console.log(
				`[${new Date().toISOString()}] ✗ ${toolName}: ${error.message ?? String(error)}`,
			);
			return {
				content: [
					{
						type: "text" as const,
						text: `Error: ${error.message ?? String(error)}`,
					},
				],
				isError: true,
			};
		}
	};

	// registerTool() (not .tool()) — the latter doesn't recognize Zod
	// instances directly, only raw shape objects.
	(mcpServer as any).registerTool(
		toolName,
		{ description, inputSchema: inputSchema ?? undefined },
		handler,
	);
}
