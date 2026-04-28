// Interaction classes
export { Interaction } from '../interaction/core/interaction.js';

// Interface classes
export { CLIInterface } from './cli/CLIInterface.js';
export { CommandRegistry } from './cli/CommandRegistry.js';
export { 
  getChatCommands, 
  getAgentCommands, 
  getEvaluationCommands, 
  getDefaultCommands,
  statsCommand,
  infoCommand,
  toggleStatsCommand
} from './cli/DefaultCommands.js';
// Web server / adapter — the HTTP channel, peer to Discord/Telegram.
export {
  startWebServer,
  WebAdapter,
  UiMessageStream,
  devAuth,
  defaultRoutes,
} from './web/index.js';
export type {
  AuthProvider,
  UserContext,
  RouteHandler,
  RouteContext,
  WebServerConfig,
  StartedWebServer,
} from './web/index.js';

// ChannelBridge — unified adapter layer
export { ChannelBridge } from './bridge/channel-bridge.js';
export type {
  ChannelMessage,
  ChannelAttachment,
  BridgeEventHandlers,
  BridgeResult,
  ChannelBridgeOptions,
  ChannelBinding,
  ChannelRuntimeMode,
  RoutingConfig,
  RouteResolution,
} from './bridge/types.js';
export {
  loadRouting,
  saveRouting,
  resolveChannelRoute,
  routeSignature,
  setChannelRoute,
} from './bridge/routing.js';

// Re-export types
export type { ModelDetails, ModelOptions, ModelResponse } from '../cognition/types.js';
