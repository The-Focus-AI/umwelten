/**
 * Habitat ↔ A2A adapter.
 *
 * Bridges habitat-specific abstractions (`AgentHost`, `ChannelBridge`,
 * published artifacts) to the generic A2A scaffolding in `@umwelten/protocols`.
 *
 * - {@link buildAgentCard} converts a habitat's config + stimulus into the
 *   **served** agent card (legacy 0.3 shape — what every current peer and the
 *   habitats SaaS parse at `/.well-known/agent-card.json`).
 * - {@link toV1AgentCard} projects that served card into the v1 SDK's
 *   protobuf-shaped `AgentCard` for the request handler — one definition,
 *   two projections.
 * - {@link HabitatAgentExecutor} implements the v1 `AgentExecutor` contract.
 * - {@link createA2AHandler} wires everything into an {@link A2AHandler}
 *   ready to mount on the container HTTP server.
 *
 * v1 event-model note (SDK 1.x migration): the stream terminates on a
 * Message event, a terminal task status, or INPUT_REQUIRED — there is no
 * `final` flag anymore. The 0.3-era ordering (artifacts → terminal status
 * with `final:false` → final message) is therefore replaced by: task
 * snapshot → working status deltas → artifacts → **one terminal status
 * update whose `status.message` carries the reply** (and the usage /
 * provenance metadata). Blocking senders receive the Task and read
 * `status.message`; our `decodeA2ASendPayload` has always understood that
 * shape.
 */

import { randomUUID } from "node:crypto";
import { TaskState, type AgentCard, type Artifact, type Task } from "@a2a-js/sdk";
import { join } from "node:path";
import {
  AgentEvent,
  createA2AServer,
  FilePushNotificationStore,
  FileTaskStore,
  notifySweptTasks,
  sweepAbandonedTasks,
  agentMessage,
  filePart,
  messageText,
  textPart,
  type A2AServer,
  type AgentExecutor,
  type RequestContext,
  type ExecutionEventBus,
} from "@umwelten/protocols";
import type { Message, Part } from "@a2a-js/sdk";
import type { AgentHost } from "./types.js";
import type { ChannelBridge } from "./bridge/channel-bridge.js";
import {
  listArtifacts,
  toAbsoluteArtifactUrl,
  type ArtifactMeta,
} from "./tools/artifact-tools.js";
import {
  drainUIResources,
  uiResourceToA2APart,
  UI_OUTPUT_MODE,
} from "./ui-resources.js";
import {
  ProvenanceCache,
  readHabitatProvenance,
  type HabitatProvenance,
} from "./provision/provenance.js";
import { realProvenanceProbe } from "./provision/provenance-probe.js";
import { getSpeaker } from "./identity/agent-speaker-context.js";
import { withInboundAgentCallChain } from "./identity/agent-call-context.js";
import {
  decodeAgentChain,
  extendAgentChain,
} from "./identity/agent-call-wire.js";

// ── Agent card builder ────────────────────────────────────────────

export interface AgentCardOptions {
  /** Base URL where the agent is hosted (e.g. "http://localhost:8080"). */
  baseUrl: string;
  /** Habitat instance for config + stimulus. */
  habitat: AgentHost;
  /** Override name (defaults to config.name). */
  name?: string;
  /** Override description. */
  description?: string;
  /**
   * When true, the card declares HTTP bearer auth (securitySchemes +
   * security) so clients discover the requirement instead of failing
   * on 401. Set iff the host enforces an API key on /a2a.
   */
  requiresApiKey?: boolean;
  /**
   * When true, the bearer the habitat accepts is a per-user JWT (jwt /
   * jwt+bearer mode, ADR 0003). Advertised as `bearerFormat: "JWT"` so the
   * habitats SaaS knows to mint a per-user grant (aud = this habitat) instead
   * of sending a static shared bearer.
   */
  jwtMode?: boolean;
}

