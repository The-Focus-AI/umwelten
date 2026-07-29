/**
 * Generic A2A (Agent-to-Agent) server scaffolding.
 *
 * Wraps `@a2a-js/sdk/server` plumbing into a single `createA2AServer` call
 * so any host (habitats, tests, future runtimes) can mount an A2A endpoint
 * by providing only an {@link AgentCard} and an {@link AgentExecutor}.
 *
 * Serves **both wire dialects** of the protocol: v1.0 JSON-RPC and the
 * v0.3 legacy wire (`message/send`, `tasks/get`, …) that every pre-1.0
 * peer — including our own fleet during the transition — still speaks.
 * Dispatch is per-request by method name, so one endpoint handles both.
 *
 * This module is intentionally generic: it knows nothing about habitats,
 * channels, or artifacts. Hosts adapt their internal abstractions to
 * `AgentExecutor` themselves.
 */

import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  DefaultExecutionEventBusManager,
  InMemoryPushNotificationStore,
  JsonRpcTransportHandler,
  ServerCallContext,
  UnauthenticatedUser,
  type AgentExecutor,
  type PushNotificationSender,
  type PushNotificationStore,
  type TaskStore,
  type User,
} from "@a2a-js/sdk/server";
import {
  LegacyJsonRpcTransportHandler,
  createLegacyAwarePushNotificationSender,
} from "@a2a-js/sdk/compat/v0_3/server";
import { isLegacyJsonRpcMethod } from "@a2a-js/sdk/compat/v0_3";
import { A2A_PROTOCOL_VERSION, type AgentCard } from "@a2a-js/sdk";

/** One JSON-RPC response envelope (either wire dialect), or an SSE stream of them. */
export type A2AJsonRpcResult =
  | Record<string, unknown>
  | AsyncGenerator<Record<string, unknown>, void, undefined>;

export interface BuildContextOptions {
  /** Authenticated caller; defaults to the SDK's unauthenticated user. */
  user?: User;
  /**
   * Value of the `A2A-Version` header, when the transport saw one.
   * Absent means the spec-mandated default of `0.3`.
   */
  requestedVersion?: string;
}

/** Build a per-request {@link ServerCallContext} for `transportHandler.handle`. */
export function buildServerCallContext(
  options: BuildContextOptions = {},
): ServerCallContext {
  return new ServerCallContext({
    user: options.user ?? new UnauthenticatedUser(),
    ...(options.requestedVersion
      ? { requestedVersion: options.requestedVersion }
      : {}),
  });
}

/**
 * Method-dispatching JSON-RPC handler: legacy method names (`message/send`,
 * `tasks/get`, …) go to the v0.3 compat handler, v1.0 method names to the
 * v1 handler. Both wrap the same request handler, store, and executor, so
 * a task minted on one dialect resolves on the other.
 */
export class DualJsonRpcTransportHandler {
  constructor(
    private readonly v1: JsonRpcTransportHandler,
    private readonly legacy: LegacyJsonRpcTransportHandler,
  ) {}

  async handle(
    requestBody: string | Record<string, unknown>,
    context: ServerCallContext = buildServerCallContext(),
  ): Promise<A2AJsonRpcResult> {
    let method: unknown;
    try {
      const parsed =
        typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody;
      method = (parsed as { method?: unknown })?.method;
    } catch {
      // Unparseable body: let the v1 handler produce the JSON-RPC parse error.
    }
    const handler = isLegacyJsonRpcMethod(method) ? this.legacy : this.v1;
    return (await handler.handle(requestBody, context)) as A2AJsonRpcResult;
  }
}

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
   * push-notification-config call before reaching the store.
   */
  pushNotificationStore?: PushNotificationStore;
  /**
   * Delivers status updates to registered webhooks. Defaults to the SDK's
   * legacy-aware sender over `pushNotificationStore` (0.3-registered
   * webhooks keep receiving 0.3-shaped bodies); override to change timeout,
   * token header, or delivery mechanism.
   */
  pushNotificationSender?: PushNotificationSender;
}

export interface A2AServer {
  /** The agent card used to construct the server (for serving at the well-known URL). */
  agentCard: AgentCard;
  /** Dual-dialect JSON-RPC handler. Mount on the `/a2a` POST route. */
  transportHandler: DualJsonRpcTransportHandler;
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
 * The returned `transportHandler.handle(body, context?)` returns either a
 * single JSON-RPC response object or an `AsyncGenerator` of SSE events,
 * depending on the requested method (`message/send` vs `message/stream`).
 */
export function createA2AServer(options: A2AServerOptions): A2AServer {
  const { agentCard, executor } = options;

  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const pushNotificationStore =
    options.pushNotificationStore ?? new InMemoryPushNotificationStore();
  const pushNotificationSender =
    options.pushNotificationSender ??
    createLegacyAwarePushNotificationSender(pushNotificationStore);
  const eventBusManager = new DefaultExecutionEventBusManager();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
    eventBusManager,
    pushNotificationStore,
    pushNotificationSender,
  );
  const transportHandler = new DualJsonRpcTransportHandler(
    new JsonRpcTransportHandler(requestHandler),
    new LegacyJsonRpcTransportHandler(requestHandler),
  );

  return { agentCard, transportHandler, pushNotificationSender };
}

/** The protocol version this server natively speaks (from the SDK). */
export const A2A_SERVER_PROTOCOL_VERSION = A2A_PROTOCOL_VERSION;

// Re-export the executor contract so hosts can implement it without
// reaching into `@a2a-js/sdk` directly.
export { AgentEvent, ServerCallContext, UnauthenticatedUser } from "@a2a-js/sdk/server";
export type {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  PushNotificationStore,
  PushNotificationSender,
  User,
} from "@a2a-js/sdk/server";
export type { AgentCard, AgentSkill } from "@a2a-js/sdk";
