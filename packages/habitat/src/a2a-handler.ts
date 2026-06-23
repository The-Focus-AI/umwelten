/**
 * Habitat ↔ A2A adapter.
 *
 * Bridges habitat-specific abstractions (`AgentHost`, `ChannelBridge`,
 * published artifacts) to the generic A2A scaffolding in `@umwelten/protocols`.
 *
 * - {@link buildAgentCard} converts a habitat's config + stimulus into an
 *   A2A AgentCard.
 * - {@link HabitatAgentExecutor} implements `AgentExecutor` by delegating
 *   each incoming message to a {@link ChannelBridge}.
 * - {@link createA2AHandler} wires both pieces into an
 *   {@link A2AServer} ready to mount on the container HTTP server.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentCard,
  AgentSkill,
  Message as A2AMessage,
  Task as A2ATask,
  TextPart,
  FilePart,
  DataPart,
  Artifact as A2AArtifact,
  TaskState,
} from "@a2a-js/sdk";
import {
  createA2AServer,
  type A2AServer,
  type AgentExecutor,
  type RequestContext,
  type ExecutionEventBus,
} from "@umwelten/protocols";
import type { AgentHost } from "./types.js";
import type { ChannelBridge } from "./bridge/channel-bridge.js";
import {
  listArtifacts,
  toAbsoluteArtifactUrl,
  type ArtifactMeta,
} from "./tools/artifact-tools.js";
import {
  drainUIResources,
  uiResourceToA2APart,
  UI_OUTPUT_MODE,
} from "./ui-resources.js";
import { getSpeaker } from "./identity/agent-speaker-context.js";

// ── Agent card builder ────────────────────────────────────────────

export interface AgentCardOptions {
  /** Base URL where the agent is hosted (e.g. "http://localhost:8080"). */
  baseUrl: string;
  /** Habitat instance for config + stimulus. */
  habitat: AgentHost;
  /** Override name (defaults to config.name). */
  name?: string;
  /** Override description. */
  description?: string;
  /**
   * When true, the card declares HTTP bearer auth (securitySchemes +
   * security) so clients discover the requirement instead of failing
   * on 401. Set iff the host enforces an API key on /a2a.
   */
  requiresApiKey?: boolean;
  /**
   * When true, the bearer the habitat accepts is a per-user JWT (jwt /
   * jwt+bearer mode, ADR 0003). Advertised as `bearerFormat: "JWT"` so the
   * habitats SaaS knows to mint a per-user grant (aud = this habitat) instead
   * of sending a static shared bearer.
   */
  jwtMode?: boolean;
}

export async function buildAgentCard(
  options: AgentCardOptions,
): Promise<AgentCard> {
  const { baseUrl, habitat } = options;
  const config = habitat.getConfig();
  const stimulus = await habitat.getStimulus();
  const stimulusOptions = stimulus.options;

  const name = options.name ?? config.name ?? "Habitat Agent";
  const description =
    options.description ??
    stimulusOptions.role ??
    `An AI agent powered by ${config.defaultProvider ?? "unknown"}/${config.defaultModel ?? "unknown"}`;

  // Group tools into a single "general" skill — the agent handles routing internally
  const skills: AgentSkill[] = [
    {
      id: "general",
      name: "General",
      description,
      tags: ["general", "assistant"],
      examples: ["What can you do?", "Help me with a task"],
    },
  ];

  return {
    name,
    description,
    url: `${baseUrl}/a2a`,
    version: "1.0.0",
    protocolVersion: "0.2.5",
    capabilities: { streaming: true },
    defaultInputModes: ["text/plain"],
    // text/html+mcp advertises that tools may emit mcp-ui UI resources
    // (carried as DataParts) for a client AppRenderer (ADR 0005, #195).
    defaultOutputModes: ["text/plain", UI_OUTPUT_MODE],
    skills,
    ...(options.requiresApiKey
      ? {
          securitySchemes: {
            bearer: {
              type: "http" as const,
              scheme: "bearer",
              ...(options.jwtMode ? { bearerFormat: "JWT" as const } : {}),
              description: options.jwtMode
                ? "Per-user JWT (ADR 0003): Authorization: Bearer <JWT>, minted by the habitats SaaS and verified via its JWKS. The shared HABITAT_API_KEY is also accepted during the transition."
                : "API key as a bearer token (Authorization: Bearer <HABITAT_API_KEY>).",
            },
          },
          security: [{ bearer: [] }],
        }
      : {}),
  };
}