/**
 * A credential the agent needs to function, advertised on its card so an
 * attaching client can collect it (ADR 0004). `secret` → a form field; `oauth`
 * → a "Connect" button driving the agent's own OAuth at `connectPath`.
 */
export interface RequiredCredential {
  name: string;
  label: string;
  description?: string;
  required: boolean;
  type: "secret" | "oauth";
  connectPath?: string;
  /** For `type: "oauth"`: the scopes the connect flow requests (user-facing). */
  scopes?: string[];
  /**
   * Whether the habitat already holds this credential (annotated at card-serve
   * time from the live secret store; names checked, values never exposed). An
   * attaching client should treat a configured credential as satisfied instead
   * of asking the operator to re-enter a value gaia already manages.
   */
  configured?: boolean;
}

/** A skill entry as served on the legacy-shaped card. */
export interface ServedAgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
}

/**
 * The card served at `/.well-known/agent-card.json`, in the legacy (0.3)
 * shape every current peer parses, plus our extensions. The v1 SDK's
 * `AgentCard` type is protobuf-shaped and no longer matches the served
 * wire form — {@link toV1AgentCard} converts when the SDK needs one.
 */
export interface HabitatAgentCard {
  name: string;
  description?: string;
  url: string;
  version: string;
  /**
   * The legacy wire dialect this card's URL speaks for pre-1.0 peers.
   * v1.0-aware clients treat a legacy-range version as "use the compat
   * transport", which our dual-dialect endpoint serves. (Was "0.2.5"
   * before the SDK 1.x migration — stale even then.)
   */
  protocolVersion: string;
  capabilities: { streaming?: boolean; pushNotifications?: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: ServedAgentSkill[];
  securitySchemes?: Record<
    string,
    { type: "http"; scheme: string; bearerFormat?: string; description?: string }
  >;
  security?: Array<Record<string, string[]>>;
  requiredCredentials?: RequiredCredential[];
  /**
   * Whose third-party account the agent's tools act as (config.credentialMode):
   * "shared" (one operator account for everyone), "per-user" (each user connects
   * their own, no fallback), or "hybrid" (per-user with shared fallback).
   * Advertised so attaching clients can display the permission model.
   */
  credentialMode?: "shared" | "per-user" | "hybrid";
}

export async function buildAgentCard(
  options: AgentCardOptions,
): Promise<HabitatAgentCard> {
  const { baseUrl, habitat } = options;
  const config = habitat.getConfig();
  const stimulus = await habitat.getStimulus();
  const stimulusOptions = stimulus.options;

  const name = options.name ?? config.name ?? "Habitat Agent";
  const description =
    options.description ??
    stimulusOptions.role ??
    `An AI agent powered by ${config.defaultProvider ?? "unknown"}/${config.defaultModel ?? "unknown"}`;

  // Group tools into a single "general" skill — the agent handles routing internally
  const skills: ServedAgentSkill[] = [
    {
      id: "general",
      name: "General",
      description,
      tags: ["general", "assistant"],
      examples: ["What can you do?", "Help me with a task"],
    },
  ];

  // Declare the app credentials this agent needs to function (ADR 0004), so an
  // attaching client (the habitats SaaS) can render a form / OAuth "Connect"
  // instead of anyone hand-setting secrets. Sourced from config.requiredSecrets.
  // (See annotateServedCredentials/effectiveCredentialMode for the serve-time
  // overlay that reconciles the declared card with live habitat state.)
  const requiredCredentials: RequiredCredential[] = (
    config.requiredSecrets ?? []
  ).map((s) => ({
    name: s.name,
    label: s.label ?? s.name,
    description: s.description,
    required: s.required,
    type: s.type ?? "secret",
    ...(s.connectPath ? { connectPath: s.connectPath } : {}),
    ...(s.scopes?.length ? { scopes: s.scopes } : {}),
  }));

  return {
    ...(requiredCredentials.length ? { requiredCredentials } : {}),
    ...(config.credentialMode ? { credentialMode: config.credentialMode } : {}),
    name,
    description,
    url: `${baseUrl}/a2a`,
    version: "1.0.0",
    protocolVersion: "0.3",
    // pushNotifications is a gate, not a hint: the SDK refuses every
    // push-notification-config call unless the card declares it, so a
    // caller cannot register a webhook against an undeclared agent no matter
    // what the server is willing to store (#275).
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text/plain"],
    // text/html+mcp advertises that tools may emit mcp-ui UI resources
    // (carried as DataParts) for a client AppRenderer (ADR 0005, #195).
    defaultOutputModes: ["text/plain", UI_OUTPUT_MODE],
    skills,
    ...(options.requiresApiKey
      ? {
          securitySchemes: {
            bearer: {
              type: "http" as const,
              scheme: "bearer",
              ...(options.jwtMode ? { bearerFormat: "JWT" as const } : {}),
              description: options.jwtMode
                ? "Per-user JWT (ADR 0003): Authorization: Bearer <JWT>, minted by the habitats SaaS and verified via its JWKS. The shared HABITAT_API_KEY is also accepted during the transition."
                : "API key as a bearer token (Authorization: Bearer <HABITAT_API_KEY>).",
            },
          },
          security: [{ bearer: [] }],
        }
      : {}),
  };
}

/**
 * Project the served (legacy-shaped) card into the v1 SDK's `AgentCard`
 * for `DefaultRequestHandler`. Declares both protocol versions on the same
 * URL so the SDK's version validation accepts v1.0 requests and defaulted
 * 0.3 requests alike.
 */
export function toV1AgentCard(card: HabitatAgentCard): AgentCard {
  const securitySchemes: AgentCard["securitySchemes"] = {};
  for (const [key, scheme] of Object.entries(card.securitySchemes ?? {})) {
    securitySchemes[key] = {
      scheme: {
        $case: "httpAuthSecurityScheme",
        value: {
          description: scheme.description ?? "",
          scheme: scheme.scheme,
          bearerFormat: scheme.bearerFormat ?? "",
        },
      },
    };
  }

  return {
    name: card.name,
    description: card.description ?? "",
    version: card.version,
    supportedInterfaces: ["1.0", "0.3"].map((protocolVersion) => ({
      url: card.url,
      protocolBinding: "JSONRPC",
      tenant: "",
      protocolVersion,
    })),
    provider: undefined,
    documentationUrl: undefined,
    capabilities: {
      streaming: card.capabilities.streaming ?? false,
      pushNotifications: card.capabilities.pushNotifications ?? false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes,
    securityRequirements: (card.security ?? []).map((req) => ({
      schemes: Object.fromEntries(
        Object.entries(req).map(([k, scopes]) => [k, { list: scopes }]),
      ),
    })),
    defaultInputModes: card.defaultInputModes,
    defaultOutputModes: card.defaultOutputModes,
    skills: card.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? "",
      tags: s.tags ?? [],
      examples: s.examples ?? [],
      inputModes: [],
      outputModes: [],
      securityRequirements: [],
    })),
    signatures: [],
    iconUrl: undefined,
  };
}

