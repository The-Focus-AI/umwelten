/**
 * A2A Client — Gaia acts as an A2A client to discover and query running habitats.
 */

import http from "node:http";
import type { GaiaHabitatEntry } from "./types.js";

/** Minimal agent card fields we care about. */
export interface AgentCardSummary {
  name: string;
  description?: string;
  version?: string;
  skills?: Array<{ id: string; name: string; description?: string }>;
  url?: string;
}

/**
 * Fetch the agent card from a running habitat container.
 */
export async function fetchAgentCard(
  entry: GaiaHabitatEntry,
): Promise<AgentCardSummary> {
  if (!entry.containerPort) {
    throw new Error(`Container ${entry.id} not running`);
  }

  return new Promise<AgentCardSummary>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: entry.containerPort,
        path: "/.well-known/agent-card.json",
        method: "GET",
        headers: { accept: "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Agent card request to ${entry.id} returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as AgentCardSummary);
          } catch {
            reject(new Error(`Invalid agent card from ${entry.id}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Timeout fetching agent card from ${entry.id}`));
    });
    req.end();
  });
}

/** Response from an A2A message/send call. */
export interface A2AMessageResponse {
  text: string;
  artifacts?: Array<{ name?: string; uri?: string }>;
}

/**
 * Send an A2A message to a running habitat and collect the response.
 * Uses non-streaming JSON-RPC for simplicity.
 */
export async function sendA2AMessage(
  entry: GaiaHabitatEntry,
  text: string,
): Promise<A2AMessageResponse> {
  if (!entry.containerPort) {
    throw new Error(`Container ${entry.id} not running`);
  }

  const messageId = `gaia-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: `gaia-${Date.now()}`,
    method: "message/send",
    params: {
      message: {
        messageId,
        role: "user",
        parts: [{ kind: "text", text }],
      },
    },
  });

  return new Promise<A2AMessageResponse>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: entry.containerPort,
        path: "/a2a",
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${entry.apiKey}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          // Check HTTP-level errors
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`A2A request to ${entry.id} returned HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            // Check for JSON-RPC error
            if (parsed.error) {
              const errMsg = parsed.error.message ?? JSON.stringify(parsed.error);
              reject(new Error(`A2A error from ${entry.id}: ${errMsg}`));
              return;
            }
            // Extract text from A2A response
            // The result can be a Message (with .parts directly) or a Task (with .status.message.parts)
            const result = parsed.result ?? parsed;
            const parts = result?.parts ?? result?.status?.message?.parts ?? result?.message?.parts ?? [];
            const textParts = parts
              .filter((p: any) => p.kind === "text" || p.type === "text")
              .map((p: any) => p.text);
            const artifacts = (result?.artifacts ?? []).map((a: any) => ({
              name: a.name,
              uri: a.parts?.[0]?.file?.uri,
            }));
            resolve({
              text: textParts.join("\n") || "(no text response)",
              artifacts: artifacts.length > 0 ? artifacts : undefined,
            });
          } catch {
            reject(new Error(`Invalid A2A response from ${entry.id}: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy(new Error(`Timeout waiting for A2A response from ${entry.id}`));
    });
    req.write(rpcBody);
    req.end();
  });
}

/**
 * Discover all running habitats by fetching their agent cards.
 * Skips containers that fail to respond.
 */
export async function discoverHabitats(
  entries: GaiaHabitatEntry[],
): Promise<Array<{ id: string; card: AgentCardSummary } | { id: string; error: string }>> {
  const running = entries.filter((e) => e.containerPort);
  const results = await Promise.allSettled(
    running.map(async (entry) => {
      const card = await fetchAgentCard(entry);
      return { id: entry.id, card };
    }),
  );

  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { id: running[i].id, error: r.reason?.message ?? "Unknown error" },
  );
}
