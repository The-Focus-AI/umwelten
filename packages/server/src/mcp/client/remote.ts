/**
 * Generic remote MCP client with OAuth support.
 *
 * Connects to any remote MCP server over Streamable HTTP with OAuth 2.1 (PKCE).
 * Stores credentials on disk so re-auth is only needed once.
 * Converts MCP tools into Vercel AI SDK tools for use with Interactions.
 *
 * Usage:
 *   const mcp = new RemoteMcpClient({ serverUrl: 'https://oura-mcp.fly.dev/mcp' });
 *   await mcp.connect();
 *   const tools = mcp.getTools(); // Record<string, Tool> for Interaction
 */

import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

type MCPToolDescriptor = Awaited<ReturnType<Client['listTools']>>['tools'][number];

// ── Stored OAuth state ─────────────────────────────────────────

interface StoredOAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

// ── File helpers ───────────────────────────────────────────────

async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await ensurePrivateDir(dirname(path));
  await writeFile(path, content, { encoding: 'utf-8', mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

// ── Auth store path resolution ────────────────────────────────

function defaultAuthDir(): string {
  return join(homedir(), '.umwelten', 'mcp-auth');
}

/**
 * Derive a stable filename from a server URL.
 * e.g. "https://oura-mcp.fly.dev/mcp" → "oura-mcp.fly.dev-mcp.json"
 */
function authFileForUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    const name = (u.hostname + u.pathname).replace(/[^a-zA-Z0-9.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return join(defaultAuthDir(), `${name}.json`);
  } catch {
    return join(defaultAuthDir(), 'default.json');
  }
}

// ── OAuth client provider (file-backed) ───────────────────────

class FileOAuthClientProvider implements OAuthClientProvider {
  private pendingState?: string;

  constructor(
    private readonly redirectUri: string,
    private readonly authStorePath: string,
    private readonly scope: string,
    private readonly clientName: string,
  ) {}

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.clientName,
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: this.scope,
    };
  }

  async state(): Promise<string> {
    this.pendingState = randomUUID();
    return this.pendingState;
  }

  getPendingState(): string | undefined {
    return this.pendingState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await readJsonFile<StoredOAuthState>(this.authStorePath))?.clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    const state = (await readJsonFile<StoredOAuthState>(this.authStorePath)) || {};
    state.clientInformation = clientInformation;
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await readJsonFile<StoredOAuthState>(this.authStorePath))?.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const state = (await readJsonFile<StoredOAuthState>(this.authStorePath)) || {};
    state.tokens = tokens;
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    openBrowser(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const state = (await readJsonFile<StoredOAuthState>(this.authStorePath)) || {};
    state.codeVerifier = codeVerifier;
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async codeVerifier(): Promise<string> {
    const codeVerifier = (await readJsonFile<StoredOAuthState>(this.authStorePath))?.codeVerifier;
    if (!codeVerifier) {
      throw new Error('No saved PKCE verifier found. Run the login flow again.');
    }
    return codeVerifier;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
    if (scope === 'all') {
      await rm(this.authStorePath, { force: true });
      return;
    }
    const state = (await readJsonFile<StoredOAuthState>(this.authStorePath)) || {};
    if (scope === 'client') delete state.clientInformation;
    if (scope === 'tokens') delete state.tokens;
    if (scope === 'verifier') delete state.codeVerifier;
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async reset(): Promise<void> {
    await rm(this.authStorePath, { force: true });
  }
}

// ── Browser helper ────────────────────────────────────────────

function openBrowser(url: string): void {
  console.log(`\n[MCP] Open this URL to authorize:`);
  console.log(url);

  let command: string;
  let args: string[];

  switch (process.platform) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      command = 'cmd';
      args = ['/c', 'start', '', url];
      break;
    default:
      command = 'xdg-open';
      args = [url];
      break;
  }

  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {
    console.warn('[MCP] Failed to open browser automatically. Please open the URL above manually.');
  });
  child.unref();
}

// ── OAuth callback server ─────────────────────────────────────

async function waitForOAuthCallback(options: {
  port: number;
  timeoutMs: number;
  expectedState?: string;
}): Promise<string> {
  const { port, timeoutMs, expectedState } = options;

  return await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const code = requestUrl.searchParams.get('code');
      const error = requestUrl.searchParams.get('error');
      const state = requestUrl.searchParams.get('state');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Authorization failed</h1><p>You can close this window.</p>');
        cleanup();
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Missing authorization code</h1><p>You can close this window.</p>');
        cleanup();
        reject(new Error('No authorization code was returned.'));
        return;
      }

      if (expectedState && state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>State mismatch</h1><p>You can close this window.</p>');
        cleanup();
        reject(new Error('OAuth state mismatch.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>');
      cleanup();
      resolve(code);
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for OAuth callback.'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      server.close();
    };

    server.on('error', (error) => {
      cleanup();
      reject(error);
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`[MCP] Waiting for OAuth callback on http://127.0.0.1:${port}/callback`);
    });
  });
}

// ── JSON Schema → Zod conversion ──────────────────────────────

function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.unknown();

  switch (schema.type) {
    case 'string': {
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        const vals = schema.enum.filter((v: unknown): v is string => typeof v === 'string');
        if (vals.length > 0) return z.enum(vals as [string, ...string[]]);
      }
      let s = z.string();
      if (schema.description) s = s.describe(schema.description);
      if (typeof schema.minLength === 'number') s = s.min(schema.minLength);
      if (typeof schema.maxLength === 'number') s = s.max(schema.maxLength);
      return s;
    }
    case 'number':
    case 'integer': {
      let n = z.number();
      if (schema.description) n = n.describe(schema.description);
      if (typeof schema.minimum === 'number') n = n.min(schema.minimum);
      if (typeof schema.maximum === 'number') n = n.max(schema.maximum);
      if (schema.type === 'integer') n = n.int();
      return n;
    }
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(jsonSchemaToZod(schema.items));
    case 'object': {
      const props = schema.properties ?? {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, value] of Object.entries(props)) {
        const propertySchema = jsonSchemaToZod(value);
        shape[key] = required.has(key) ? propertySchema : propertySchema.optional();
      }
      return z.object(shape);
    }
    default:
      return z.unknown();
  }
}

