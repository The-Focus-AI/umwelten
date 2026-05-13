/**
 * Generic A2A (Agent-to-Agent) server scaffolding.
 *
 * Wraps `@a2a-js/sdk/server` plumbing into a single `createA2AServer` call
 * so any host (habitats, tests, future runtimes) can mount an A2A endpoint
 * by providing only an {@link AgentCard} and an {@link AgentExecutor}.
 *
 * This module is intentionally generic: it knows nothing about habitats,
 * channels, or artifacts. Hosts adapt their internal abstractions to
 * `AgentExecutor` themselves.
 */

import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  DefaultExecutionEventBusManager,
  JsonRpcTransportHandler,
  type AgentExecutor,
} from "@a2a-js/sdk/server";
import type { AgentCard } from "@a2a-js/sdk";

export interface A2AServerOptions {
  /** Card returned at `/.well-known/agent-card.json`. */
  agentCard: AgentCard;
  /** Executor that runs the agent for each incoming request. */
  executor: AgentExecutor;
}

export interface A2AServer {
  /** The agent card used to construct the server (for serving at the well-known URL). */
  agentCard: AgentCard;
  /** JSON-RPC transport handler. Mount on the `/a2a` POST route. */
  transportHandler: JsonRpcTransportHandler;
}

/**
 * Build an A2A server from an agent card + executor.
 *
 * The returned `transportHandler.handle(parsedJsonRpcBody)` returns either a
 * single JSON-RPC response object or an `AsyncGenerator` of SSE events,
 * depending on the requested method (`message/send` vs `message/stream`).
 */
export function createA2AServer(options: A2AServerOptions): A2AServer {
  const { agentCard, executor } = options;

  const taskStore = new InMemoryTaskStore();
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

// Re-export the executor contract so hosts can implement it without
// reaching into `@a2a-js/sdk` directly.
export type {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "@a2a-js/sdk/server";
export type { AgentCard, AgentSkill } from "@a2a-js/sdk";
