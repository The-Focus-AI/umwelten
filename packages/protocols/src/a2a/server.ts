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
  LegacyA2AError,
  LegacyJsonRpcTransportHandler,
  createLegacyAwarePushNotificationSender,
} from "@a2a-js/sdk/compat/v0_3/server";
import { isLegacyJsonRpcMethod } from "@a2a-js/sdk/compat/v0_3";
import {
  A2A_PROTOCOL_VERSION,
  type AgentCard,
  type StreamResponse,
} from "@a2a-js/sdk";
import type { A2ARequestHandler } from "@a2a-js/sdk/server";

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
 * A2A-spec JSON-RPC error codes by SDK error class name. The SDK's server
 * and compat bundles each define their own copy of the error hierarchy, so
 * the compat mapper's `instanceof` check fails on errors thrown by the v1
 * request handler and every semantic error degrades to -32603 (internal).
 * Bridging by class *name* restores the spec codes on the legacy wire.
 * (Upstream SDK 1.0.1 bundling bug — remove when fixed.)
 */
const LEGACY_ERROR_CODES: Record<string, number> = {
  TaskNotFoundError: -32001,
  TaskNotCancelableError: -32002,
  PushNotificationNotSupportedError: -32003,
  UnsupportedOperationError: -32004,
  ContentTypeNotSupportedError: -32005,
  InvalidAgentResponseError: -32006,
};

function toLegacyError(err: unknown): unknown {
  const name = (err as { name?: string } | null)?.name;
  const code = name ? LEGACY_ERROR_CODES[name] : undefined;
  if (code === undefined) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new LegacyA2AError(code, message);
}

/**
 * Wrap a request handler so errors thrown by the v1 server bundle are
 * re-thrown as compat-bundle error instances the legacy mapper recognizes.
 */
function withLegacyErrorBridge(handler: A2ARequestHandler): A2ARequestHandler {
  const wrap = (fn: (...args: never[]) => unknown) =>
    function (this: unknown, ...args: never[]) {
      let result: unknown;
      try {
        result = fn.apply(handler, args);
      } catch (err) {
        throw toLegacyError(err);
      }
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return (result as Promise<unknown>).catch((err) => {
          throw toLegacyError(err);
        });
      }
      if (result && typeof (result as AsyncGenerator<unknown>)[Symbol.asyncIterator] === "function") {
        const inner = result as AsyncGenerator<unknown>;
        return (async function* bridged() {
          try {
            yield* inner;
          } catch (err) {
            throw toLegacyError(err);
          }
        })();
      }
      return result;
    };

  return new Proxy(handler, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? wrap(value as (...args: never[]) => unknown)
        : value;
    },
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
/**
 * Wrap a sender so status-update dispatches deliver the **full Task**
 * (loaded from the store) rather than the bare event. The 0.3-era sender
 * always POSTed the Task snapshot — the fleet's wake contract (ADR 0007)
 * and every registered webhook read `task.id` / `task.status.state` from
 * the body — and a task-cased payload is equally legal on the v1 wire.
 */
function taskResolvingSender(
  inner: PushNotificationSender,
  store: TaskStore,
): PushNotificationSender {
  return {
    async send(streamResponse: StreamResponse, context) {
      if (streamResponse.payload?.$case === "statusUpdate") {
        const { taskId } = streamResponse.payload.value;
        const task = await store.load(taskId, context).catch(() => undefined);
        if (task) {
          return inner.send({ payload: { $case: "task", value: task } }, context);
        }
      }
      return inner.send(streamResponse, context);
    },
  };
}

export function createA2AServer(options: A2AServerOptions): A2AServer {
  const { agentCard, executor } = options;

  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const pushNotificationStore =
    options.pushNotificationStore ?? new InMemoryPushNotificationStore();
  const pushNotificationSender =
    options.pushNotificationSender ??
    taskResolvingSender(
      createLegacyAwarePushNotificationSender(pushNotificationStore),
      taskStore,
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
  const transportHandler = new DualJsonRpcTransportHandler(
    new JsonRpcTransportHandler(requestHandler),
    new LegacyJsonRpcTransportHandler(withLegacyErrorBridge(requestHandler)),
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
