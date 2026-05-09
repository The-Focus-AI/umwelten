/**
 * A2A (Agent-to-Agent) protocol handler.
 *
 * Implements the AgentExecutor interface from @a2a-js/sdk, wrapping
 * ChannelBridge to handle A2A messages with full LLM + tool access.
 *
 * Also provides helpers to build an AgentCard from habitat config/stimulus
 * and to create the JsonRpcTransportHandler for mounting on HTTP.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentCard,
  AgentSkill,
  Message as A2AMessage,
  Task as A2ATask,
  TextPart,
  FilePart,
  Artifact as A2AArtifact,
  TaskState,
} from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  DefaultExecutionEventBus,
  DefaultExecutionEventBusManager,
  JsonRpcTransportHandler,
  type AgentExecutor,
  type RequestContext,
  type ExecutionEventBus,
} from "@a2a-js/sdk/server";
import type { AgentHost } from "./types.js";
import type { ChannelBridge } from "../ui/bridge/channel-bridge.js";
import { listArtifacts, type ArtifactMeta } from "./tools/artifact-tools.js";

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

  // Build skills from the habitat's registered tools
  const tools = habitat.getTools();
  const toolNames = Object.keys(tools);

  // Group tools into a single "general" skill — the agent handles routing internally
  const skills: AgentSkill[] = [
    {
      id: "general",
      name: "General",
      description: description,
      tags: ["general", "assistant"],
      examples: [
        "What can you do?",
        "Help me with a task",
      ],
    },
  ];

  return {
    name,
    description,
    url: `${baseUrl}/a2a`,
    version: "1.0.0",
    protocolVersion: "0.2.5",
    capabilities: {
      streaming: true,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills,
  };
}

// ── Agent executor (bridges A2A → ChannelBridge) ──────────────────

export class HabitatAgentExecutor implements AgentExecutor {
  private bridge: ChannelBridge;
  private habitat: AgentHost;

  constructor(habitat: AgentHost, bridge: ChannelBridge) {
    this.habitat = habitat;
    this.bridge = bridge;
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
      // Emit completed with empty response
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

    // Use contextId as channel key for session continuity
    const channelKey = `a2a:${contextId}`;

    // Collect the full response text and artifacts via bridge events
    let fullText = "";

    await this.bridge.handleMessage(
      { channelKey, text, userId: `a2a:${contextId}` },
      {
        onText: (delta) => {
          // Emit working status with incremental text
          const statusEvent = {
            kind: "status-update" as const,
            taskId,
            contextId,
            final: false,
            status: {
              state: "working" as TaskState,
              timestamp: new Date().toISOString(),
              message: {
                kind: "message" as const,
                messageId: randomUUID(),
                role: "agent" as const,
                parts: [{ kind: "text" as const, text: delta }],
              },
            },
          };
          eventBus.publish(statusEvent);
        },
        onToolCall: (name, _input) => {
          // Optionally emit status updates for tool calls
        },
        onToolResult: (_name, _output, _isError) => {
          // Optionally emit status updates for tool results
        },
        onDone: async (result) => {
          fullText = result.content;

          // Check for published artifacts
          const artifacts = await this.buildA2AArtifacts();

          // Emit the final response message
          const responseParts: (TextPart | FilePart)[] = [
            { kind: "text", text: fullText },
          ];

          const responseMessage: A2AMessage = {
            kind: "message",
            messageId: randomUUID(),
            role: "agent",
            parts: responseParts,
            contextId,
            taskId,
          };
          eventBus.publish(responseMessage);

          // Emit artifact events if any
          for (const artifact of artifacts) {
            const artifactEvent = {
              kind: "artifact-update" as const,
              taskId,
              contextId,
              artifact,
            };
            eventBus.publish(artifactEvent);
          }

          eventBus.finished();
        },
        onError: (error) => {
          // Emit error as a message then finish
          const errorMessage: A2AMessage = {
            kind: "message",
            messageId: randomUUID(),
            role: "agent",
            parts: [{ kind: "text", text: `Error: ${error}` }],
            contextId,
            taskId,
          };
          eventBus.publish(errorMessage);
          eventBus.finished();
        },
      },
    );
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    // Basic cancellation — just mark as canceled
    const statusEvent = {
      kind: "status-update" as const,
      taskId,
      contextId: "",
      final: true,
      status: {
        state: "canceled" as TaskState,
        timestamp: new Date().toISOString(),
      },
    };
    eventBus.publish(statusEvent);
    eventBus.finished();
  }

  /** Convert published habitat artifacts to A2A Artifact format. */
  private async buildA2AArtifacts(): Promise<A2AArtifact[]> {
    const metas = await listArtifacts(this.habitat.getWorkDir());
    return metas.map((meta, index) => this.metaToA2AArtifact(meta, index));
  }

  private metaToA2AArtifact(meta: ArtifactMeta, index: number): A2AArtifact {
    const parts: (TextPart | FilePart)[] = [];

    // Add file reference
    parts.push({
      kind: "file",
      file: {
        uri: meta.url,
        mimeType: meta.mimeType,
        name: meta.name,
      },
    });

    // Add description as text if present
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

// ── Transport setup ───────────────────────────────────────────────

export interface A2AHandlerOptions {
  habitat: AgentHost;
  bridge: ChannelBridge;
  baseUrl: string;
  name?: string;
  description?: string;
}

export interface A2AHandler {
  agentCard: AgentCard;
  transportHandler: JsonRpcTransportHandler;
}

export async function createA2AHandler(
  options: A2AHandlerOptions,
): Promise<A2AHandler> {
  const { habitat, bridge, baseUrl } = options;

  const agentCard = await buildAgentCard({
    baseUrl,
    habitat,
    name: options.name,
    description: options.description,
  });

  const taskStore = new InMemoryTaskStore();
  const executor = new HabitatAgentExecutor(habitat, bridge);
  const eventBusManager = new DefaultExecutionEventBusManager();

  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
    eventBusManager,
  );

  const transportHandler = new JsonRpcTransportHandler(requestHandler);

  return { agentCard, transportHandler };
}
