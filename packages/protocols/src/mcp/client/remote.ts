/**
 * Remote MCP client powered by the official `@modelcontextprotocol/client` 2.x SDK.
 *
 * Connects to any remote MCP server over Streamable HTTP, negotiating protocol
 * revision 2026-07-28 (`server/discover`) with fallback to the 2025-era
 * `initialize` handshake, and runs the OAuth 2.1 (PKCE) browser flow when the
 * server answers 401. Preserves full MCP `CallToolResult` blocks — including
 * `ui://` `EmbeddedResource` payloads and `_meta` — while exposing tools in
 * Umwelten's `Tool` format, and exposes the server's Skills extension
 * (`io.modelcontextprotocol/skills`) through the SDK's `SkillsClient`.
 */

import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type CallToolResult,
  type ContentBlock,
  type FetchLike,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type ServerCapabilities,
  type Tool as McpToolDescriptor,
} from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";

type StoredClientInformation = Awaited<ReturnType<OAuthClientProvider["clientInformation"]>>;
type StoredTokens = Awaited<ReturnType<OAuthClientProvider["tokens"]>>;

export interface RemoteMcpExecutableTool {
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (
    params: Record<string, unknown>,
    opts?: { abortSignal?: AbortSignal },
  ) => Promise<unknown>;
}

interface StoredOAuthState {
  clientInformation?: StoredClientInformation;
  tokens?: StoredTokens;
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

  state(): string {
    this.pendingState = randomUUID();
    return this.pendingState;
  }

  getPendingState(): string | undefined {
    return this.pendingState;
  }

  private async load(): Promise<StoredOAuthState> {
    return (await readJsonFile<StoredOAuthState>(this.authStorePath)) ?? {};
  }

  private async save(state: StoredOAuthState): Promise<void> {
    await writePrivateFile(this.authStorePath, JSON.stringify(state, null, 2));
  }

  async clientInformation(): Promise<StoredClientInformation> {
    return (await this.load()).clientInformation;
  }

  async saveClientInformation(clientInformation: NonNullable<StoredClientInformation>): Promise<void> {
    const state = await this.load();
    state.clientInformation = clientInformation;
    await this.save(state);
  }

  async tokens(): Promise<StoredTokens> {
    return (await this.load()).tokens;
  }