// ── Serve-time card annotation ─────────────────────────────────────
//
// The card built from config is a declaration; the served card overlays
// live habitat state. Pure functions so the container server's serving
// route stays thin and this logic is unit-testable.

export interface ServedCredentialContext {
  /** Whether the habitat's secret store holds this name (names only). */
  isSecretAvailable(name: string): boolean;
  /** Live scopes of a registered upstream connector, by provider name ("x"). */
  connectorScopes(providerName: string): string[] | undefined;
}

/** "/connect/x" → "x" (undefined when the path has no provider segment). */
export function connectorNameFromPath(
  connectPath: string,
): string | undefined {
  return connectPath.split("/").filter(Boolean)[1];
}

/**
 * Annotate declared credentials with live state:
 * - `configured`: the habitat already holds this secret (never values).
 * - oauth `scopes`: filled from the registered connector when the config
 *   didn't declare them — the connect flow requests exactly the
 *   connector's scopes, so the card says so even for configs seeded
 *   before the scopes field existed. Declared scopes win.
 */
export function annotateServedCredentials(
  declared: RequiredCredential[],
  ctx: ServedCredentialContext,
): RequiredCredential[] {
  return declared.map((c) => {
    const annotated: RequiredCredential = {
      ...c,
      configured: ctx.isSecretAvailable(c.name),
    };
    if (c.type === "oauth" && !c.scopes?.length && c.connectPath) {
      const provider = connectorNameFromPath(c.connectPath);
      const scopes = provider ? ctx.connectorScopes(provider) : undefined;
      if (scopes?.length) annotated.scopes = [...scopes];
    }
    return annotated;
  });
}