// ── Agent executor (bridges A2A → ChannelBridge) ──────────────────

interface ActiveTask {
  controller: AbortController;
  contextId: string;
}

export class HabitatAgentExecutor implements AgentExecutor {
  private bridge: ChannelBridge;
  private habitat: AgentHost;
  /**
   * Active runs by taskId — the minimal in-memory store that lets
   * tasks/cancel abort an in-flight Interaction. Entries are removed
   * when the run settles (done, error, or canceled).
   */
  private activeTasks = new Map<string, ActiveTask>();

  /**
   * Resolve the agent's public origin at emit time (#194). The artifact build
   * runs mid-stream with no inbound request in hand, so the container server
   * threads a resolver that reads the most recent request's public origin
   * (X-Forwarded-* / BASE_URL / Host, via getPublicBaseUrl). Undefined → emit
   * the stored relative URL unchanged (back-compat / local dev).
   */
  private resolvePublicOrigin?: () => string | undefined;

  constructor(
    habitat: AgentHost,
    bridge: ChannelBridge,
    resolvePublicOrigin?: () => string | undefined,
  ) {
    this.habitat = habitat;
    this.bridge = bridge;
    this.resolvePublicOrigin = resolvePublicOrigin;
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { userMessage, taskId, contextId } = requestContext;

    // Extract text from user message parts
    const text = userMessage.parts
      .filter((p): p is TextPart => p.kind === "text")
      .map((p) => p.text)
      .join("\n");

    if (!text.trim()) {
      const responseMessage: A2AMessage = {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        parts: [{ kind: "text", text: "No text content received." }],
      };
      eventBus.publish(responseMessage);
      eventBus.finished();
      return;
    }

    // Publish the initial Task so the request handler's task store tracks
    // this run — without a Task record, tasks/cancel returns taskNotFound
    // and the working status-updates below are dropped as "unknown task".
    if (!requestContext.task) {
      eventBus.publish({
        kind: "task",
        id: taskId,
        contextId,
        status: {
          state: "submitted" as TaskState,
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
      } satisfies A2ATask);
    }

    // contextId = the thread (session continuity); the verified speaker =
    // who is talking *this* turn (ADR 0003 step 2). One thread, many speakers.
    const channelKey = `a2a:${contextId}`;
    const speaker = getSpeaker();
    // Fall back to the thread id as identity only when unauthenticated
    // (dev/open or legacy bearer) — there is no per-user `sub` to use.
    const userId = speaker?.userId ?? `a2a:${contextId}`;

    let fullText = "";

    const controller = new AbortController();
    this.activeTasks.set(taskId, { controller, contextId });

    try {
      await this.bridge.handleMessage(
        { channelKey, text, userId, displayName: speaker?.displayName },
        {
          onText: (delta) => {
            // Emit working status with incremental text
            eventBus.publish({
              kind: "status-update",
              taskId,
              contextId,
              final: false,
              status: {
                state: "working" as TaskState,
                timestamp: new Date().toISOString(),
                message: {
                  kind: "message",
                  messageId: randomUUID(),
                  role: "agent",
                  parts: [{ kind: "text", text: delta }],
                },
              },
            });
          },
          onToolCall: (_name, _input) => {
            // Optionally emit status updates for tool calls
          },
          onToolResult: (_name, _output, _isError) => {
            // Optionally emit status updates for tool results
          },
          onDone: async (result) => {
            fullText = result.content;

            // Check for published artifacts
            const artifacts = await this.buildA2AArtifacts();

            // Drain any UI resources this turn emitted (ADR 0005 slice B, #195)
            // and carry them as DataParts in the response message.
            const uiParts = await this.buildA2AUIResourceParts();

            const responseParts: (TextPart | FilePart | DataPart)[] = [
              { kind: "text", text: fullText },
              ...uiParts,
            ];

            // Per-run usage so downstream consumers can record cost
            // without a side channel (issue #117).
            const usageMetadata = result.metadata
              ? {
                  usage: {
                    promptTokens: result.metadata.tokenUsage.promptTokens,
                    completionTokens: result.metadata.tokenUsage.completionTokens,
                    totalTokens: result.metadata.tokenUsage.total,
                  },
                  provider: result.metadata.provider,
                  model: result.metadata.model,
                }
              : undefined;

            eventBus.publish({
              kind: "message",
              messageId: randomUUID(),
              role: "agent",
              parts: responseParts,
              contextId,
              taskId,
              ...(usageMetadata ? { metadata: usageMetadata } : {}),
            } satisfies A2AMessage);

            for (const artifact of artifacts) {
              eventBus.publish({
                kind: "artifact-update",
                taskId,
                contextId,
                artifact,
              });
            }

            eventBus.finished();
          },
          onError: (error) => {
            // A canceled run surfaces as an abort error — cancelTask already
            // emitted the canceled status, so don't follow it with an error.
            if (controller.signal.aborted) return;
            eventBus.publish({
              kind: "message",
              messageId: randomUUID(),
              role: "agent",
              parts: [{ kind: "text", text: `Error: ${error}` }],
              contextId,
              taskId,
            } satisfies A2AMessage);
            eventBus.finished();
          },
        },
        controller.signal,
      );
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const active = this.activeTasks.get(taskId);
    if (active) {
      active.controller.abort();
      this.activeTasks.delete(taskId);
    }
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId: active?.contextId ?? "",
      final: true,
      status: {
        state: "canceled" as TaskState,
        timestamp: new Date().toISOString(),
      },
    });
    eventBus.finished();
  }