// ── Content serialization ─────────────────────────────────────

function serializeContent(content: Array<Record<string, unknown>>): unknown {
  const textParts = content
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string);

  if (textParts.length > 0 && content.length === textParts.length) {
    return textParts.join('\n');
  }

  return content.map(item =>
    item.type === 'text' && typeof item.text === 'string'
      ? { type: 'text', text: item.text }
      : item,
  );
}

// ── Main client class ─────────────────────────────────────────

export interface RemoteMcpClientOptions {
  /** MCP server URL, e.g. "https://oura-mcp.fly.dev/mcp" */
  serverUrl: string;
  /** OAuth scope to request (default: "mcp") */
  scope?: string;
  /** Local port for OAuth callback (default: 3339) */
  oauthPort?: number;
  /** Timeout for OAuth callback in ms (default: 5 minutes) */
  oauthTimeoutMs?: number;
  /** Path to store OAuth credentials (auto-derived from serverUrl if omitted) */
  authStorePath?: string;
  /** Client name for OAuth registration (default: "umwelten-mcp-client") */
  clientName?: string;
  /** Filter which tools to expose (return false to exclude) */
  toolFilter?: (tool: MCPToolDescriptor) => boolean;
}

export class RemoteMcpClient {
  private readonly serverUrl: string;
  private readonly oauthPort: number;
  private readonly oauthTimeoutMs: number;
  private readonly toolFilter: (tool: MCPToolDescriptor) => boolean;
  private readonly provider: FileOAuthClientProvider;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private tools: Record<string, Tool> = {};
  private toolNames: string[] = [];
  private toolDescriptions: Map<string, string> = new Map();

  constructor(options: RemoteMcpClientOptions) {
    this.serverUrl = options.serverUrl;
    this.oauthPort = options.oauthPort ?? 3339;
    this.oauthTimeoutMs = options.oauthTimeoutMs ?? 300_000;
    this.toolFilter = options.toolFilter ?? (() => true);

    const scope = (options.scope || 'mcp').split(/\s+/).map(p => p.trim()).filter(Boolean).join(' ');
    const redirectUri = `http://127.0.0.1:${this.oauthPort}/callback`;
    const authStorePath = options.authStorePath ?? authFileForUrl(this.serverUrl);
    const clientName = options.clientName ?? 'umwelten-mcp-client';
    this.provider = new FileOAuthClientProvider(redirectUri, authStorePath, scope, clientName);
  }

  private createPair(): { client: Client; transport: StreamableHTTPClientTransport } {
    const client = new Client({ name: 'umwelten-mcp-client', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      authProvider: this.provider,
    });
    return { client, transport };
  }

  /** Connect to the remote MCP server, handling OAuth if needed. */
  async connect(): Promise<void> {
    await this.disconnect();

    let pair = this.createPair();
    this.client = pair.client;
    this.transport = pair.transport;

    try {
      await this.client.connect(this.transport);
    } catch (error) {
      if (!(error instanceof UnauthorizedError) || !this.transport) throw error;

      console.log('[MCP] OAuth authorization required for', this.serverUrl);
      const code = await waitForOAuthCallback({
        port: this.oauthPort,
        timeoutMs: this.oauthTimeoutMs,
        expectedState: this.provider.getPendingState(),
      });

      await this.transport.finishAuth(code);

      // Reconnect with new credentials
      pair = this.createPair();
      this.client = pair.client;
      this.transport = pair.transport;
      await this.client.connect(this.transport);
    }

    // Discover tools
    const result = await this.client.listTools();
    const filtered = result.tools.filter(this.toolFilter);

    this.tools = Object.fromEntries(filtered.map(td => [td.name, this.toAiTool(td)]));
    this.toolNames = filtered.map(td => td.name).sort();
    this.toolDescriptions = new Map(filtered.map(td => [td.name, td.description || '']));
  }

  private toAiTool(toolDef: MCPToolDescriptor): Tool {
    const client = this.client;
    if (!client) throw new Error('MCP client not connected');

    return tool({
      description: toolDef.description || `MCP tool: ${toolDef.name}`,
      inputSchema: jsonSchemaToZod(toolDef.inputSchema),
      execute: async (params) => {
        const result = await client.callTool({
          name: toolDef.name,
          arguments: params as Record<string, unknown>,
        });
        const serialized = serializeContent(result.content as Array<Record<string, unknown>>);
        if (result.isError) {
          return { tool: toolDef.name, success: false, error: serialized };
        }
        return { tool: toolDef.name, success: true, data: serialized };
      },
    });
  }

  /** Get all tools as Vercel AI SDK Tool objects (for use with Interaction/Stimulus). */
  getTools(): Record<string, Tool> {
    return { ...this.tools };
  }

  /** Get sorted tool names. */
  getToolNames(): string[] {
    return [...this.toolNames];
  }

  /** Get tool description by name. */
  getToolDescription(name: string): string | undefined {
    return this.toolDescriptions.get(name);
  }

  /** Disconnect from the server. */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close().catch(() => undefined);
      this.transport = null;
    }
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
  }

  /** Clear stored OAuth credentials. */
  async resetAuth(): Promise<void> {
    await this.provider.reset();
  }

  /** Path where OAuth credentials are stored. */
  get authStorePath(): string {
    return (this.provider as any).authStorePath;
  }
}
