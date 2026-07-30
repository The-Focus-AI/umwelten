/**
 * Agent browser — paste an MCP or A2A URL, see its card, add it to a chat.
 *
 * Deliberately thin, like context-explorer: everything protocol-shaped
 * lives in umwelten. `discoverAgentEndpoint` answers "what is at this
 * URL?", `RemoteMcpClient` turns an MCP server into AI SDK tools, and an
 * A2A agent becomes one `ask_<agent>` tool over `sendA2AMessageToUrl`.
 * The chat itself is a plain `Interaction`.
 *
 *   dotenvx run -- pnpm tsx examples/agent-browser/server.ts
 *   PORT=7433 dotenvx run -- pnpm tsx examples/agent-browser/server.ts
 *
 * Model defaults to google/gemini-3-flash-preview; override with
 * AGENT_BROWSER_PROVIDER / AGENT_BROWSER_MODEL.
 */

import "@umwelten/core/env/load.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
  discoverAgentEndpoint,
  sendA2AMessageToUrl,
  RemoteMcpClient,
  type EndpointCard,
} from "@umwelten/protocols";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 7433);

const model: ModelDetails = {
  provider: process.env.AGENT_BROWSER_PROVIDER ?? "ollama",
  name: process.env.AGENT_BROWSER_MODEL ?? "gemma4:26b",
};

interface ConnectedEndpoint {
  id: string;
  card: EndpointCard;
  bearerToken?: string;
  /** Live client for MCP endpoints; A2A endpoints need no standing client. */
  mcp?: RemoteMcpClient;
}

interface UiResource {
  tool: string;
  uri?: string;
  html: string;
}

interface TranscriptRow {
  role: "user" | "assistant";
  text: string;
  toolCalls: string[];
  ui?: UiResource[];
}

/** One chat for the whole app — this is a demo, not a product. */
const state = {
  endpoints: new Map<string, ConnectedEndpoint>(),
  contextId: randomUUID(),
  interaction: null as Interaction | null,
  stimulus: null as Stimulus | null,
  transcript: [] as TranscriptRow[],
};

function toolSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "agent";
}