  /** Convert published habitat artifacts to A2A Artifact format. */
  /** Drain this turn's emitted UI resources and normalize them to A2A parts. */
  private async buildA2AUIResourceParts(): Promise<DataPart[]> {
    const resources = await drainUIResources(this.habitat.getWorkDir());
    return resources.map(uiResourceToA2APart);
  }

  private async buildA2AArtifacts(): Promise<A2AArtifact[]> {
    const metas = await listArtifacts(this.habitat.getWorkDir());
    return metas.map((meta, index) => this.metaToA2AArtifact(meta, index));
  }

  private metaToA2AArtifact(meta: ArtifactMeta, index: number): A2AArtifact {
    // Absolutize the stored relative URL against the resolved public origin so
    // the FilePart.uri resolves for off-origin consumers (SaaS, Gaia) — #194.
    const uri = toAbsoluteArtifactUrl(meta.url, this.resolvePublicOrigin?.());
    const parts: (TextPart | FilePart)[] = [
      {
        kind: "file",
        file: {
          uri,
          mimeType: meta.mimeType,
          name: meta.name,
        },
      },
    ];

    if (meta.description) {
      parts.push({ kind: "text", text: meta.description });
    }

    return {
      artifactId: `artifact-${index}`,
      name: meta.name,
      description: meta.description,
      parts,
    };
  }
}

// ── Handler factory ───────────────────────────────────────────────

export interface A2AHandlerOptions {
  habitat: AgentHost;
  bridge: ChannelBridge;
  baseUrl: string;
  name?: string;
  description?: string;
  /** Declare bearer auth in the agent card (set iff /a2a enforces an API key). */
  requiresApiKey?: boolean;
  /** Advertise per-user JWT capability (bearerFormat: JWT) — jwt/jwt+bearer mode. */
  jwtMode?: boolean;
  /**
   * Resolve the agent's public origin at artifact-emit time (#194). The
   * container server passes a getter over the most recent request's resolved
   * origin so emitted FilePart URIs are absolute. Omit → relative URLs.
   */
  resolvePublicOrigin?: () => string | undefined;
}

/**
 * Returned shape kept stable for `container-server.ts` and any external
 * consumers: an agent card for the well-known endpoint plus the JSON-RPC
 * transport handler for `/a2a` POST.
 */
export type A2AHandler = A2AServer;

export async function createA2AHandler(
  options: A2AHandlerOptions,
): Promise<A2AHandler> {
  const agentCard = await buildAgentCard({
    baseUrl: options.baseUrl,
    habitat: options.habitat,
    name: options.name,
    description: options.description,
    requiresApiKey: options.requiresApiKey,
    jwtMode: options.jwtMode,
  });

  const executor = new HabitatAgentExecutor(
    options.habitat,
    options.bridge,
    options.resolvePublicOrigin,
  );

  return createA2AServer({ agentCard, executor });
}
