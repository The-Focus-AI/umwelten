import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './helpers.js';

export function handleProtectedResource(baseUrl: string, req: IncomingMessage, res: ServerResponse): void {
  json(res, {
    resource: baseUrl,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  });
}

export function handleAuthServerMetadata(baseUrl: string, req: IncomingMessage, res: ServerResponse): void {
  json(res, {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  });
}
