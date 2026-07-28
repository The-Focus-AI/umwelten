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
  DefaultPushNotificationSender,
  InMemoryPushNotificationStore,
  JsonRpcTransportHandler,
  type AgentExecutor,
  type PushNotificationSender,
  type PushNotificationStore,
  type TaskStore,
} from "@a2a-js/sdk/server";
import type { AgentCard } from "@a2a-js/sdk";

export interface A2AServerOptions {
  /** Card returned at `/.well-known/agent-card.json`. */
  agentCard: AgentCard;
  /** Executor that runs the agent for each incoming request. */
  executor: AgentExecutor;
  /**
   * Where Tasks are kept. Defaults to the SDK's in-memory store, which loses
   * every Task when the process exits — fine for tests and one-shot servers,
   * wrong for any habitat that can be stopped while idle. Long-lived hosts
   * should pass a `FileTaskStore` on the habitat's volume (ADR 0007).
   */
  taskStore?: TaskStore;
  /**
   * Where webhook registrations are kept. Defaults to the SDK's in-memory
   * store — which is worse than no registration for anything that restarts: a
   * caller that registered and went away waits forever for a webhook nobody
   * will call. Pass a `FilePushNotificationStore` on the volume.
   *
   * Only consulted when the agent card declares
   * `capabilities.pushNotifications`; without it the SDK refuses every
   * `tasks/pushNotificationConfig/*` call before reaching the store.
   */
  pushNotificationStore?: PushNotificationStore;
  /**
   * Delivers status updates to registered webhooks. Defaults to the SDK's
   * sender over `pushNotificationStore`; override to change timeout or token
   * header, or to deliver by some means other than an HTTP POST.
   */
  pushNotificationSender?: PushNotificationSender;
}

export interface A2AServer {
  /** The agent card used to construct the server (for serving at the well-known URL). */
  agentCard: AgentCard;
  /** JSON-RPC transport handler. Mount on the `/a2a` POST route. */
  transportHandler: JsonRpcTransportHandler;
  /**
   * The sender the request handler notifies through. Exposed so a host can
   * dispatch for a transition the handler never saw — the boot recovery sweep
   * moves Tasks by writing to the store directly, and those are precisely the
   * ones a caller is waiting to hear about.
   */
  pushNotificationSender: PushNotificationSender;
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

  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const pushNotificationStore = options.pushNotificationStore;
  const pushNotificationSender =
    options.pushNotificationSender ??
    new DefaultPushNotificationSender(
      pushNotificationStore ?? new InMemoryPushNotificationStore(),
    );
  const eventBusManager = new DefaultExecutionEventBusManager();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
    eventBusManager,
    pushNotificationStore,
    pushNotificationSender,
  );
  const transportHandler = new JsonRpcTransportHandler(requestHandler);

  return { agentCard, transportHandler, pushNotificationSender };
}

// Re-export the executor contract so hosts can implement it without
// reaching into `@a2a-js/sdk` directly.
export type {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  PushNotificationStore,
  PushNotificationSender,
} from "@a2a-js/sdk/server";
export type { AgentCard, AgentSkill } from "@a2a-js/sdk";
