import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
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

interface StoredOAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

function defaultAuthStorePath(): string {
  return join(homedir(), '.umwelten', 'mcp-chat', 'tezlab-oauth.json');
}

function resolveAuthStorePath(configuredPath?: string): string {
  return configuredPath ? resolve(configuredPath) : defaultAuthStorePath();
}

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

function normalizeScope(scope?: string): string {
  return (scope || 'mcp')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

function openBrowser(url: string): void {
  console.log(`\n[MCP Chat] Open this URL to authorize TezLab:`);
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

  const child = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
  });

  child.on('error', (error) => {
    console.warn(`[MCP Chat] Failed to open a browser automatically: ${error.message}`);
    console.warn('[MCP Chat] Please open the URL above manually.');
  });

  child.unref();
}

class FileOAuthClientProvider implements OAuthClientProvider {
  private pendingState?: string;

  constructor(
    private readonly redirectUri: string,
    private readonly authStorePath: string,
    private readonly scope: string,
  ) {}

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Umwelten MCP Chat Example',
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

    if (scope === 'client') {
      delete state.clientInformation;
    }
    if (scope === 'tokens') {
      delete state.tokens;
    }
    if (scope === 'verifier') {
      delete state.codeVerifier;
    }

    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async reset(): Promise<void> {
    await rm(this.authStorePath, { force: true });
  }
}

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
        res.end('<h1>Authorization failed</h1><p>You can close this window and return to the terminal.</p>');
        cleanup();
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Missing authorization code</h1><p>You can close this window and return to the terminal.</p>');
        cleanup();
        reject(new Error('No authorization code was returned by the OAuth callback.'));
        return;
      }

      if (expectedState && state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>State mismatch</h1><p>You can close this window and return to the terminal.</p>');
        cleanup();
        reject(new Error('OAuth state mismatch. Please try logging in again.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Authorization successful</h1><p>You can close this window and return to the terminal.</p>');
      cleanup();
      resolve(code);
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the OAuth callback.'));
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
      console.log(`[MCP Chat] Waiting for OAuth callback on http://127.0.0.1:${port}/callback`);
    });
  });
}

function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.unknown();
  }

  switch (schema.type) {
    case 'string': {
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        const enumValues = schema.enum.filter((value: unknown): value is string => typeof value === 'string');
        if (enumValues.length > 0) {
          return z.enum(enumValues as [string, ...string[]]);
        }
      }
      let stringSchema = z.string();
      if (typeof schema.minLength === 'number') stringSchema = stringSchema.min(schema.minLength);
      if (typeof schema.maxLength === 'number') stringSchema = stringSchema.max(schema.maxLength);
      return stringSchema;
    }

    case 'number':
    case 'integer': {
      let numberSchema = z.number();
      if (typeof schema.minimum === 'number') numberSchema = numberSchema.min(schema.minimum);
      if (typeof schema.maximum === 'number') numberSchema = numberSchema.max(schema.maximum);
      if (schema.type === 'integer') numberSchema = numberSchema.int();
      return numberSchema;
    }

    case 'boolean':
      return z.boolean();

    case 'array': {
      const itemSchema = jsonSchemaToZod(schema.items);
      let arraySchema = z.array(itemSchema);
      if (typeof schema.minItems === 'number') arraySchema = arraySchema.min(schema.minItems);
      if (typeof schema.maxItems === 'number') arraySchema = arraySchema.max(schema.maxItems);
      return arraySchema;
    }

    case 'object': {
      const properties = schema.properties && typeof schema.properties === 'object'
        ? schema.properties
        : {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const shape: Record<string, z.ZodTypeAny> = {};

      for (const [key, value] of Object.entries(properties)) {
        const propertySchema = jsonSchemaToZod(value);
        shape[key] = required.has(key) ? propertySchema : propertySchema.optional();
      }

      return z.object(shape);
    }

    default:
      return z.unknown();
  }
}

function shouldIncludeTool(toolDef: MCPToolDescriptor, allowCommands: boolean): boolean {
  if (allowCommands) {
    return true;
  }

  if (toolDef.name === 'send_vehicle_command') {
    return false;
  }

  if (toolDef.annotations?.destructiveHint) {
    return false;
  }

  if (toolDef.annotations?.readOnlyHint === false) {
    return false;
  }

  return true;
}

