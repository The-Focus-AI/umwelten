/**
 * Generic A2A (Agent-to-Agent) client.
 *
 * Speaks A2A JSON-RPC over plain HTTP to any agent that implements the
 * protocol — fetch its agent card, send a message, collect the response.
 *
 * Has no knowledge of habitats, Gaia, or any specific runtime; callers
 * pass a plain {@link A2AEndpoint} describing where the agent lives.
 */

import http from "node:http";
import { JsonRpcTransport } from "@a2a-js/sdk/client";
import type {
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from "@a2a-js/sdk";

/**
 * Events yielded by `streamA2AMessage` — re-exposed here because the SDK's
 * internal `A2AStreamEventData` alias is not part of its public surface.
 */
export type A2AStreamEvent =
  | Message
  | Task
  | TaskStatusUpdateEvent
  | TaskArtifactUpdateEvent;

/** Network coordinates of an A2A-speaking agent. */
export interface A2AEndpoint {
  /** Hostname; defaults to 127.0.0.1. */
  host?: string;
  /** TCP port the agent is listening on. */
  port: number;
  /** Optional bearer token sent on the message endpoint. */
  apiKey?: string;
  /** Human-readable label used only for error messages. */
  label?: string;
}

/** Minimal agent card fields callers typically care about. */
export interface AgentCardSummary {
  name: string;
  description?: string;
  version?: string;
  skills?: Array<{ id: string; name: string; description?: string }>;
  url?: string;
}

/** Decoded response from a non-streaming A2A `message/send` call. */
export interface A2AMessageResponse {
  text: string;
  artifacts?: Array<{ name?: string; uri?: string }>;
}

const DEFAULT_HOST = "127.0.0.1";
const AGENT_CARD_TIMEOUT_MS = 5_000;
const MESSAGE_TIMEOUT_MS = 120_000;

/**
 * Decode the JSON-RPC payload of a `message/send` response into an
 * {@link A2AMessageResponse}. Shared by the host:port and full-URL senders.
 *
 * The result can be a Message (with .parts directly) or a Task (with
 * .status.message.parts). Tolerate both shapes. Relative `/files/...`
 * artifact URIs are resolved against `origin` (#194).
 */
export function decodeA2ASendPayload(
  parsed: any,
  origin: string,
): A2AMessageResponse {
  if (parsed.error) {
    const errMsg = parsed.error.message ?? JSON.stringify(parsed.error);
    throw new Error(errMsg);
  }
  const result = parsed.result ?? parsed;
  const parts =
    result?.parts ??
    result?.status?.message?.parts ??
    result?.message?.parts ??
    [];
  const textParts = parts
    .filter((p: any) => p.kind === "text" || p.type === "text")
    .map((p: any) => p.text);
  const resolveUri = (uri: string | undefined): string | undefined => {
    if (!uri) return uri;
    try {
      return new URL(uri, origin).toString();
    } catch {
      return uri;
    }
  };
  const artifacts = (result?.artifacts ?? []).map((a: any) => ({
    name: a.name,
    uri: resolveUri(a.parts?.[0]?.file?.uri),
  }));
  return {
    text: textParts.join("\n") || "(no text response)",
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  };
}

/** Options for {@link sendA2AMessageToUrl}. */
export interface SendA2AMessageToUrlOptions {
  /**
   * Base URL of the agent (e.g. `https://gaia.example.com` or
   * `http://172.17.0.1:7420`) or its full `/a2a` JSON-RPC endpoint.
   * A missing `/a2a` path suffix is appended automatically.
   */
  endpoint: string;
  /** User text to send. */
  text: string;
  /** Optional Bearer token. */
  apiKey?: string;
  /** Optional A2A contextId to thread messages into the same session. */
  contextId?: string;
  /** Abort the request after this many ms (default 120s). */
  timeoutMs?: number;
}

/**
 * Send a non-streaming A2A `message/send` to a full URL and collect the
 * response. Unlike {@link sendA2AMessage} (plain-HTTP host:port, used for
 * local containers), this speaks to any http(s) URL — e.g. an agent behind
 * a reverse proxy — via global fetch.
 */
export async function sendA2AMessageToUrl(
  options: SendA2AMessageToUrlOptions,
): Promise<A2AMessageResponse> {
  const { endpoint, text, apiKey, contextId, timeoutMs } = options;
  const url = new URL(endpoint);
  if (!url.pathname.replace(/\/+$/, "").endsWith("/a2a")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/a2a`;
  }

  const messageId = `a2a-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: `a2a-${Date.now()}`,
    method: "message/send",
    params: {
      message: {
        messageId,
        role: "user",
        parts: [{ kind: "text", text }],
        ...(contextId ? { contextId } : {}),
      },
    },
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: rpcBody,
    signal: AbortSignal.timeout(timeoutMs ?? MESSAGE_TIMEOUT_MS),
  });
  const data = await res.text();
  if (res.status >= 400) {
    throw new Error(
      `A2A request to ${url.origin} returned HTTP ${res.status}: ${data.slice(0, 300)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error(`Invalid A2A response from ${url.origin}: ${data.slice(0, 300)}`);
  }
  try {
    return decodeA2ASendPayload(parsed, url.origin);
  } catch (err) {
    throw new Error(
      `A2A error from ${url.origin}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function describe(endpoint: A2AEndpoint): string {
  return endpoint.label ?? `${endpoint.host ?? DEFAULT_HOST}:${endpoint.port}`;
}

/** Fetch the well-known agent card from an A2A endpoint. */
export async function fetchAgentCard(
  endpoint: A2AEndpoint,
): Promise<AgentCardSummary> {
  const where = describe(endpoint);

  return new Promise<AgentCardSummary>((resolve, reject) => {
    const req = http.request(
      {
        hostname: endpoint.host ?? DEFAULT_HOST,
        port: endpoint.port,
        path: "/.well-known/agent-card.json",
        method: "GET",
        headers: { accept: "application/json" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `Agent card request to ${where} returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(data) as AgentCardSummary);
          } catch {
            reject(new Error(`Invalid agent card from ${where}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(AGENT_CARD_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout fetching agent card from ${where}`));
    });
    req.end();
  });
}

/**
 * Send a non-streaming A2A `message/send` to an endpoint and collect the
 * response. Uses JSON-RPC for simplicity; for streaming, use the transport
 * handler from {@link createA2AServer} on the server side.
 */
export async function sendA2AMessage(
  endpoint: A2AEndpoint,
  text: string,
): Promise<A2AMessageResponse> {
  const where = describe(endpoint);
  const messageId = `a2a-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: `a2a-${Date.now()}`,
    method: "message/send",
    params: {
      message: {
        messageId,
        role: "user",
        parts: [{ kind: "text", text }],
      },
    },
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (endpoint.apiKey) {
    headers.authorization = `Bearer ${endpoint.apiKey}`;
  }

  return new Promise<A2AMessageResponse>((resolve, reject) => {
    const req = http.request(
      {
        hostname: endpoint.host ?? DEFAULT_HOST,
        port: endpoint.port,
        path: "/a2a",
        method: "POST",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(
                `A2A request to ${where} returned HTTP ${res.statusCode}: ${data.slice(0, 300)}`,
              ),
            );
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            reject(
              new Error(`Invalid A2A response from ${where}: ${data.slice(0, 300)}`),
            );
            return;
          }
          try {
            // Defensive base-join (#194): habitats mint absolute artifact URIs,
            // but tolerate a relative `/files/...` from older/other agents by
            // resolving it against this endpoint's origin.
            const origin = `http://${endpoint.host ?? DEFAULT_HOST}:${endpoint.port}`;
            resolve(decodeA2ASendPayload(parsed, origin));
          } catch (err) {
            reject(
              new Error(
                `A2A error from ${where}: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(MESSAGE_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout waiting for A2A response from ${where}`));
    });
    req.write(rpcBody);
    req.end();
  });
}

/** Options for {@link streamA2AMessage}. */
export interface StreamA2AMessageOptions {
  /** Full URL pointing at the agent's `/a2a` JSON-RPC endpoint. */
  endpoint: string;
  /** User text to send. */
  text: string;
  /** Optional Bearer token. */
  apiKey?: string;
  /** Optional A2A contextId to thread messages into the same session. */
  contextId?: string;
}

/**
 * Open a streaming A2A `message/stream` connection and yield protocol events
 * as they arrive (Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent).
 *
 * Built on top of the `@a2a-js/sdk` JsonRpcTransport so the SSE wire format
 * is handled by the SDK rather than re-implemented here.
 */
export async function* streamA2AMessage(
  options: StreamA2AMessageOptions,
): AsyncGenerator<A2AStreamEvent, void, undefined> {
  const { endpoint, text, apiKey, contextId } = options;

  // If the caller passed a token, inject it on every outbound fetch the
  // transport makes.
  const fetchImpl: typeof fetch = apiKey
    ? (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string> | undefined),
            authorization: `Bearer ${apiKey}`,
          },
        })
    : fetch;

  const transport = new JsonRpcTransport({ endpoint, fetchImpl });

  const messageId = `a2a-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for await (const event of transport.sendMessageStream({
    message: {
      kind: "message",
      messageId,
      role: "user",
      parts: [{ kind: "text", text }],
      ...(contextId ? { contextId } : {}),
    },
  })) {
    yield event;
  }
}