/**
 * The credential policy the served card should advertise. Explicit config
 * always wins; otherwise a habitat with a per-user connect surface (an
 * oauth credential + a registered connector) advertises "hybrid" — the
 * per-user token stores' enforcement default (per-user token with
 * shared-operator fallback). Without this, fleet volumes seeded before
 * credentialMode existed would advertise no policy while enforcing one.
 */
export function effectiveCredentialMode(
  declaredMode: HabitatAgentCard["credentialMode"],
  credentials: RequiredCredential[] | undefined,
  hasConnectors: boolean,
): HabitatAgentCard["credentialMode"] {
  if (declaredMode) return declaredMode;
  if (hasConnectors && credentials?.some((c) => c.type === "oauth")) {
    return "hybrid";
  }
  return undefined;
}

// ── Agent executor (bridges A2A → ChannelBridge) ──────────────────

interface ActiveTask {
  controller: AbortController;
  contextId: string;
}

export class HabitatAgentExecutor implements AgentExecutor {
  private bridge: ChannelBridge;
  private habitat: AgentHost;
  /**
   * Active runs by taskId — the minimal in-memory store that lets
   * tasks/cancel abort an in-flight Interaction. Entries are removed
   * when the run settles (done, error, or canceled).
   */
  private activeTasks = new Map<string, ActiveTask>();

  /**
   * Resolve the agent's public origin at emit time (#194). The artifact build
   * runs mid-stream with no inbound request in hand, so the container server
   * threads a resolver that reads the most recent request's public origin
   * (X-Forwarded-* / BASE_URL / Host, via getPublicBaseUrl). Undefined → emit
   * the stored relative URL unchanged (back-compat / local dev).
   */
  private resolvePublicOrigin?: () => string | undefined;

  /**
   * What this habitat's answers are computed from (#277). Cached because it
   * goes on every answer and reading it shells out to git once per repo —
   * for the rollup habitat, the one with the most mounts, that is the
   * difference between a fact and a cost.
   */
  private provenance: ProvenanceCache;

  constructor(
    habitat: AgentHost,
    bridge: ChannelBridge,
    resolvePublicOrigin?: () => string | undefined,
  ) {
    this.habitat = habitat;
    this.bridge = bridge;
    this.resolvePublicOrigin = resolvePublicOrigin;
    this.provenance = new ProvenanceCache(() =>
      readHabitatProvenance({
        workDir: habitat.getWorkDir(),
        config: habitat.getConfig(),
        probe: realProvenanceProbe,
      }),
    );
  }

