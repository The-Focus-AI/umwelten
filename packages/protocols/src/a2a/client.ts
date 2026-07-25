/**
 * Generic A2A (Agent-to-Agent) client.
 *
 * Speaks A2A JSON-RPC over plain HTTP to any agent that implements the
 * protocol — fetch its agent card, send a message, collect the response.
 *
 * Has no knowledge of habitats, Gaia, or any specific runtime; callers
 * pass a plain {@link A2AEndpoint} describing where the agent lives.
 */

import { JsonRpcTransport } from "@a2a-js/sdk/client";
import type {
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from "@a2a-js/sdk";
import { createA2ATransport, resolveA2AEndpointUrl } from "./task-client.js";

/** Message ids are opaque; one generator keeps them consistent across senders. */
function newA2AMessageId(): string {
  return `a2a-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  const url = new URL(resolveA2AEndpointUrl(endpoint));

  // Blocking send: this function's contract is "give me the answer". Callers
  // who need to survive a cold start or long work want the task surface in
  // `task-client.ts` instead.
  //
  // The transport's own parse errors truncate the response to a few
  // characters, which loses the single most useful clue when an agent is
  // fronted by a proxy: that what came back was an HTML error page, not JSON.
  // Tee the body so the excerpt survives into the thrown error.
  let lastBody: string | undefined;
  const teeingFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    lastBody = await res.clone().text();
    return res;
  };

  const transport = new JsonRpcTransport({
    endpoint: url.toString(),
    fetchImpl: apiKey
      ? (input, init) =>
          teeingFetch(input, {
            ...init,
            headers: {
              ...(init?.headers as Record<string, string> | undefined),
              authorization: `Bearer ${apiKey}`,
            },
          })
      : teeingFetch,
  });
  const timeout = AbortSignal.timeout(timeoutMs ?? MESSAGE_TIMEOUT_MS);

  let result: unknown;
  try {
    result = await transport.sendMessage(
      {
        message: {
          kind: "message",
          messageId: newA2AMessageId(),
          role: "user",
          parts: [{ kind: "text", text }],
          ...(contextId ? { contextId } : {}),
        },
      },
      { signal: timeout } as never,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Only append the body when the transport did not already quote it.
    const excerpt =
      lastBody && !reason.includes(lastBody.slice(0, 40))
        ? ` Response body: ${lastBody.slice(0, 300)}`
        : "";
    throw new Error(`A2A error from ${url.origin}: ${reason}${excerpt}`, {
      cause: err,
    });
  }

  try {
    return decodeA2ASendPayload(result, url.origin);
  } catch (err) {
    throw new Error(
      `A2A error from ${url.origin}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
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
  const origin = `http://${endpoint.host ?? DEFAULT_HOST}:${endpoint.port}`;
  const url = new URL("/.well-known/agent-card.json", origin);

  const headers: Record<string, string> = { accept: "application/json" };
  if (endpoint.apiKey) headers.authorization = `Bearer ${endpoint.apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(AGENT_CARD_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Agent card request to ${where} failed: ${reason}`, {
      cause: err,
    });
  }

  const body = await res.text();
  if (res.status >= 400) {
    throw new Error(
      `Agent card request to ${where} returned HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(body) as AgentCardSummary;
  } catch {
    throw new Error(`Invalid agent card from ${where}`);
  }
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
  // A container addressed by host and port is still reachable by URL, so this
  // goes through the same SDK transport as everything else rather than a
  // hand-rolled node:http request.
  const origin = `http://${endpoint.host ?? DEFAULT_HOST}:${endpoint.port}`;

  try {
    return await sendA2AMessageToUrl({
      endpoint: origin,
      text,
      apiKey: endpoint.apiKey,
      timeoutMs: MESSAGE_TIMEOUT_MS,
    });
  } catch (err) {
    // Preserve the endpoint label callers rely on in error messages.
    throw new Error(
      `A2A error from ${where}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
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
