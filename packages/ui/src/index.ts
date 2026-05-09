/**
 * @umwelten/ui — UI adapters: Telegram, Discord, TUI, CLI interface.
 */

// ── Re-export core types for convenience ────────────────────────────────
export type { ModelDetails, ModelOptions, ModelResponse } from "@umwelten/core";
export { Interaction } from "@umwelten/core";

// ── CLI interface ───────────────────────────────────────────────────────
export { CLIInterface } from "./cli/CLIInterface.js";
export { CommandRegistry } from "./cli/CommandRegistry.js";
export {
  getChatCommands,
  getAgentCommands,
  getEvaluationCommands,
  getDefaultCommands,
  statsCommand,
  infoCommand,
  toggleStatsCommand,
} from "./cli/DefaultCommands.js";

// ── Re-export web/bridge from @umwelten/habitat ─────────────────────────
export {
  startWebServer,
  WebAdapter,
  UiMessageStream,
  devAuth,
  defaultRoutes,
  ChannelBridge,
  loadRouting,
  saveRouting,
  resolveChannelRoute,
  routeSignature,
  setChannelRoute,
} from "@umwelten/habitat";
export type {
  AuthProvider,
  UserContext,
  RouteHandler,
  RouteContext,
  WebServerConfig,
  StartedWebServer,
  ChannelMessage,
  ChannelAttachment,
  BridgeEventHandlers,
  BridgeResult,
  ChannelBridgeOptions,
  ChannelBinding,
  ChannelRuntimeMode,
  RoutingConfig,
  RouteResolution,
} from "@umwelten/habitat";
