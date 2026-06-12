/**
 * Path-prefix mount for mcp-serve.
 *
 * createMcpServer() owns a whole http server with routes at the root
 * (/mcp, /oauth/*, /.well-known/*). A mount is the embeddable form: the
 * same handlers, dispatched relative to a base path that a host server
 * (e.g. the habitat container server's /agents/<id>) controls.
 *
 * Every URL the OAuth surface emits derives from the baseUrl passed to
 * handle(), so a mount served at https://host/agents/foo advertises
 * authorization_endpoint https://host/agents/foo/oauth/authorize, returns
 * WWW-Authenticate resource_metadata under that prefix, and so on.
 *
 * Discovery caveat (verified against @modelcontextprotocol/sdk 1.29.0):
 * for an issuer with a path component, clients build the RFC 8414
 * path-inserted form /.well-known/oauth-authorization-server/<prefix> at
 * the ORIGIN — they never try <prefix>/.well-known/... for AS metadata.
 * The host must therefore also route those root-level path-inserted URLs
 * into this mount (see isMcpServeMountPath consumers).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServeConfig } from './types.js';
import { handleMcpRequest, type McpHandlerConfig } from './mcp-handler.js';
import { handleProtectedResource, handleAuthServerMetadata } from './oauth/metadata.js';
import { handleRegister } from './oauth/register.js';
import { handleAuthorize, handleUpstreamCallback } from './oauth/authorize.js';
import { handleToken } from './oauth/token.js';

/** Everything createMcpServer takes except the http-server concerns. */
export type McpServeMountConfig = Omit<McpServeConfig, 'port' | 'staticRoot'>;

export interface McpServeMount {
  /**
   * Handle a request whose path falls under the mount.
   *
   * @param subPath - path relative to the mount root, no leading slash
   *                  (e.g. "mcp", "oauth/token", ".well-known/oauth-protected-resource")
   * @param baseUrl - public URL of the mount root (origin + prefix, no trailing slash)
   * @returns true if the request was handled (response sent)
   */
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    subPath: string,
    baseUrl: string,
  ): Promise<boolean>;
}

/**
 * Subpaths reserved by a mount. Hosts use this to decide which requests
 * under a prefix belong to the MCP/OAuth surface (vs. e.g. static files).
 */
export function isMcpServeMountPath(subPath: string): boolean {
  const p = subPath.replace(/^\//, '');
  return (
    p === 'mcp' ||
    p.startsWith('oauth/') ||
    p === '.well-known/oauth-protected-resource' ||
    p === '.well-known/oauth-authorization-server'
  );
}

export function createMcpServeMount(config: McpServeMountConfig): McpServeMount {
  const { name, version = '0.1.0', upstream, registerTools, store } = config;

  const mcpHandlerConfig: McpHandlerConfig = {
    serverName: name,
    serverVersion: version,
    upstream,
    store,
    registerTools,
  };

  return {
    async handle(req, res, subPath, baseUrl) {
      const path = subPath.replace(/^\//, '');
      const base = baseUrl.replace(/\/$/, '');

      if (path === '.well-known/oauth-protected-resource') {
        handleProtectedResource(base, req, res);
        return true;
      }
      if (path === '.well-known/oauth-authorization-server') {
        handleAuthServerMetadata(base, req, res);
        return true;
      }
      if (path === 'oauth/register' && req.method === 'POST') {
        await handleRegister(store, req, res);
        return true;
      }
      if (path === 'oauth/authorize' && req.method === 'GET') {
        await handleAuthorize(upstream, store, base, req, res);
        return true;
      }
      if (path === 'oauth/upstream-callback' && req.method === 'GET') {
        await handleUpstreamCallback(upstream, store, base, req, res);
        return true;
      }
      if (path === 'oauth/token' && req.method === 'POST') {
        await handleToken(store, req, res);
        return true;
      }
      if (path === 'mcp') {
        await handleMcpRequest(mcpHandlerConfig, req, res, base);
        return true;
      }

      return false;
    },
  };
}
