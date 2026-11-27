/**
 * Unified endpoint discovery — one probe for "what is at this URL?"
 *
 * Give it a URL and it answers with a normalized {@link EndpointCard}:
 * an A2A agent (found via its `/.well-known/agent-card.json`) or an MCP
 * server (found by connecting and listing tools). This is the client-side
 * counterpart of the server-side rule that discovery surfaces (A2A agent
 * card, MCP `server/discover`) project from one source of truth.
 *
 * MCP probes negotiate protocol revision 2026-07-28 (`server/discover`) and
 * fall back to the 2025-era `initialize` handshake; a server declaring the
 * Skills extension also has its skill catalog listed (names only — nothing is
 * read, consistent with lazy skill retrieval).
 *
 * The MCP probe here is deliberately non-interactive: no OAuth browser
 * flow, no callback server. A 401 is an *answer* ("this endpoint exists
 * and wants OAuth"), not a prompt to authenticate — interactive auth
 * belongs to `RemoteMcpClient`.
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SkillsClient } from '@modelcontextprotocol/client/ext/skills';

export type EndpointKind = 'mcp' | 'a2a';

/**
 * What a capability is. The word "skill" means two different things here:
 * - `a2a-skill`: an A2A agent-card `AgentSkill` — an advertised capability of
 *   the agent ("what you can ask it to do"); no content is attached.
 * - `mcp-skill`: an MCP Skills-extension entry — a SKILL.md instruction package
 *   with a file manifest that a host may load into a model's context.
 */
export type EndpointCapabilityKind = 'mcp-tool' | 'mcp-skill' | 'a2a-skill';

/** One MCP tool, MCP skill, or A2A agent skill, normalized for display. */
export interface EndpointCapability {
  kind: EndpointCapabilityKind;
  name: string;
  description?: string;
  /** `mcp-skill`: the skill's `SKILL.md` URI. `a2a-skill`: the AgentSkill `id`. */
  id?: string;
}

/** What auth the probe established the endpoint needs. */
export type EndpointAuth = 'open' | 'bearer' | 'oauth-required';

export interface EndpointCard {
  kind: EndpointKind;
  /** URL to actually talk to (MCP server URL, or the A2A JSON-RPC endpoint from the card). */
  url: string;
  /** The URL the caller originally supplied. */
  inputUrl: string;
  name: string;
  description?: string;
  version?: string;
  /** MCP tools + MCP skills, or A2A agent skills. Empty when auth blocked listing. */
  capabilities: EndpointCapability[];
  /** A2A only: whether the agent card advertises streaming. */
  streaming?: boolean;
  auth: EndpointAuth;
  /** The raw agent card (A2A) or server info + tool list (MCP). */
  raw?: unknown;
}