  async saveTokens(tokens: NonNullable<StoredTokens>): Promise<void> {
    const state = await this.load();
    state.tokens = tokens;
    await this.save(state);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    openBrowser(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const state = await this.load();
    state.codeVerifier = codeVerifier;
    await this.save(state);
  }

  async codeVerifier(): Promise<string> {
    const codeVerifier = (await this.load()).codeVerifier;
    if (!codeVerifier) {
      throw new Error("No saved PKCE verifier found. Run the login flow again.");
    }
    return codeVerifier;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all") {
      await rm(this.authStorePath, { force: true });
      return;
    }
    if (scope === "discovery") return;
    const state = await this.load();
    if (scope === "client") delete state.clientInformation;
    if (scope === "tokens") delete state.tokens;
    if (scope === "verifier") delete state.codeVerifier;
    await this.save(state);
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

/** Waits for the OAuth redirect and returns its query parameters (`code`, `state`, `iss`). */
async function waitForOAuthCallback(options: {
  port: number;
  timeoutMs: number;
  expectedState?: string;
}): Promise<URLSearchParams> {
  const { port, timeoutMs, expectedState } = options;

  return await new Promise<URLSearchParams>((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      const params = requestUrl.searchParams;
      const error = params.get("error");

      const fail = (status: number, title: string, err: Error) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>${title}</h1><p>You can close this window.</p>`);
        cleanup();
        reject(err);
      };

      if (error) return fail(400, "Authorization failed", new Error(`OAuth authorization failed: ${error}`));
      if (!params.get("code")) return fail(400, "Missing authorization code", new Error("No authorization code was returned."));
      if (expectedState && params.get("state") !== expectedState) {
        return fail(400, "State mismatch", new Error("OAuth state mismatch."));
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Authorization successful!</h1><p>You can close this window.</p>");
      cleanup();
      resolvePromise(params);
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
  /**
   * Host-assigned label for this server. The Skills extension requires hosts
   * to identify servers by their own label, never the server's self-reported
   * `serverInfo.name`. Defaults to the URL's host.
   */
  label?: string;
  scope?: string;
  oauthPort?: number;
  oauthTimeoutMs?: number;
  authStorePath?: string;
  clientName?: string;
  toolFilter?: (tool: McpToolDescriptor) => boolean;
  headers?: Record<string, string>;
  /**
   * Fail with `UnauthorizedError` instead of opening a browser when the
   * server asks for OAuth (for non-interactive hosts and tests).
   */
  interactiveAuth?: boolean;
  /** Custom fetch (e.g. an in-process server's `handler.fetch` in tests). */
  fetch?: FetchLike;
}

export class RemoteMcpClient {
  readonly serverUrl: string;
  readonly label: string;
  private readonly oauthPort: number;
  private readonly oauthTimeoutMs: number;
  private readonly toolFilter: (tool: McpToolDescriptor) => boolean;
  private readonly headers: Record<string, string> | undefined;
  private readonly interactiveAuth: boolean;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly provider: FileOAuthClientProvider;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private skillsClient: SkillsClient | null = null;
  private tools: Record<string, RemoteMcpExecutableTool> = {};
  private toolDescriptors: McpToolDescriptor[] = [];

  constructor(options: RemoteMcpClientOptions) {
    this.serverUrl = options.serverUrl;
    this.label = options.label ?? new URL(options.serverUrl).host;
    this.oauthPort = options.oauthPort ?? 3339;
    this.oauthTimeoutMs = options.oauthTimeoutMs ?? 300_000;
    this.toolFilter = options.toolFilter ?? (() => true);
    this.headers = options.headers;
    this.interactiveAuth = options.interactiveAuth ?? true;
    this.fetchImpl = options.fetch;

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
    client: Client;
    transport: StreamableHTTPClientTransport;
  } {
    const client = new Client(
      { name: "umwelten-mcp-client", version: "2.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
      ...(this.headers ? { requestInit: { headers: this.headers } } : {}),
      ...(this.interactiveAuth ? { authProvider: this.provider } : {}),
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
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
      if (!this.interactiveAuth || !(error instanceof UnauthorizedError)) throw error;

      // The transport already ran discovery + DCR and opened the browser via
      // `redirectToAuthorization`; wait for the redirect, then exchange the code.
      const callback = await waitForOAuthCallback({
        port: this.oauthPort,
        timeoutMs: this.oauthTimeoutMs,
        expectedState: this.provider.getPendingState(),
      });
      await this.transport.finishAuth(callback);

      pair = this.createPair();
      this.client = pair.client;
      this.transport = pair.transport;
      await this.client.connect(this.transport);
    }

    this.skillsClient = new SkillsClient(this.client);
    await this.refreshTools();
  }

  /** Re-list tools (e.g. after `notifications/tools/list_changed`). */
  async refreshTools(): Promise<void> {
    const client = this.requireClient();
    const discovered = client.getServerCapabilities()?.tools ? (await client.listTools()).tools : [];
    const filtered = discovered.filter(this.toolFilter);
    this.toolDescriptors = filtered;
    this.tools = Object.fromEntries(
      filtered.map((td) => [td.name, this.toUmweltenTool(td)]),
    );
  }

  private requireClient(): Client {
    if (!this.client) throw new Error(`MCP client for ${this.label} is not connected`);
    return this.client;
  }

  private toUmweltenTool(toolDef: McpToolDescriptor): RemoteMcpExecutableTool {
    const client = this.requireClient();

    return {
      description: toolDef.description || `MCP tool: ${toolDef.name}`,
      inputSchema: (toolDef.inputSchema ?? {
        type: "object",
        properties: {},
      }) as Record<string, unknown>,
      execute: async (params, opts) => {
        const result = (await client.callTool(
          { name: toolDef.name, arguments: (params ?? {}) as Record<string, unknown> },
          { signal: opts?.abortSignal, toolDefinition: toolDef },
        )) as CallToolResult;
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

  /** Underlying SDK `Client` (raw `resources/read`, `ui://`, and `_meta`). */
  get rawClient(): Client | null {
    return this.client;
  }

  /**
   * The SDK's Skills extension client for this connection (list, get,
   * verified read, readDirectory). `skills.supported` is `false` when the
   * server does not declare `io.modelcontextprotocol/skills`.
   */
  get skills(): SkillsClient {
    if (!this.skillsClient) throw new Error(`MCP client for ${this.label} is not connected`);
    return this.skillsClient;
  }

  /** Negotiated protocol revision, e.g. `2026-07-28`, or a 2025 revision after fallback. */
  get protocolVersion(): string | undefined {
    return this.client?.getNegotiatedProtocolVersion();
  }

  get serverInfo(): { name: string; version: string } | undefined {
    return this.client?.getServerVersion();
  }

  get serverCapabilities(): ServerCapabilities | undefined {
    return this.client?.getServerCapabilities();
  }

  get instructions(): string | undefined {
    return this.client?.getInstructions();
  }

  getTools(): Record<string, RemoteMcpExecutableTool> {
    return { ...this.tools };
  }

  getToolDescriptors(): McpToolDescriptor[] {
    return [...this.toolDescriptors];
  }

  getToolNames(): string[] {
    return this.toolDescriptors.map((t) => t.name).sort();
  }

  getToolDescription(name: string): string | undefined {
    return this.toolDescriptors.find((t) => t.name === name)?.description;
  }

  async disconnect(): Promise<void> {
    this.skillsClient = null;
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