  /**
   * Never throws: provenance is context on a result, not the result. A
   * habitat that cannot describe its checkout must still be able to answer —
   * the caller then sees provenance absent, which is itself informative and
   * distinct from provenance claiming everything is current.
   */
  private async readProvenance(): Promise<HabitatProvenance | undefined> {
    try {
      return await this.provenance.get();
    } catch {
      return undefined;
    }
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { userMessage, taskId, contextId } = requestContext;

    const text = messageText(userMessage);

    if (!text.trim()) {
      // A Message event terminates the stream (v1 rule) and satisfies the
      // "first event is task or message" contract for this degenerate turn.
      eventBus.publish(
        AgentEvent.message(
          agentMessage({ text: "No text content received.", taskId, contextId }),
        ),
      );
      eventBus.finished();
      return;
    }

    // The v1 executor contract: every call MUST publish a `task` or
    // `message` event first — including follow-up turns where the Task
    // already exists. Publishing the snapshot keeps the request handler's
    // task store tracking this run; without a Task record, tasks/cancel
    // returns taskNotFound and the working status-updates below are
    // dropped as "unknown task".
    const initialTask: Task = requestContext.task ?? {
      id: taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        message: undefined,
        timestamp: new Date().toISOString(),
      },
      artifacts: [],
      history: [userMessage],
      metadata: undefined,
    };
    eventBus.publish(AgentEvent.task(initialTask));

    // contextId = the thread (session continuity); the verified speaker =
    // who is talking *this* turn (ADR 0003 step 2). One thread, many speakers.
    const channelKey = `a2a:${contextId}`;
    const speaker = getSpeaker();
    // Fall back to the thread id as identity only when unauthenticated
    // (dev/open or legacy bearer) — there is no per-user `sub` to use.
    const userId = speaker?.userId ?? `a2a:${contextId}`;

    const controller = new AbortController();
    this.activeTasks.set(taskId, { controller, contextId });

    // Rehydrate the caller's agent-call chain (ADR 0008). The in-process
    // guard follows the async call tree and stops at the container boundary,
    // so without this a cross-container cycle starts fresh at every hop and
    // runs forever — and output caps are not an available mitigation here.
    // The chain is untrusted: it can only ever cause work to be refused.
    const inboundChain = extendAgentChain(
      decodeAgentChain(userMessage.metadata as Record<string, unknown> | undefined),
      this.habitat.getConfig?.()?.name,
    );

