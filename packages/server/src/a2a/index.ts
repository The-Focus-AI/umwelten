/**
 * @umwelten/server/a2a — A2A protocol primitives.
 *
 * Pure protocol layer: a generic JSON-RPC client for talking to A2A agents,
 * and a thin server scaffold that turns an `AgentExecutor` + `AgentCard`
 * into a transport handler ready to mount on HTTP.
 */

export {
  fetchAgentCard,
  sendA2AMessage,
} from "./client.js";
export type {
  A2AEndpoint,
  AgentCardSummary,
  A2AMessageResponse,
} from "./client.js";

export { createA2AServer } from "./server.js";
export type {
  A2AServer,
  A2AServerOptions,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  AgentCard,
  AgentSkill,
} from "./server.js";