export interface DiscoverOptions {
  /** Bearer token to send on probes (A2A card fetch and MCP connect). */
  bearerToken?: string;
  /** Per-probe timeout in ms (default 10s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function isUnauthorized(err: unknown): boolean {
  // SDK HTTP errors carry the status in `status` (2.x `SdkHttpError`) or
  // `code`; UnauthorizedError and proxy-shaped errors only say so in the message.
  const e = err as { code?: unknown; status?: unknown; data?: { status?: unknown } } | null;
  for (const status of [e?.code, e?.status, e?.data?.status]) {
    if (status === 401 || status === 403) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /\b401\b|unauthorized/i.test(msg);
}

/** Candidate agent-card URLs for a supplied URL, most specific first. */
export function agentCardCandidates(inputUrl: string): string[] {
  const url = new URL(inputUrl);
  const candidates: string[] = [];
  if (url.pathname.endsWith('/agent-card.json')) {
    candidates.push(url.toString());
  } else {
    // Path-mounted agents (e.g. /agents/<id>) serve a card under their own
    // prefix; try that before falling back to the origin well-known.
    const base = url.toString().replace(/\/$/, '');
    const trimmed = base.replace(/\/(a2a|mcp)$/, '');
    candidates.push(`${trimmed}/.well-known/agent-card.json`);
    const originCard = `${url.origin}/.well-known/agent-card.json`;
    if (!candidates.includes(originCard)) candidates.push(originCard);
  }
  return candidates;
}

interface RawAgentCard {
  name?: string;
  description?: string;
  version?: string;
  url?: string;
  capabilities?: { streaming?: boolean };
  securitySchemes?: Record<string, unknown>;
  skills?: Array<{ id?: string; name?: string; description?: string }>;
}

async function probeA2A(
  inputUrl: string,
  opts: DiscoverOptions,
): Promise<EndpointCard | null> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.bearerToken) headers.authorization = `Bearer ${opts.bearerToken}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const candidate of agentCardCandidates(inputUrl)) {
    let res: Response;
    try {
      res = await fetch(candidate, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      continue;
    }
    if (res.status >= 400) continue;
    let card: RawAgentCard;
    try {
      card = (await res.json()) as RawAgentCard;
    } catch {
      continue;
    }
    // An agent card without a name is not an agent card.
    if (!card || typeof card.name !== 'string') continue;

    const hasSecurity =
      card.securitySchemes && Object.keys(card.securitySchemes).length > 0;
    return {
      kind: 'a2a',
      url: card.url ?? inputUrl,
      inputUrl,
      name: card.name,
      description: card.description,
      version: card.version,
      capabilities: (card.skills ?? []).map((s) => ({
        kind: 'a2a-skill' as const,
        name: s.name ?? s.id ?? 'unnamed skill',
        description: s.description,
        ...(s.id ? { id: s.id } : {}),
      })),
      streaming: card.capabilities?.streaming,
      auth: hasSecurity ? 'bearer' : 'open',
      raw: card,
    };
  }
  return null;
}

async function probeMcp(
  inputUrl: string,
  opts: DiscoverOptions,
): Promise<EndpointCard | null> {
  const headers: Record<string, string> = {};
  if (opts.bearerToken) headers.authorization = `Bearer ${opts.bearerToken}`;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = new Client(
    { name: 'umwelten-endpoint-discovery', version: '2.0.0' },
    { versionNegotiation: { mode: 'auto', probe: { timeoutMs } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(inputUrl), {
    requestInit: { headers },
  });

  try {
    await client.connect(transport, { timeout: timeoutMs });
    const listed = await client.listTools(undefined, { timeout: timeoutMs });
    const skills = new SkillsClient(client, { skipInvalid: true });
    const skillListing = skills.supported
      ? await skills.list(undefined, { timeout: timeoutMs })
      : { skills: [] };
    const serverInfo = client.getServerVersion();
    return {
      kind: 'mcp',
      url: inputUrl,
      inputUrl,
      name: serverInfo?.name ?? new URL(inputUrl).hostname,
      version: serverInfo?.version,
      capabilities: [
        ...listed.tools.map((t) => ({
          kind: 'mcp-tool' as const,
          name: t.name,
          description: t.description,
        })),
        ...skillListing.skills.map((s) => ({
          kind: 'mcp-skill' as const,
          name: s.frontmatter.name,
          description: s.frontmatter.description,
          id: s.uri,
        })),
      ],
      auth: opts.bearerToken ? 'bearer' : 'open',
      raw: {
        serverInfo,
        protocolVersion: client.getNegotiatedProtocolVersion(),
        tools: listed.tools,
        skills: skillListing.skills,
      },
    };
  } catch (err) {
    if (isUnauthorized(err)) {
      // The endpoint exists and speaks HTTP auth — that is a successful
      // discovery with a locked door, not a failure.
      return {
        kind: 'mcp',
        url: inputUrl,
        inputUrl,
        name: new URL(inputUrl).hostname,
        capabilities: [],
        auth: 'oauth-required',
      };
    }
    return null;
  } finally {
    await transport.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

/**
 * Probe a URL as both A2A and MCP and return the first identity it admits
 * to. URLs whose path mentions `/mcp` are probed MCP-first; everything
 * else A2A-first (the card fetch is the cheaper probe).
 *
 * Throws when the URL answers as neither.
 */
export async function discoverAgentEndpoint(
  inputUrl: string,
  opts: DiscoverOptions = {},
): Promise<EndpointCard> {
  const url = new URL(inputUrl); // validates early, throws on garbage
  const mcpFirst = /\/mcp\b/.test(url.pathname);

  const probes = mcpFirst ? [probeMcp, probeA2A] : [probeA2A, probeMcp];
  for (const probe of probes) {
    const card = await probe(inputUrl, opts);
    if (card) return card;
  }
  throw new Error(
    `No agent endpoint found at ${inputUrl}: no A2A agent card at any candidate path, and the URL did not answer as an MCP server.`,
  );
}
