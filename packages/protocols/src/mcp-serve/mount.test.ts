/**
 * createMcpServeMount — prefix-relative dispatch of the mcp-serve surface.
 *
 * Proves that a mount served under a base URL like http://host/agents/x
 * emits every OAuth/MCP URL under that prefix, and that non-mount paths
 * fall through (return false) so the host can serve static files.
 */

import { describe, it, expect, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { memorySkillFiles, SkillsExtension } from '@modelcontextprotocol/server/ext/skills';
import { z } from 'zod';
import { RemoteMcpClient } from '../mcp/client/remote.js';
import { McpSkillHost } from '../mcp/skills/host.js';
import { hashToken } from './oauth/token.js';
import { createMcpServeMount, isMcpServeMountPath } from './mount.js';
import { MemoryStore } from './memory-store.js';
import type { UpstreamOAuthProvider } from './types.js';

const BASE = 'http://localhost:7430/agents/demo';

function fakeReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    method,
    url,
    headers: { host: 'localhost:7430', ...headers },
  } as unknown as IncomingMessage;
}

function fakeRes() {
  let statusCode = 0;
  const headers: Record<string, string> = {};
  let body = '';
  let headersSent = false;
  const res = {
    get headersSent() {
      return headersSent;
    },
    writeHead(code: number, h?: Record<string, string | number>) {
      statusCode = code;
      if (h) for (const [k, v] of Object.entries(h)) headers[k] = String(v);
      headersSent = true;
      return res;
    },
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    end(chunk?: string | Buffer) {
      if (chunk) body += chunk.toString();
    },
  };
  return {
    res: res as unknown as ServerResponse,
    status: () => statusCode,
    header: (k: string) => headers[k],
    json: () => JSON.parse(body),
  };
}

function stubUpstream(): UpstreamOAuthProvider {
  return {
    name: 'stub',
    buildAuthorizeUrl: vi.fn(
      (callbackUrl: string, state: string) =>
        `https://upstream.example/authorize?cb=${encodeURIComponent(callbackUrl)}&state=${state}`,
    ),
    exchangeCode: vi.fn(async () => ({
      tokens: { access_token: 'a', refresh_token: 'r', expires_at: null },
      userId: 'user-1',
    })),
    refreshToken: vi.fn(async () => ({
      access_token: 'a2',
      refresh_token: 'r2',
      expires_at: null,
    })),
  };
}

function makeMount(store = new MemoryStore()) {
  return createMcpServeMount({
    name: 'demo-agent',
    upstream: stubUpstream(),
    registerTools: async () => {},
    store,
  });
}

describe('isMcpServeMountPath', () => {
  it('reserves mcp, oauth/*, and the oauth well-known endpoints', () => {
    expect(isMcpServeMountPath('mcp')).toBe(true);
    expect(isMcpServeMountPath('oauth/token')).toBe(true);
    expect(isMcpServeMountPath('oauth/authorize')).toBe(true);
    expect(isMcpServeMountPath('.well-known/oauth-protected-resource')).toBe(true);
    expect(isMcpServeMountPath('.well-known/oauth-authorization-server')).toBe(true);
  });

  it('does not reserve static-ui style paths', () => {
    expect(isMcpServeMountPath('')).toBe(false);
    expect(isMcpServeMountPath('index.html')).toBe(false);
    expect(isMcpServeMountPath('manifest.json')).toBe(false);
    expect(isMcpServeMountPath('mcp/extra')).toBe(false);
  });
});

