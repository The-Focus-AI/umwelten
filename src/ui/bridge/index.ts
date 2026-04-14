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
} from './routing.js';