    try {
      await withInboundAgentCallChain(inboundChain, async () =>
        this.bridge.handleMessage(
        { channelKey, text, userId, displayName: speaker?.displayName },
        {
          onText: (delta) => {
            // Emit working status with incremental text. Non-terminal, so
            // the v1 queue keeps streaming.
            eventBus.publish(
              AgentEvent.statusUpdate({
                taskId,
                contextId,
                status: {
                  state: TaskState.TASK_STATE_WORKING,
                  timestamp: new Date().toISOString(),
                  message: agentMessage({ text: delta, taskId, contextId }),
                },
                metadata: undefined,
              }),
            );
          },
          onToolCall: (_name, _input) => {
            // Optionally emit status updates for tool calls
          },
          onToolResult: (_name, _output, _isError) => {
            // Optionally emit status updates for tool results
          },
          onDone: async (result) => {
            // Check for published artifacts
            const artifacts = await this.buildA2AArtifacts();

            // Drain any UI resources this turn emitted (ADR 0005 slice B, #195)
            // and carry them as DataParts in the response message.
            const uiParts = await this.buildA2AUIResourceParts();

            const responseParts: Part[] = [
              textPart(result.content),
              ...uiParts,
            ];

            // Per-run usage so downstream consumers can record cost
            // without a side channel (issue #117).
            const usageMetadata = result.metadata
              ? {
                  usage: {
                    promptTokens: result.metadata.tokenUsage.promptTokens,
                    completionTokens: result.metadata.tokenUsage.completionTokens,
                    totalTokens: result.metadata.tokenUsage.total,
                  },
                  provider: result.metadata.provider,
                  model: result.metadata.model,
                }
              : undefined;

            // What this answer was computed from (#277). Structured, on the
            // same metadata channel as usage, because prose provenance gets
            // summarised away by the next model in the chain — and a rollup
            // that cannot tell a current habitat from a three-week-stale one
            // is confidently wrong in a way nobody notices.
            const provenance = await this.readProvenance();
            const answerMetadata =
              usageMetadata || provenance
                ? { ...usageMetadata, ...(provenance ? { provenance } : {}) }
                : undefined;

            // Artifacts BEFORE the terminal status: in the v1 event model a
            // terminal status update ends the stream, so anything published
            // after it never reaches the wire. (Same hazard as the 0.3-era
            // message-terminates-stream behavior, verified against live SSE
            // 2026-07-11 — artifact frames after the terminator were
            // silently dropped.)
            for (const artifact of artifacts) {
              eventBus.publish(
                AgentEvent.artifactUpdate({
                  taskId,
                  contextId,
                  artifact,
                  append: false,
                  lastChunk: true,
                  metadata: undefined,
                }),
              );
            }

            // The terminal status update ends the stream and carries the
            // reply in `status.message` (the v1 idiom — there is no
            // separate final Message event anymore). This is what moves the
            // stored Task off `working`: without it a caller polling
            // `tasks/get` (ADR 0007) waits out its whole timeout on work
            // that finished, and a later boot sweep reports the answered
            // Task as abandoned.
            eventBus.publish(
              AgentEvent.statusUpdate({
                taskId,
                contextId,
                status: {
                  state: TaskState.TASK_STATE_COMPLETED,
                  timestamp: new Date().toISOString(),
                  message: agentMessage({
                    parts: responseParts,
                    taskId,
                    contextId,
                    ...(answerMetadata ? { metadata: answerMetadata } : {}),
                  }),
                },
                metadata: undefined,
              }),
            );

            eventBus.finished();
          },
          onError: (error) => {
            // A canceled run surfaces as an abort error — cancelTask already
            // emitted the canceled status, so don't follow it with an error.
            if (controller.signal.aborted) return;
            // The failure is recorded on the Task itself, with the error
            // text as the status message — one terminal event, same as the
            // success path.
            eventBus.publish(
              AgentEvent.statusUpdate({
                taskId,
                contextId,
                status: {
                  state: TaskState.TASK_STATE_FAILED,
                  timestamp: new Date().toISOString(),
                  message: agentMessage({
                    text: `Error: ${error}`,
                    taskId,
                    contextId,
                  }),
                },
                metadata: undefined,
              }),
            );
            eventBus.finished();
          },
        },
        controller.signal,
      ),
      );
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const active = this.activeTasks.get(taskId);
    if (active) {
      active.controller.abort();
      this.activeTasks.delete(taskId);
    }
    // Terminal state — ends the stream under the v1 model.
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: active?.contextId ?? "",
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }),
    );
    eventBus.finished();
  }

  /** Drain this turn's emitted UI resources and normalize them to A2A parts. */
  private async buildA2AUIResourceParts(): Promise<Part[]> {
    const resources = await drainUIResources(this.habitat.getWorkDir());
    return resources.map(uiResourceToA2APart);
  }

  /** Convert published habitat artifacts to A2A Artifact format. */
  private async buildA2AArtifacts(): Promise<Artifact[]> {
    const metas = await listArtifacts(this.habitat.getWorkDir());
    return metas.map((meta, index) => this.metaToA2AArtifact(meta, index));
  }

  private metaToA2AArtifact(meta: ArtifactMeta, index: number): Artifact {
    // Absolutize the stored relative URL against the resolved public origin so
    // the file part's URL resolves for off-origin consumers (SaaS, Gaia) — #194.
    const uri = toAbsoluteArtifactUrl(meta.url, this.resolvePublicOrigin?.());
    const parts: Part[] = [filePart(uri, meta.mimeType, meta.name)];

    if (meta.description) {
      parts.push(textPart(meta.description));
    }

    return {
      artifactId: `artifact-${index}`,
      name: meta.name,
      description: meta.description ?? "",
      parts,
      metadata: undefined,
      extensions: [],
    };
  }
}

