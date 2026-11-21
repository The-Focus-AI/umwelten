/**
 * Remote MCP client powered by `@earendil-works/pi-mcp`.
 *
 * Connects to any remote MCP server over Streamable HTTP with OAuth 2.1 (PKCE).
 * Preserves full MCP `CallToolResult` blocks — including `ui://` `EmbeddedResource`
 * payloads and `_meta` — while exposing tools in Umwelten's `Tool` format.
 */

import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  McpAuthRequiredError,
  McpClient,
  StreamableHttpTransport,
  type CallToolResult,
  type ContentBlock,
  type Tool as PiMcpTool,
} from "@earendil-works/pi-mcp";
import {
  adaptOAuthProvider,
  authorizeMcp,
  parseWwwAuthenticate,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@earendil-works/pi-mcp/oauth";

type MCPToolDescriptor = PiMcpTool;

export interface RemoteMcpExecutableTool {
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (
    params: Record<string, unknown>,
    opts?: { abortSignal?: AbortSignal },
  ) => Promise<unknown>;
}

interface StoredOAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await ensurePrivateDir(dirname(path));
  await writeFile(path, content, { encoding: "utf-8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

function defaultAuthDir(): string {
  return join(homedir(), ".umwelten", "mcp-auth");
}

function authFileForUrl(serverUrl: string): string {
  try {
    const u = new URL(serverUrl);
    const name = (u.hostname + u.pathname)
      .replace(/[^a-zA-Z0-9.-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return join(defaultAuthDir(), `${name}.json`);
  } catch {
    return join(defaultAuthDir(), "default.json");
  }
}

class FileOAuthClientProvider implements OAuthClientProvider {
  private pendingState?: string;

  constructor(
    private readonly redirectUri: string,
    readonly authStorePath: string,
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
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
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
    return (await readJsonFile<StoredOAuthState>(this.authStorePath))
      ?.clientInformation;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    const state =
      (await readJsonFile<StoredOAuthState>(this.authStorePath)) || {};
    state.clientInformation = clientInformation;
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await readJsonFile<StoredOAuthState>(this.authStorePath))?.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const state =
      (await readJsonFile<StoredOAuthState>(this.authStorePath)) || {};
    state.tokens = tokens;
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    openBrowser(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const state =
      (await readJsonFile<StoredOAuthState>(this.authStorePath)) || {};
    state.codeVerifier = codeVerifier;
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async codeVerifier(): Promise<string> {
    const codeVerifier = (
      await readJsonFile<StoredOAuthState>(this.authStorePath)
    )?.codeVerifier;
    if (!codeVerifier) {
      throw new Error("No saved PKCE verifier found. Run the login flow again.");
    }
    return codeVerifier;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier",
  ): Promise<void> {
    if (scope === "all") {
      await rm(this.authStorePath, { force: true });
      return;
    }
    const state =
      (await readJsonFile<StoredOAuthState>(this.authStorePath)) || {};
    if (scope === "client") delete state.clientInformation;
    if (scope === "tokens") delete state.tokens;
    if (scope === "verifier") delete state.codeVerifier;
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async reset(): Promise<void> {
    await rm(this.authStorePath, { force: true });
  }
}

function openBrowser(url: string): void {
  console.log(`\n[MCP] Open this URL to authorize:\n${url}`);

  let command = "xdg-open";
  let args = [url];
  if (process.platform === "darwin") {
    command = "open";
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  }

  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    console.warn(
      "[MCP] Failed to open browser automatically. Please open the URL above manually.",
    );
  });
  child.unref();
}

async function waitForOAuthCallback(options: {
  port: number;
  timeoutMs: number;
  expectedState?: string;
}): Promise<string> {
  const { port, timeoutMs, expectedState } = options;

  return await new Promise<string>((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
      const state = requestUrl.searchParams.get("state");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Authorization failed</h1><p>You can close this window.</p>");
        cleanup();
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Missing authorization code</h1><p>You can close this window.</p>");
        cleanup();
        reject(new Error("No authorization code was returned."));
        return;
      }

      if (expectedState && state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>State mismatch</h1><p>You can close this window.</p>");
        cleanup();
        reject(new Error("OAuth state mismatch."));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Authorization successful!</h1><p>You can close this window.</p>");
      cleanup();
      resolvePromise(code);
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for OAuth callback."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      server.close();
    };

    server.on("error", (error) => {
      cleanup();
      reject(error);
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(
        `[MCP] Waiting for OAuth callback on http://127.0.0.1:${port}/callback`,
      );
    });
  });
}

function serializeResult(result: CallToolResult): {
  serialized: unknown;
  uiResources: Array<Record<string, unknown>>;
} {
  const blocks: ContentBlock[] = result.content ?? [];
  const uiResources: Array<Record<string, unknown>> = [];
  const nonUiBlocks: ContentBlock[] = [];

  for (const block of blocks) {
    if (
      block.type === "resource" &&
      typeof block.resource?.uri === "string" &&
      block.resource.uri.startsWith("ui://")
    ) {
      uiResources.push(block.resource as unknown as Record<string, unknown>);
    } else {
      nonUiBlocks.push(block);
    }
  }

  const textParts = nonUiBlocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text);

  if (textParts.length > 0 && textParts.length === nonUiBlocks.length) {
    return { serialized: textParts.join("\n"), uiResources };
  }

  if (nonUiBlocks.length === 0 && result.structuredContent !== undefined) {
    return { serialized: result.structuredContent, uiResources };
  }

  return { serialized: nonUiBlocks, uiResources };
}

export interface RemoteMcpClientOptions {
  serverUrl: string;
  scope?: string;
  oauthPort?: number;
  oauthTimeoutMs?: number;
  authStorePath?: string;
  clientName?: string;
  toolFilter?: (tool: MCPToolDescriptor) => boolean;
  headers?: Record<string, string>;
}

export class RemoteMcpClient {
  private readonly serverUrl: string;
  private readonly oauthPort: number;
  private readonly oauthTimeoutMs: number;
  private readonly toolFilter: (tool: MCPToolDescriptor) => boolean;
  private readonly headers: Record<string, string> | undefined;
  private readonly provider: FileOAuthClientProvider;
  private client: McpClient | null = null;
  private transport: StreamableHttpTransport | null = null;
  private tools: Record<string, RemoteMcpExecutableTool> = {};
  private toolNames: string[] = [];
  private toolDescriptions: Map<string, string> = new Map();

  constructor(options: RemoteMcpClientOptions) {
    this.serverUrl = options.serverUrl;
    this.oauthPort = options.oauthPort ?? 3339;
    this.oauthTimeoutMs = options.oauthTimeoutMs ?? 300_000;
    this.toolFilter = options.toolFilter ?? (() => true);
    this.headers = options.headers;

    const scope = (options.scope || "mcp")
      .split(/\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .join(" ");
    const redirectUri = `http://127.0.0.1:${this.oauthPort}/callback`;
    const authStorePath = options.authStorePath ?? authFileForUrl(this.serverUrl);
    const clientName = options.clientName ?? "umwelten-mcp-client";
    this.provider = new FileOAuthClientProvider(
      redirectUri,
      authStorePath,
      scope,
      clientName,
    );
  }

  private createPair(): {
    client: McpClient;
    transport: StreamableHttpTransport;
  } {
    const client = new McpClient({
      name: "umwelten-mcp-client",
      version: "1.0.0",
    });
    const transport = new StreamableHttpTransport({
      url: this.serverUrl,
      headers: this.headers,
      authProvider: adaptOAuthProvider(this.provider),
    });
    return { client, transport };
  }

  async connect(): Promise<void> {
    await this.disconnect();

    let pair = this.createPair();
    this.client = pair.client;
    this.transport = pair.transport;

    try {
      await this.client.connect(this.transport);
    } catch (error) {
      if (!(error instanceof McpAuthRequiredError)) throw error;

      const challenge = error.wwwAuthenticate
        ? parseWwwAuthenticate(error.wwwAuthenticate)
        : undefined;
      await authorizeMcp(this.provider, {
        serverUrl: this.serverUrl,
        resourceMetadataUrl: challenge?.resourceMetadataUrl,
        scope: challenge?.scope,
      });

      const code = await waitForOAuthCallback({
        port: this.oauthPort,
        timeoutMs: this.oauthTimeoutMs,
        expectedState: this.provider.getPendingState(),
      });

      await authorizeMcp(this.provider, {
        serverUrl: this.serverUrl,
        authorizationCode: code,
        resourceMetadataUrl: challenge?.resourceMetadataUrl,
      });

      pair = this.createPair();
      this.client = pair.client;
      this.transport = pair.transport;
      await this.client.connect(this.transport);
    }

    const discovered = await this.client.listTools();
    const filtered = discovered.filter(this.toolFilter);

    this.tools = Object.fromEntries(
      filtered.map((td) => [td.name, this.toUmweltenTool(td)]),
    );
    this.toolNames = filtered.map((td) => td.name).sort();
    this.toolDescriptions = new Map(
      filtered.map((td) => [td.name, td.description || ""]),
    );
  }

  private toUmweltenTool(toolDef: MCPToolDescriptor): RemoteMcpExecutableTool {
    const client = this.client;
    if (!client) throw new Error("MCP client not connected");

    return {
      description: toolDef.description || `MCP tool: ${toolDef.name}`,
      inputSchema: (toolDef.inputSchema ?? {
        type: "object",
        properties: {},
      }) as Record<string, unknown>,
      execute: async (params, opts) => {
        const result = await client.callTool(
          toolDef.name,
          (params ?? {}) as Record<string, unknown>,
          { signal: opts?.abortSignal },
        );
        const { serialized, uiResources } = serializeResult(result);
        if (result.isError) {
          return { tool: toolDef.name, success: false, error: serialized };
        }
        return {
          tool: toolDef.name,
          success: true,
          data: serialized,
          ...(uiResources.length > 0 ? { _uiResources: uiResources } : {}),
          ...(result._meta ? { _meta: result._meta } : {}),
        };
      },
    };
  }

  /** Underlying `@earendil-works/pi-mcp` `McpClient` (preserves raw `resources/read`, `ui://`, and `_meta`). */
  get rawClient(): McpClient | null {
    return this.client;
  }

  getTools(): Record<string, RemoteMcpExecutableTool> {
    return { ...this.tools };
  }

  getToolNames(): string[] {
    return [...this.toolNames];
  }

  getToolDescription(name: string): string | undefined {
    return this.toolDescriptions.get(name);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close().catch(() => undefined);
      this.transport = null;
    }
  }

  async resetAuth(): Promise<void> {
    await this.provider.reset();
  }

  get authStorePath(): string {
    return this.provider.authStorePath;
  }
}
