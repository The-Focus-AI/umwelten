/**
 * ChannelBridge — unified adapter layer for all chat platforms.
 */

export { ChannelBridge } from './channel-bridge.js';

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
} from './types.js';

export {
  loadRouting,
  saveRouting,
  resolveChannelRoute,
  routeSignature,
  setChannelRoute,
  coerceChannelBinding,
  peekExactChannelBinding,
  setChannelInfoMessageId,
} from './routing.js';

export { processBridgeCommand, getBridgeCommandDefs } from './commands.js';
export type { CommandResult } from './commands.js';

// Re-export for convenience — adapters can import from bridge/
export type { ClaudeSDKResult } from '../../habitat/claude-sdk-runner.js';
