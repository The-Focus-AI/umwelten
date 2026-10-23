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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "ai";
import {
	extractUIResources,
	stripUIResources,
	uiResourceToMcpContent,
	type McpEmbeddedResource,
} from "./ui-resources.js";

/** An MCP tool-result content block: text or an embedded UI resource. */
export type McpContentBlock =
	| { type: "text"; text: string }
	| McpEmbeddedResource;

/** Stage custom tools through the real MCP contract without executing handlers. */
export async function validateMcpTools(tools: Record<string, Tool>): Promise<void> {
	// MCP only installs tools/list when at least one server-side tool is registered.
	if (!Object.values(tools).some((candidate) => typeof candidate.execute === "function")) return;
	const server = new McpServer({ name: "tool-validation", version: "1.0.0" });
	const client = new Client({ name: "tool-validation", version: "1.0.0" });
	try {
		for (const [name, candidate] of Object.entries(tools)) {
			try {
				registerAiTool(server, name, candidate);
			} catch (error) {
				throw new Error(`Tool "${name}" failed MCP registration: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
			}
		}
		const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		// Registration alone does not exercise conversion to the wire JSON Schema.
		await client.listTools();
	} catch (error) {
		throw new Error(`Custom tools were not activated; MCP validation failed. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	} finally {
		await client.close();
		await server.close();
	}
}

/**
 * MCP content blocks for an AI SDK tool result (ADR 0005 slice C, #196).
 * If the result carries UI resources, emit them as `EmbeddedResource` blocks
 * (the rest of the result flattens to a text block); otherwise it's text-only,
 * exactly as before. Kept pure so it's unit-testable without an McpServer.
 */
export function aiResultToMcpContent(result: unknown): McpContentBlock[] {
	const uiResources = extractUIResources(result);
	const rest = stripUIResources(result);
	const text =
		typeof rest === "string" ? rest : JSON.stringify(rest, null, 2);
	return [
		...uiResources.map((r) => uiResourceToMcpContent(r)),
		{ type: "text", text },
	];
}

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

			// AI SDK tools return arbitrary objects; serialize to text for MCP,
			// or pass a UI resource through as an EmbeddedResource block (#196).
			const content = aiResultToMcpContent(result);
			const chars = content.reduce(
				(n, c) => n + (c.type === "text" ? c.text.length : 0),
				0,
			);

			console.log(
				`[${new Date().toISOString()}] ✓ ${toolName} (${chars} chars)`,
			);

			return { content };
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
