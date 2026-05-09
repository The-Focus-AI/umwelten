/**
 * Types for the web adapter — the HTTP channel peer to Discord/Telegram.
 *
 * Everything here is additive: the web adapter drives the same ChannelBridge
 * that Discord/Telegram use. This module only adds HTTP-specific concerns
 * (auth, SSE framing, route registration).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentHost } from '../../habitat/types.js';
import type { ChannelBridge } from '../bridge/channel-bridge.js';

// ── Auth ─────────────────────────────────────────────────────────────

/** Identified user for a request. */
export interface UserContext {
  /** Stable identifier used as interaction.userId (not PII). */
  userId: string;
  /** Display name, if available. */
  displayName?: string;
  /** Email, if available. */
  email?: string;
  /** How this user was authenticated. */
  provider?: 'dev' | 'google' | 'github' | 'oauth';
}

/** Strategy for resolving a UserContext from a request. */
export interface AuthProvider {
  /** Short id for logging / telemetry. */
  name: string;
  /**
   * Resolve a user from an incoming request.
   * Return null if the request is not authenticated; the caller decides
   * whether to reject with 401 or treat as anonymous.
   */
  authenticate(req: IncomingMessage): Promise<UserContext | null>;
  /**
   * Optional: handle an auth route path (e.g. /auth/login, /auth/callback).
   * Return true if the request was handled, false to continue normal routing.
   */
  handleAuthRoute?(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

// ── Route context ────────────────────────────────────────────────────

/**
 * Context passed to every route handler.
 * Handlers receive a fully-authenticated user plus shared dependencies.
 */
export interface RouteContext {
  habitat: AgentHost;
  bridge: ChannelBridge;
  user: UserContext;
  req: IncomingMessage;
  res: ServerResponse;
  /** Parsed URL path (without querystring). */
  path: string;
  /** Parsed querystring. */
  query: Record<string, string>;
}

/** A registered route handler. */
export interface RouteHandler {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  /** Path pattern — supports `:param` segments. */
  path: string;
  handle(ctx: RouteContext, params: Record<string, string>): Promise<void>;
  /** Skip auth for this route (e.g. /api/health). */
  skipAuth?: boolean;
}

// ── Server config ────────────────────────────────────────────────────

export interface WebServerConfig {
  habitat: AgentHost;
  /** Auth strategy. Pass 'dev' for the built-in single-user dev auth. */
  auth: AuthProvider | 'dev';
  /** Additional routes to mount (on top of the default route set). */
  routes?: RouteHandler[];
  /** Directory to serve static assets from (e.g. SPA build output). */
  staticRoot?: string;
  /** Port to listen on. Default 3000. */
  port?: number;
  /** Host to bind. Default 0.0.0.0. */
  host?: string;
  /** Platform instruction appended to the habitat stimulus for web messages. */
  platformInstruction?: string;
}

export interface StartedWebServer {
  port: number;
  close: () => Promise<void>;
}