function serializeContent(content: Array<Record<string, unknown>>): unknown {
  const textParts = content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string);

  if (textParts.length > 0 && content.length === textParts.length) {
    return textParts.join('\n');
  }

  return content.map((item) => {
    if (item.type === 'text' && typeof item.text === 'string') {
      return { type: 'text', text: item.text };
    }

    return item;
  });
}

export interface TezLabManagerOptions {
  serverUrl?: string;
  scope?: string;
  allowCommands?: boolean;
  oauthPort?: number;
  oauthTimeoutMs?: number;
  authStorePath?: string;
}

export class TezLabMCPManager {
  private readonly serverUrl: string;
  private readonly allowCommands: boolean;
  private readonly oauthPort: number;
  private readonly oauthTimeoutMs: number;
  private readonly provider: FileOAuthClientProvider;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private tools: Record<string, Tool> = {};
  private toolNames: string[] = [];

  constructor(options: TezLabManagerOptions = {}) {
    this.serverUrl = options.serverUrl || 'https://mcp.tezlabapp.com';
    this.allowCommands = options.allowCommands ?? false;
    this.oauthPort = options.oauthPort ?? 3339;
    this.oauthTimeoutMs = options.oauthTimeoutMs ?? 300_000;

    const scope = normalizeScope(options.scope);
    const redirectUri = `http://127.0.0.1:${this.oauthPort}/callback`;
    const authStorePath = resolveAuthStorePath(options.authStorePath);
    this.provider = new FileOAuthClientProvider(redirectUri, authStorePath, scope);
  }

  private createClient(): { client: Client; transport: StreamableHTTPClientTransport } {
    const client = new Client(
      {
        name: 'umwelten-mcp-chat',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      authProvider: this.provider,
    });

    return { client, transport };
  }

  async connect(): Promise<void> {
    await this.disconnect();

    let pair = this.createClient();
    this.client = pair.client;
    this.transport = pair.transport;

    try {
      await this.client.connect(this.transport);
    } catch (error) {
      if (!(error instanceof UnauthorizedError) || !this.transport) {
        throw error;
      }

      console.log('[MCP Chat] TezLab OAuth authorization is required.');
      const code = await waitForOAuthCallback({
        port: this.oauthPort,
        timeoutMs: this.oauthTimeoutMs,
        expectedState: this.provider.getPendingState(),
      });

      await this.transport.finishAuth(code);

      pair = this.createClient();
      this.client = pair.client;
      this.transport = pair.transport;
      await this.client.connect(this.transport);
    }

    const result = await this.client.listTools();
    const allowedTools = result.tools.filter((toolDef) => shouldIncludeTool(toolDef, this.allowCommands));

    this.tools = Object.fromEntries(
      allowedTools.map((toolDef) => [toolDef.name, this.toAiTool(toolDef)]),
    );
    this.toolNames = allowedTools.map((toolDef) => toolDef.name).sort();
  }

  private toAiTool(toolDef: MCPToolDescriptor): Tool {
    const client = this.client;
    if (!client) {
      throw new Error('MCP client not connected');
    }

    return tool({
      description: toolDef.description || `TezLab MCP tool: ${toolDef.name}`,
      inputSchema: jsonSchemaToZod(toolDef.inputSchema),
      execute: async (params) => {
        const result = await client.callTool({
          name: toolDef.name,
          arguments: params as Record<string, unknown>,
        });

        const serialized = serializeContent(result.content as Array<Record<string, unknown>>);

        if (result.isError) {
          return {
            tool: toolDef.name,
            success: false,
            error: serialized,
          };
        }

        return {
          tool: toolDef.name,
          success: true,
          data: serialized,
        };
      },
    });
  }

  getTools(): Record<string, Tool> {
    return { ...this.tools };
  }

  getToolNames(): string[] {
    return [...this.toolNames];
  }

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

  async resetAuth(): Promise<void> {
    await this.provider.reset();
  }
}