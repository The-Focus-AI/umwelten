/**
 * @umwelten/protocols/a2a — A2A protocol primitives.
 *
 * Pure protocol layer: a generic JSON-RPC client for talking to A2A agents,
 * and a thin server scaffold that turns an `AgentExecutor` + `AgentCard`
 * into a transport handler ready to mount on HTTP.
 */

export {
  fetchAgentCard,
  sendA2AMessage,
  sendA2AMessageToUrl,
} from "./client.js";
export type {
  A2AEndpoint,
  AgentCardSummary,
  A2AMessageResponse,
  SendA2AMessageToUrlOptions,
} from "./client.js";

export { createA2AServer } from "./server.js";
export {
  FileTaskStore,
  TERMINAL_TASK_STATES,
  INTERRUPTED_TASK_STATES,
  isTerminalTaskState,
  isInterruptedTaskState,
  isAbandonableTaskState,
} from "./file-task-store.js";
export type { FileTaskStoreOptions } from "./file-task-store.js";
export { FilePushNotificationStore } from "./file-push-store.js";
export type { FilePushNotificationStoreOptions } from "./file-push-store.js";
export {
  sweepAbandonedTasks,
  notifySweptTasks,
  ABANDONED_TASK_MARKER,
  DEFAULT_ABANDONED_REASON,
} from "./task-recovery.js";
export type { SweepOptions, SweepResult } from "./task-recovery.js";
export {
  resolveA2AEndpointUrl,
  createA2ATransport,
  sendA2ATask,
  getA2ATask,
  cancelA2ATask,
  pollA2ATask,
  sendAndAwaitA2ATask,
  isA2ATask,
  isSettledTaskState,
  A2APollTimeoutError,
  registerA2APush,
  listA2APushConfigs,
  deleteA2APushConfig,
} from "./task-client.js";
export type {
  RegisterA2APushOptions,
  A2ATaskTarget,
  SendA2ATaskOptions,
  GetA2ATaskOptions,
  PollA2ATaskOptions,
  SendAndAwaitOptions,
} from "./task-client.js";
export type {
  A2AServer,
  A2AServerOptions,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  AgentCard,
  AgentSkill,
  PushNotificationStore,
  PushNotificationSender,
} from "./server.js";

// Habitat HTTP/SSE chat client
export {
  a2aChat,
  fetchJson,
  truncateJson,
  discoverToken,
} from "./chat.js";
export type { A2AChatOptions } from "./chat.js";