// ── Handler factory ───────────────────────────────────────────────

export interface A2AHandlerOptions {
  habitat: AgentHost;
  bridge: ChannelBridge;
  baseUrl: string;
  name?: string;
  description?: string;
  /** Declare bearer auth in the agent card (set iff /a2a enforces an API key). */
  requiresApiKey?: boolean;
  /** Advertise per-user JWT capability (bearerFormat: JWT) — jwt/jwt+bearer mode. */
  jwtMode?: boolean;
  /**
   * Resolve the agent's public origin at artifact-emit time (#194). The
   * container server passes a getter over the most recent request's resolved
   * origin so emitted FilePart URIs are absolute. Omit → relative URLs.
   */
  resolvePublicOrigin?: () => string | undefined;
}

/**
 * Returned shape kept stable for `container-server.ts` and any external
 * consumers: the **served** (legacy-shaped) agent card for the well-known
 * endpoint plus the dual-dialect JSON-RPC transport handler for `/a2a`.
 */
export interface A2AHandler extends Omit<A2AServer, "agentCard"> {
  agentCard: HabitatAgentCard;
}

/**
 * Where a habitat keeps its durable Tasks on its own volume (ADR 0007).
 * Exported because the container's activity endpoint reads the same store to
 * report what the habitat is holding (#278) — one definition, not two.
 */
export function habitatTaskDir(workDir: string): string {
  return join(workDir, "tasks");
}

export async function createA2AHandler(
  options: A2AHandlerOptions,
): Promise<A2AHandler> {
  const agentCard = await buildAgentCard({
    baseUrl: options.baseUrl,
    habitat: options.habitat,
    name: options.name,
    description: options.description,
    requiresApiKey: options.requiresApiKey,
    jwtMode: options.jwtMode,
  });

  const executor = new HabitatAgentExecutor(
    options.habitat,
    options.bridge,
    options.resolvePublicOrigin,
  );

  // Tasks live on the habitat's volume, not in memory, so they survive the
  // container being stopped — which is routine once habitats sleep while idle
  // (ADR 0007). Then clear out anything the previous container generation left
  // mid-flight, BEFORE the transport starts accepting requests, so no caller
  // can observe a task that is about to be moved.
  const taskStore = new FileTaskStore({ dir: habitatTaskDir(options.habitat.getWorkDir()) });

  // Webhook registrations live on the volume for the same reason Tasks do, and
  // with sharper consequences: a registration lost on restart leaves the caller
  // believing it will be told when the work finishes, waiting on a webhook
  // nobody will call (#275).
  const pushNotificationStore = new FilePushNotificationStore({
    dir: join(options.habitat.getWorkDir(), "push-notifications"),
  });

  const recovered = await sweepAbandonedTasks(taskStore);
  if (recovered.swept.length > 0) {
    console.log(
      `[a2a] Recovered ${recovered.swept.length} task(s) abandoned when the habitat last stopped: ${recovered.swept.join(", ")}`,
    );
  }

  const server = createA2AServer({
    agentCard: toV1AgentCard(agentCard),
    executor,
    taskStore,
    pushNotificationStore,
  });

  // The sweep moves Tasks by writing to the store, which the request handler
  // never sees — so nothing notifies the caller who asked to be told. Dispatch
  // those transitions here, after the server exists and before it serves: a
  // caller that registered a webhook and went away learns its run died with
  // the container instead of waiting on a Task that will never move again.
  if (recovered.swept.length > 0) {
    const notified = await notifySweptTasks(
      taskStore,
      server.pushNotificationSender,
      recovered.swept,
      {
        onError: (taskId, error) =>
          console.warn(
            `[a2a] Push notification for recovered task ${taskId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
      },
    );
    if (notified.length > 0) {
      console.log(
        `[a2a] Notified webhooks for ${notified.length} recovered task(s).`,
      );
    }
  }

  return { ...server, agentCard };
}