/** An A2A agent joins the chat as a single ask_<agent> tool. */
function a2aAskTool(ep: ConnectedEndpoint): Tool {
  const { card } = ep;
  return tool({
    description:
      `Ask the remote agent "${card.name}" to do something and return its reply.` +
      (card.description ? ` Agent description: ${card.description}` : ""),
    inputSchema: z.object({
      message: z.string().describe("What to ask the agent, as plain text."),
    }),
    execute: async ({ message }) => {
      try {
        const res = await sendA2AMessageToUrl({
          endpoint: card.url,
          text: message,
          apiKey: ep.bearerToken,
          contextId: state.contextId,
        });
        return { agent: card.name, success: true, reply: res.text, artifacts: res.artifacts };
      } catch (err) {
        return {
          agent: card.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}

function collectTools(): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const ep of state.endpoints.values()) {
    if (ep.card.kind === "mcp" && ep.mcp) {
      for (const [name, t] of Object.entries(ep.mcp.getTools())) {
        tools[name in tools ? `${toolSlug(ep.card.name)}_${name}` : name] = t;
      }
    } else if (ep.card.kind === "a2a") {
      tools[`ask_${toolSlug(ep.card.name)}`] = a2aAskTool(ep);
    }
  }
  return tools;
}

function endpointSummary(): string {
  const lines: string[] = [];
  for (const ep of state.endpoints.values()) {
    lines.push(
      `- ${ep.card.name} (${ep.card.kind.toUpperCase()}): ${ep.card.description ?? "no description"}`,
    );
  }
  return lines.length ? lines.join("\n") : "(none connected yet)";
}

function ensureInteraction(): Interaction {
  const today = new Date().toISOString().split("T")[0];
  const role =
    `You are a helpful assistant in an agent-browser chat. Today is ${today}. ` +
    `You are connected to these endpoints:\n${endpointSummary()}\n` +
    `Use MCP tools directly; use ask_* tools to delegate to remote A2A agents. ` +
    `Report tool failures honestly instead of inventing results.`;

  if (!state.interaction || !state.stimulus) {
    state.stimulus = new Stimulus({ role, tools: collectTools() });
    state.interaction = new Interaction(model, state.stimulus);
    state.interaction.setMaxSteps(20);
  } else {
    // Endpoints may have changed since the last turn. The stimulus is the
    // source of truth, but Interaction snapshots tools and system prompt —
    // setStimulus() is what re-applies them to the live conversation.
    state.stimulus.setRole(role);
    state.stimulus.setTools(collectTools());
    state.interaction.setStimulus(state.stimulus);
  }
  return state.interaction;
}

/** Names of tools invoked in messages appended after `fromIndex`. */
function extractToolCalls(interaction: Interaction, fromIndex: number): string[] {
  const calls: string[] = [];
  for (const msg of interaction.getMessages().slice(fromIndex)) {
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: string; toolName?: string };
      if (p?.type === "tool-call" && p.toolName) calls.push(p.toolName);
    }
  }
  return calls;
}

/**
 * mcp-ui HTML resources (`ui://…`, mimeType text/html) that MCP tools
 * returned in messages appended after `fromIndex`. RemoteMcpClient passes
 * non-text content blocks through verbatim, so the resource shape survives
 * into the tool-result parts.
 */
function extractUiResources(interaction: Interaction, fromIndex: number): UiResource[] {
  const found: UiResource[] = [];
  for (const msg of interaction.getMessages().slice(fromIndex)) {
    const content = (msg as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: string; toolName?: string; output?: unknown; result?: unknown };
      if (p?.type !== "tool-result") continue;
      const output = p.output as { value?: unknown } | unknown;
      const value =
        (output as { value?: unknown })?.value ?? output ?? p.result;
      const data = (value as { data?: unknown })?.data;
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        const resource = (item as { type?: string; resource?: { uri?: string; mimeType?: string; text?: string } })
          ?.resource;
        if (
          (item as { type?: string })?.type === "resource" &&
          resource?.mimeType?.startsWith("text/html") &&
          typeof resource.text === "string"
        ) {
          found.push({ tool: p.toolName ?? "tool", uri: resource.uri, html: resource.text });
        }
      }
    }
  }
  return found;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await new Promise<string>((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function publicState() {
  return {
    model,
    contextId: state.contextId,
    endpoints: [...state.endpoints.values()].map((ep) => ({
      id: ep.id,
      card: { ...ep.card, raw: undefined },
      hasToken: Boolean(ep.bearerToken),
    })),
    transcript: state.transcript,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(join(root, "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, publicState());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/discover") {
      const body = await readBody(req);
      const target = String(body.url ?? "");
      const bearerToken = body.token ? String(body.token) : undefined;
      const card = await discoverAgentEndpoint(target, { bearerToken });
      sendJson(res, 200, { card: { ...card, raw: undefined } });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/connect") {
      const body = await readBody(req);
      const target = String(body.url ?? "");
      const bearerToken = body.token ? String(body.token) : undefined;
      const card = await discoverAgentEndpoint(target, { bearerToken });

      const id = toolSlug(`${card.kind}-${card.name}`);
      if (state.endpoints.has(id)) {
        sendJson(res, 200, { alreadyConnected: true, ...publicState() });
        return;
      }

      const ep: ConnectedEndpoint = { id, card, bearerToken };
      if (card.kind === "mcp") {
        // OAuth-required endpoints trigger the interactive PKCE flow: a
        // browser opens on the machine running THIS server. Fine for the
        // local demo; a deployed instance should stick to open/bearer
        // servers (see README).
        ep.mcp = new RemoteMcpClient({
          serverUrl: card.url,
          headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : undefined,
        });
        await ep.mcp.connect();
        ep.card = { ...card, capabilities: ep.mcp.getToolNames().map((name) => ({
          name,
          description: ep.mcp?.getToolDescription(name),
        })) };
      }
      state.endpoints.set(id, ep);
      ensureInteraction();
      sendJson(res, 200, publicState());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/disconnect") {
      const body = await readBody(req);
      const id = String(body.id ?? "");
      const ep = state.endpoints.get(id);
      if (ep?.mcp) await ep.mcp.disconnect();
      state.endpoints.delete(id);
      ensureInteraction();
      sendJson(res, 200, publicState());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const message = String(body.message ?? "").trim();
      if (!message) {
        sendJson(res, 400, { error: "message is required" });
        return;
      }
      const interaction = ensureInteraction();
      const before = interaction.getMessages().length;
      interaction.addMessage({ role: "user", content: message });
      const response = await interaction.generateText();
      const toolCalls = extractToolCalls(interaction, before);
      const ui = extractUiResources(interaction, before);
      state.transcript.push({ role: "user", text: message, toolCalls: [] });
      state.transcript.push({
        role: "assistant",
        text: response.content,
        toolCalls,
        ...(ui.length ? { ui } : {}),
      });
      sendJson(res, 200, { reply: response.content, toolCalls, ...publicState() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ui-tool") {
      // Host side of the widget bridge (the MCP Apps pattern in miniature):
      // a widget asked the host to run a tool call on its behalf. Execute it
      // on the already-connected client, swap the originating widget's
      // transcript entry for the fresh one, and — crucially — tell the model
      // what happened so the conversation doesn't go stale behind the UI.
      const body = await readBody(req);
      const toolName = String(body.tool ?? "");
      const args = (body.args ?? {}) as Record<string, unknown>;
      const sourceUri = body.uri ? String(body.uri) : undefined;
      const toolImpl = collectTools()[toolName];
      if (!toolImpl?.execute) {
        sendJson(res, 404, { error: `unknown tool: ${toolName}` });
        return;
      }

      const result = (await toolImpl.execute(args, {
        toolCallId: `ui-${Date.now()}`,
        messages: [],
      } as never)) as { success?: boolean; data?: unknown };

      const blocks = Array.isArray(result.data) ? (result.data as Array<Record<string, any>>) : [];
      const ui: UiResource[] = blocks
        .filter(
          (b) =>
            b?.type === "resource" &&
            typeof b.resource?.text === "string" &&
            String(b.resource?.mimeType ?? "").startsWith("text/html"),
        )
        .map((b) => ({ tool: toolName, uri: b.resource.uri, html: b.resource.text }));
      const text =
        blocks.find((b) => b?.type === "text")?.text ??
        (typeof result.data === "string" ? result.data : "");

      // Replace the originating widget in place so the transcript shows the
      // house as it now is, and mark the row with a widget-driven call chip.
      if (sourceUri) {
        for (let i = state.transcript.length - 1; i >= 0; i--) {
          const row = state.transcript[i];
          const idx = row.ui?.findIndex((u) => u.uri === sourceUri) ?? -1;
          if (idx >= 0 && row.ui) {
            if (ui[0]) row.ui[idx] = ui[0];
            row.toolCalls.push(`${toolName} ⚡`);
            break;
          }
        }
      } else if (ui.length) {
        state.transcript.push({
          role: "assistant",
          text: `⚡ ${toolName} via widget`,
          toolCalls: [toolName],
          ui,
        });
      }

      // MCP Apps' "update the model's context" leg: the next turn's model
      // sees what the user did in the UI instead of reasoning from stale state.
      ensureInteraction().addMessage({
        role: "user",
        content: `[widget] I used the ${toolName} control (${JSON.stringify(args)}). Result: ${
          text || (result.success !== false ? "ok" : "failed")
        }. No reply needed.`,
      });

      sendJson(res, 200, {
        success: result.success !== false,
        text,
        ui,
        ...publicState(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      state.transcript = [];
      state.contextId = randomUUID();
      state.interaction = null;
      state.stimulus = null;
      ensureInteraction();
      sendJson(res, 200, publicState());
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) sendJson(res, 500, { error: message });
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});

server.listen(port, () => {
  console.log(`agent-browser: http://localhost:${port}`);
  console.log(`model: ${model.provider}/${model.name}`);
});