describe('createMcpServeMount', () => {
  it('serves authorization-server metadata with every endpoint under the prefix', async () => {
    const mount = makeMount();
    const { res, status, json } = fakeRes();

    const handled = await mount.handle(
      fakeReq('GET', '/agents/demo/.well-known/oauth-authorization-server'),
      res,
      '.well-known/oauth-authorization-server',
      BASE,
    );

    expect(handled).toBe(true);
    expect(status()).toBe(200);
    const meta = json();
    expect(meta.issuer).toBe(BASE);
    expect(meta.authorization_endpoint).toBe(`${BASE}/oauth/authorize`);
    expect(meta.token_endpoint).toBe(`${BASE}/oauth/token`);
    expect(meta.registration_endpoint).toBe(`${BASE}/oauth/register`);
  });

  it('serves protected-resource metadata pointing at the prefixed auth server', async () => {
    const mount = makeMount();
    const { res, status, json } = fakeRes();

    const handled = await mount.handle(
      fakeReq('GET', '/agents/demo/.well-known/oauth-protected-resource'),
      res,
      '.well-known/oauth-protected-resource',
      BASE,
    );

    expect(handled).toBe(true);
    expect(status()).toBe(200);
    const meta = json();
    expect(meta.resource).toBe(BASE);
    expect(meta.authorization_servers).toEqual([BASE]);
  });

  it('answers unauthenticated /mcp with 401 + prefixed resource_metadata hint', async () => {
    const mount = makeMount();
    const { res, status, header } = fakeRes();

    const handled = await mount.handle(
      fakeReq('GET', '/agents/demo/mcp'),
      res,
      'mcp',
      BASE,
    );

    expect(handled).toBe(true);
    expect(status()).toBe(401);
    expect(header('WWW-Authenticate')).toContain(
      `${BASE}/.well-known/oauth-protected-resource`,
    );
  });

  it('redirects oauth/authorize upstream with the prefixed callback URL', async () => {
    const store = new MemoryStore();
    await store.createClient('client-1', 'Test Client', ['https://client.example/cb']);
    const upstream = stubUpstream();
    const mount = createMcpServeMount({
      name: 'demo-agent',
      upstream,
      registerTools: async () => {},
      store,
    });
    const { res, status, header } = fakeRes();

    const query =
      'client_id=client-1&redirect_uri=' +
      encodeURIComponent('https://client.example/cb') +
      '&response_type=code&code_challenge=abc&code_challenge_method=S256';
    const handled = await mount.handle(
      fakeReq('GET', `/agents/demo/oauth/authorize?${query}`),
      res,
      'oauth/authorize',
      BASE,
    );

    expect(handled).toBe(true);
    expect(status()).toBe(302);
    expect(upstream.buildAuthorizeUrl).toHaveBeenCalledWith(
      `${BASE}/oauth/upstream-callback`,
      expect.any(String),
    );
    expect(header('Location')).toContain('https://upstream.example/authorize');
  });

  it('returns false for paths it does not own', async () => {
    const mount = makeMount();
    const { res } = fakeRes();

    expect(await mount.handle(fakeReq('GET', '/agents/demo/logo.png'), res, 'logo.png', BASE)).toBe(false);
    expect(await mount.handle(fakeReq('GET', '/agents/demo/'), res, '', BASE)).toBe(false);
    // Wrong method on an owned path falls through too.
    expect(await mount.handle(fakeReq('GET', '/agents/demo/oauth/register'), res, 'oauth/register', BASE)).toBe(false);
  });
});

describe('createMcpServeMount — authenticated MCP over SDK 2.x', () => {
  it('serves per-user tools and skills, preserving ui:// resources and _meta for RemoteMcpClient', async () => {
    const store = new MemoryStore();
    await store.createToken(hashToken('tok-1'), 'user-1', 'client-1', 'access', new Date(Date.now() + 60_000));
    await store.upsertUpstreamTokens('user-1', { access_token: 'upstream-a', refresh_token: 'r', expires_at: null });
    const skills = await SkillsExtension.load(
      memorySkillFiles({ 'post/SKILL.md': '---\nname: post\ndescription: How to post\n---\nBe brief.\n' }),
    );
    const mount = createMcpServeMount({
      name: 'demo-agent',
      upstream: stubUpstream(),
      store,
      skills,
      registerTools: async (server, userId, getUpstreamToken) => {
        server.registerTool(
          'whoami',
          { description: 'Who is calling', inputSchema: z.object({}) },
          async () => ({
            content: [
              { type: 'text', text: `${userId} via ${await getUpstreamToken()}` },
              { type: 'resource', resource: { uri: 'ui://whoami/card', mimeType: 'text/html', text: '<b>hi</b>' } },
            ],
            _meta: { 'umwelten/trace': 't-1' },
          }),
        );
      },
    });
    const http = createServer((req, res) => {
      const sub = new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/agents\/demo\/?/, '');
      void mount.handle(req, res, sub, `http://127.0.0.1/agents/demo`);
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const port = (http.address() as { port: number }).port;
    const client = new RemoteMcpClient({
      serverUrl: `http://127.0.0.1:${port}/agents/demo/mcp`,
      label: 'demo',
      headers: { authorization: 'Bearer tok-1' },
      interactiveAuth: false,
    });
    try {
      await client.connect();
      expect(client.protocolVersion).toBe('2026-07-28');
      expect(client.getToolNames()).toEqual(['whoami']);
      const result = (await client.getTools().whoami!.execute({})) as Record<string, unknown>;
      expect(result).toMatchObject({
        success: true,
        data: 'user-1 via upstream-a',
        _uiResources: [{ uri: 'ui://whoami/card', mimeType: 'text/html', text: '<b>hi</b>' }],
        _meta: { 'umwelten/trace': 't-1' },
      });
      const host = new McpSkillHost();
      await host.addServer(client);
      expect(host.list().map((r) => r.qualifiedName)).toEqual(['demo/post']);
    } finally {
      await client.disconnect();
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    }
  });
});
