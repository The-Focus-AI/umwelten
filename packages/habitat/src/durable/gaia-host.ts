/**
 * GaiaHost — Single-process `pi-durable` Multi-Habitat Host & Control Plane.
 *
 * Replaces the legacy Docker-out-of-Docker Gaia container orchestrator with
 * lazy-opened, idle-evicted SQLite `DurableHabitat` instances on a single Node
 * HTTP server, dual `jwt + bearer` authentication (`GAIA_JWKS_URL` +
 * comma-separated `GAIA_API_KEY`), a root `"gaia"` A2A 1.0 orchestrator agent,
 * and a declarative `/api/habitats` control plane.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { MutableModels } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";
import {
  getPiModels,
  listMycelModels,
  registerMycelProviderOn,
  type ExecutableTool,
} from "@umwelten/pi";
import { DurableHabitat, HabitatHost } from "./durable-habitat.js";
import type { DurableScheduleSpec } from "./extensions.js";

const HABITAT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

export function assertValidHabitatId(id: string): string {
  const trimmed = id.trim();
  if (!HABITAT_ID_RE.test(trimmed)) {
    throw new Error(
      `Invalid habitat id "${id}". Expected 1-63 alphanumeric, '.', '_', or '-' characters.`,
    );
  }
  return trimmed;
}

export function parseBearerKeys(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export interface AuthenticatedCaller {
  kind: "bearer" | "jwt";
  speakerId: string;
  isAdmin: boolean;
}

export interface GaiaAuthOptions {
  apiKeys?: string[];
  jwksUrl?: string;
  /** Optional custom JWKS resolver (used in offline tests). */
  keySet?: JWTVerifyGetKey;
  audiences?: string[];
}

export interface GaiaAuthenticator {
  mode: "jwt+bearer" | "bearer" | "jwt" | "open";
  hasAuth: boolean;
  bearerFormat?: "JWT";
  verifyRequest: (
    req: IncomingMessage,
    extraAudiences?: string[],
  ) => Promise<AuthenticatedCaller | undefined>;
}

export function createGaiaAuthenticator(options: GaiaAuthOptions = {}): GaiaAuthenticator {
  const keyDigests = (options.apiKeys ?? []).map(sha256);
  const hasBearer = keyDigests.length > 0;
  const hasJwt = Boolean(options.jwksUrl || options.keySet);
  const jwks: JWTVerifyGetKey | undefined =
    options.keySet ??
    (options.jwksUrl ? createRemoteJWKSet(new URL(options.jwksUrl)) : undefined);

  const mode: GaiaAuthenticator["mode"] =
    hasJwt && hasBearer
      ? "jwt+bearer"
      : hasBearer
        ? "bearer"
        : hasJwt
          ? "jwt"
          : "open";

  return {
    mode,
    hasAuth: mode !== "open",
    bearerFormat: hasJwt ? "JWT" : undefined,
    async verifyRequest(
      req: IncomingMessage,
      extraAudiences: string[] = [],
    ): Promise<AuthenticatedCaller | undefined> {
      const header = req.headers.authorization;
      if (!header) return undefined;
      const match = header.match(/^Bearer\s+(.+)$/i);
      if (!match) return undefined;
      const token = match[1].trim();
      if (!token) return undefined;

      // 1. Check static operator bearer keys (constant-time SHA-256 comparison)
      if (hasBearer) {
        const candidateDigest = sha256(token);
        for (const digest of keyDigests) {
          if (timingSafeEqual(candidateDigest, digest)) {
            return { kind: "bearer", speakerId: "operator", isAdmin: true };
          }
        }
      }

      // 2. Check per-speaker signed JWT when JWKS is configured and token is 3-part JWS
      if (jwks && token.split(".").length === 3) {
        try {
          const allAudiences = Array.from(
            new Set(
              [...(options.audiences ?? []), ...extraAudiences]
                .map((a) => a.trim().replace(/\/$/, ""))
                .filter(Boolean),
            ),
          );
          const expandedAudiences = allAudiences.flatMap((a) => [a, `${a}/`]);
          const { payload } = await jwtVerify(token, jwks, {
            ...(expandedAudiences.length > 0 ? { audience: expandedAudiences } : {}),
          });
          const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
          if (!sub) return undefined;
          const org =
            (typeof payload.org_id === "string" && payload.org_id.trim()) ||
            (typeof payload.iss === "string" && payload.iss.trim()) ||
            "jwt";
          const isAdmin =
            payload.role === "admin" || payload.scope === "gaia:admin";
          return {
            kind: "jwt",
            speakerId: `jwt:${org}:${sub}`,
            isAdmin,
          };
        } catch {
          return undefined;
        }
      }

      return undefined;
    },
  };
}

export interface StoredHabitatDeclaration {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  model?: ModelRef;
  enableLocalTools?: boolean;
  ownedRepoRoot?: string;
  mountedReadOnlyRoots?: string[];
  schedules?: DurableScheduleSpec[];
  createdAt: string;
  updatedAt: string;
}

export interface GaiaHostOptions {
  /** Root directory storing `habitats-registry.json` and `habitats/<id>/habitat.sqlite`. */
  dataDir: string;
  /** Default model for Gaia and newly created Habitats (`{ provider, modelId }`). */
  defaultModel?: ModelRef;
  /** Public HTTPS origin of Gaia itself (e.g. `https://gaia.habitats.thefocus.ai`). */
  publicUrl?: string;
  /** Optional wildcard base domain for `<id>.<baseDomain>` subdomain routing. */
  baseDomain?: string;
  /** Comma-separated or array of static operator bearer API keys. */
  apiKeys?: string[];
  /** Optional JWKS URL for per-speaker JWT authentication. */
  jwksUrl?: string;
  /** Optional custom JWKS keySet (offline tests). */
  keySet?: JWTVerifyGetKey;
  /** Explicit expected JWT audience(s). */
  authAudiences?: string[];
  /** Idle eviction window in milliseconds (default: 10 min). */
  idleEvictMs?: number;
  /** Optional custom `MutableModels` factory. */
  modelsFactory?: (habitatId: string) => MutableModels;
}

const UpsertHabitatSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  enableLocalTools: z.boolean().optional(),
  ownedRepoRoot: z.string().optional(),
  mountedReadOnlyRoots: z.array(z.string()).optional(),
  schedules: z
    .array(
      z.object({
        id: z.string(),
        cron: z.string(),
        prompt: z.string(),
        enabled: z.boolean().optional(),
      }),
    )
    .optional(),
});

async function readJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("Request body exceeds maximum size");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export class GaiaHost {
  readonly dataDir: string;
  readonly habitatsDir: string;
  readonly registryPath: string;
  readonly defaultModel: ModelRef;
  readonly auth: GaiaAuthenticator;
  readonly host: HabitatHost;
  private readonly publicUrl?: string;
  private readonly gaiaHostHeader?: string;
  private readonly baseDomain?: string;
  private readonly declarations = new Map<string, StoredHabitatDeclaration>();
  private readonly a2aSurfaces = new Map<
    string,
    (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
  >();
  private readonly startedAt = Date.now();
  private readonly evictTimer: ReturnType<typeof setInterval>;

  private constructor(params: {
    dataDir: string;
    habitatsDir: string;
    registryPath: string;
    defaultModel: ModelRef;
    auth: GaiaAuthenticator;
    host: HabitatHost;
    publicUrl?: string;
    baseDomain?: string;
  }) {
    this.dataDir = params.dataDir;
    this.habitatsDir = params.habitatsDir;
    this.registryPath = params.registryPath;
    this.defaultModel = params.defaultModel;
    this.auth = params.auth;
    this.host = params.host;
    this.publicUrl = params.publicUrl?.replace(/\/$/, "");
    this.gaiaHostHeader = this.publicUrl
      ? new URL(this.publicUrl).hostname.toLowerCase()
      : undefined;
    this.baseDomain = params.baseDomain?.trim().toLowerCase().replace(/^\./, "") || undefined;

    this.evictTimer = setInterval(() => {
      void this.host.evictIdle().catch(() => undefined);
    }, 60_000);
    this.evictTimer.unref?.();
  }

  static async open(options: GaiaHostOptions): Promise<GaiaHost> {
    const dataDir = resolve(options.dataDir);
    const habitatsDir = join(dataDir, "habitats");
    const registryPath = join(dataDir, "habitats-registry.json");
    await mkdir(habitatsDir, { recursive: true });

    const defaultModel: ModelRef = options.defaultModel ?? {
      provider: process.env.GAIA_PROVIDER || "mycel",
      modelId: process.env.GAIA_MODEL || "default",
    };

    if (!options.modelsFactory) {
      const shared = getPiModels();
      if (
        defaultModel.provider === "mycel" ||
        process.env.MYCEL_API_KEY ||
        process.env.MYCEL_URL
      ) {
        await registerMycelProviderOn(shared, {
          extraModelIds: [defaultModel.modelId],
        });
      }
    }

    const publicUrl = options.publicUrl?.replace(/\/$/, "");
    const audiences = [
      ...(options.authAudiences ?? []),
      ...(publicUrl ? [publicUrl] : []),
    ];

    const auth = createGaiaAuthenticator({
      apiKeys: options.apiKeys,
      jwksUrl: options.jwksUrl,
      keySet: options.keySet,
      audiences,
    });

    const host = new HabitatHost({
      dataDir: habitatsDir,
      defaultModel,
      idleEvictMs: options.idleEvictMs,
      modelsFactory: options.modelsFactory,
    });

    const gaia = new GaiaHost({
      dataDir,
      habitatsDir,
      registryPath,
      defaultModel,
      auth,
      host,
      publicUrl,
      baseDomain: options.baseDomain,
    });

    await gaia.loadRegistryFromDisk();
    gaia.registerRootGaiaOrchestrator();
    return gaia;
  }

  private async loadRegistryFromDisk(): Promise<void> {
    if (existsSync(this.registryPath)) {
      try {
        const raw = JSON.parse(await readFile(this.registryPath, "utf8")) as {
          habitats?: StoredHabitatDeclaration[];
        };
        for (const decl of raw.habitats ?? []) {
          if (!decl?.id || decl.id === "gaia") continue;
          this.declarations.set(decl.id, decl);
          this.applyDeclarationToHost(decl);
        }
      } catch {
        // Ignore corrupt/empty registry and rebuild on next mutation
      }
    }

    // Discover pre-existing SQLite directories under `<dataDir>/habitats/<id>/habitat.sqlite`
    const entries = await readdir(this.habitatsDir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name === "gaia") continue;
      if (!HABITAT_ID_RE.test(ent.name) || this.declarations.has(ent.name)) continue;
      if (existsSync(join(this.habitatsDir, ent.name, "habitat.sqlite"))) {
        const now = new Date().toISOString();
        const discovered: StoredHabitatDeclaration = {
          id: ent.name,
          name: ent.name,
          createdAt: now,
          updatedAt: now,
        };
        this.declarations.set(ent.name, discovered);
        this.applyDeclarationToHost(discovered);
      }
    }
  }

  private async saveRegistryToDisk(): Promise<void> {
    const tmp = `${this.registryPath}.tmp.${process.pid}`;
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      habitats: Array.from(this.declarations.values()).sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    };
    await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await rename(tmp, this.registryPath);
  }

  private publicOriginFor(id: string, reqOrigin?: string): string {
    const base = this.publicUrl ?? reqOrigin ?? "http://127.0.0.1:7420";
    if (id === "gaia") return base;
    if (this.baseDomain) {
      return `https://${id}.${this.baseDomain}`;
    }
    return `${base}/habitats/${encodeURIComponent(id)}`;
  }

  private applyDeclarationToHost(decl: StoredHabitatDeclaration): void {
    this.host.register(decl.id, {
      name: decl.name || decl.id,
      description: decl.description,
      instructions: decl.instructions,
      model: decl.model ?? this.defaultModel,
      env: decl.enableLocalTools ? "local" : undefined,
      ownedRepoRoot: decl.ownedRepoRoot,
      mountedReadOnlyRoots: decl.mountedReadOnlyRoots,
      schedules: decl.schedules,
      publicOrigin: this.publicOriginFor(decl.id),
    });
  }

  private registerRootGaiaOrchestrator(): void {
    const tools: Record<string, ExecutableTool> = {
      host_status: {
        description:
          "Inspect Gaia host status, auth mode, default model, memory usage, and warm vs. sleeping DurableHabitats.",
        inputSchema: z.object({}),
        execute: () => ({
          status: "ok",
          runtime: "pi-durable",
          uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
          auth: this.auth.mode,
          defaultModel: `${this.defaultModel.provider}/${this.defaultModel.modelId}`,
          registeredHabitats: this.declarations.size,
          openHabitats: this.host.listOpenIds(),
          memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        }),
      },
      list_models: {
        description:
          "List available models on the configured Mycel Exchange and built-in fast Pi providers.",
        inputSchema: z.object({
          search: z.string().optional(),
        }),
        execute: async ({ search }: { search?: string }) => {
          const q = search?.trim().toLowerCase() ?? "";
          let mycel: Array<{ provider: string; id: string; promptPerM?: number; completionPerM?: number }> = [];
          if (process.env.MYCEL_API_KEY || process.env.MYCEL_URL) {
            try {
              const cat = await listMycelModels(
                process.env.MYCEL_API_KEY,
                process.env.MYCEL_URL,
              );
              mycel = cat.map((m) => ({
                provider: "mycel",
                id: m.name,
                promptPerM: m.costs?.promptTokens,
                completionPerM: m.costs?.completionTokens,
              }));
            } catch {
              // ignore transient network failure
            }
          }
          const filtered = q
            ? mycel.filter((m) => m.id.toLowerCase().includes(q))
            : mycel;
          return { mycelModels: filtered, defaultModel: this.defaultModel };
        },
      },
      list_habitats: {
        description:
          "List all DurableHabitats registered on this Gaia host without waking sleeping SQLite instances.",
        inputSchema: z.object({}),
        execute: () => ({
          habitats: this.listHabitats(),
        }),
      },
      upsert_habitat: {
        description:
          "Create or update a declarative SQLite-backed DurableHabitat on this Gaia host.",
        inputSchema: UpsertHabitatSchema,
        execute: async (args: z.infer<typeof UpsertHabitatSchema>) =>
          this.upsertHabitat(args),
      },
      ask_habitat: {
        description:
          "Send a prompt directly to a hosted DurableHabitat in-process and return its committed response.",
        inputSchema: z.object({
          id: z.string().min(1),
          prompt: z.string().min(1),
        }),
        execute: async ({ id, prompt }: { id: string; prompt: string }) => {
          const cleanId = assertValidHabitatId(id);
          const hab = await this.host.get(cleanId);
          const ans = await hab.ask(prompt);
          return { id: cleanId, text: ans.text, answerEntryId: ans.answerEntryId };
        },
      },
      delete_habitat: {
        description:
          "Close and unregister a Habitat declaration from Gaia (keeps SQLite file on disk unless purgeStorage is true).",
        inputSchema: z.object({
          id: z.string().min(1),
          purgeStorage: z.boolean().optional(),
        }),
        execute: async ({
          id,
          purgeStorage,
        }: {
          id: string;
          purgeStorage?: boolean;
        }) => this.deleteHabitat(id, Boolean(purgeStorage)),
      },
    };

    const instructions = [
      "You are Gaia, the pi-durable Multi-Habitat Host orchestrator.",
      `Default model: ${this.defaultModel.provider}/${this.defaultModel.modelId}.`,
      "All Habitats on this host are transactional SQLite-backed DurableHabitats multiplexed in one process (no child Docker containers).",
      "Sleeping Habitats consume zero RAM; do not wake them via ask_habitat merely to inventory them — use host_status and list_habitats first.",
      "Never use deprecated gemini-2 models; always use gemini-3.x+ or gemini-4 models, or call list_models to check live Mycel offers.",
    ].join("\n");

    this.host.register("gaia", {
      name: "Gaia HabitatHost",
      description: "Multi-Habitat pi-durable orchestrator and A2A 1.0 gateway",
      instructions,
      model: this.defaultModel,
      tools,
      publicOrigin: this.publicOriginFor("gaia"),
    });
  }

  listHabitats(reqOrigin?: string) {
    const openSet = new Set(this.host.listOpenIds());
    return Array.from(this.declarations.values())
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => {
        const origin = this.publicOriginFor(d.id, reqOrigin);
        return {
          ...d,
          model: d.model ?? this.defaultModel,
          open: openSet.has(d.id),
          publicOrigin: origin,
          agentCardUrl: `${origin}/.well-known/agent-card.json`,
          a2aUrl: `${origin}/a2a`,
        };
      });
  }

  async upsertHabitat(
    input: z.infer<typeof UpsertHabitatSchema>,
    reqOrigin?: string,
  ) {
    const id = assertValidHabitatId(input.id);
    if (id.toLowerCase() === "gaia") {
      throw new Error('Habitat id "gaia" is reserved for the host orchestrator.');
    }
    const existing = this.declarations.get(id);
    const now = new Date().toISOString();
    const model: ModelRef | undefined =
      input.provider || input.model
        ? {
            provider:
              input.provider ?? existing?.model?.provider ?? this.defaultModel.provider,
            modelId:
              input.model ?? existing?.model?.modelId ?? this.defaultModel.modelId,
          }
        : existing?.model;

    const next: StoredHabitatDeclaration = {
      id,
      name: input.name ?? existing?.name ?? id,
      ...(input.description !== undefined
        ? { description: input.description }
        : existing?.description !== undefined
          ? { description: existing.description }
          : {}),
      ...(input.instructions !== undefined
        ? { instructions: input.instructions }
        : existing?.instructions !== undefined
          ? { instructions: existing.instructions }
          : {}),
      ...(model ? { model } : {}),
      ...(input.enableLocalTools !== undefined
        ? { enableLocalTools: input.enableLocalTools }
        : existing?.enableLocalTools !== undefined
          ? { enableLocalTools: existing.enableLocalTools }
          : {}),
      ...(input.ownedRepoRoot !== undefined
        ? { ownedRepoRoot: input.ownedRepoRoot }
        : existing?.ownedRepoRoot !== undefined
          ? { ownedRepoRoot: existing.ownedRepoRoot }
          : {}),
      ...(input.mountedReadOnlyRoots !== undefined
        ? { mountedReadOnlyRoots: input.mountedReadOnlyRoots }
        : existing?.mountedReadOnlyRoots !== undefined
          ? { mountedReadOnlyRoots: existing.mountedReadOnlyRoots }
          : {}),
      ...(input.schedules !== undefined
        ? { schedules: input.schedules }
        : existing?.schedules !== undefined
          ? { schedules: existing.schedules }
          : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.declarations.set(id, next);
    this.a2aSurfaces.delete(id);
    await this.host.closeOne(id);
    this.applyDeclarationToHost(next);
    await this.saveRegistryToDisk();

    return this.listHabitats(reqOrigin).find((h) => h.id === id)!;
  }

  async deleteHabitat(id: string, purgeStorage = false): Promise<{ deleted: boolean; id: string }> {
    const cleanId = assertValidHabitatId(id);
    if (cleanId.toLowerCase() === "gaia") {
      throw new Error('Cannot delete reserved orchestrator Habitat "gaia".');
    }
    const existed = this.declarations.delete(cleanId);
    this.a2aSurfaces.delete(cleanId);
    await this.host.closeOne(cleanId);
    this.host.unregister(cleanId);
    await this.saveRegistryToDisk();

    if (purgeStorage) {
      await rm(join(this.habitatsDir, cleanId), { recursive: true, force: true });
    }
    return { deleted: existed, id: cleanId };
  }

  private async getA2ASurface(
    id: string,
    reqOrigin: string,
  ): Promise<(req: IncomingMessage, res: ServerResponse) => Promise<boolean>> {
    const key = `${id}::${this.publicOriginFor(id, reqOrigin)}`;
    const cached = this.a2aSurfaces.get(key);
    if (cached) return cached;

    if (id !== "gaia" && !this.declarations.has(id)) {
      const now = new Date().toISOString();
      const autoDecl: StoredHabitatDeclaration = {
        id,
        name: `Habitat ${id}`,
        createdAt: now,
        updatedAt: now,
      };
      this.declarations.set(id, autoDecl);
      this.applyDeclarationToHost(autoDecl);
      await this.saveRegistryToDisk();
    }

    const habitat: DurableHabitat = await this.host.get(id);
    const origin = this.publicOriginFor(id, reqOrigin);
    const surface = habitat.createA2ASurface({
      endpointUrl: `${origin}/a2a`,
      bearerFormat: this.auth.bearerFormat,
      allowUnauthenticatedLoopback: !this.auth.hasAuth,
      authenticate: this.auth.hasAuth
        ? async (req) => {
            const pathOnly = (req.url ?? "/").split("?")[0];
            if (
              (req.method ?? "GET").toUpperCase() === "GET" &&
              pathOnly === "/.well-known/agent-card.json"
            ) {
              return "public-discovery";
            }
            const caller = await this.auth.verifyRequest(req, [origin]);
            return caller?.speakerId;
          }
        : undefined,
    });
    this.a2aSurfaces.set(key, surface.httpHandler);
    return surface.httpHandler;
  }

  private resolveSubdomainHabitat(hostHeader?: string): string | undefined {
    if (!this.baseDomain || !hostHeader) return undefined;
    const hostname = hostHeader.split(":")[0].trim().toLowerCase();
    if (!hostname || hostname === this.gaiaHostHeader) return undefined;
    const suffix = `.${this.baseDomain}`;
    if (!hostname.endsWith(suffix)) return undefined;
    const sub = hostname.slice(0, -suffix.length);
    if (!sub || sub.includes(".") || !HABITAT_ID_RE.test(sub)) return undefined;
    return sub;
  }

  private async requireAdminAuth(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<AuthenticatedCaller | undefined> {
    if (!this.auth.hasAuth) {
      return { kind: "bearer", speakerId: "open-local", isAdmin: true };
    }
    const caller = await this.auth.verifyRequest(req);
    if (!caller || (caller.kind === "jwt" && !caller.isAdmin)) {
      sendJson(
        res,
        401,
        { error: "Unauthorized" },
        { "www-authenticate": "Bearer" },
      );
      return undefined;
    }
    return caller;
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
      "http";
    const hostHdr = req.headers.host || "127.0.0.1:7420";
    const reqOrigin = `${proto}://${hostHdr}`;
    const url = new URL(req.url ?? "/", reqOrigin);
    const method = (req.method ?? "GET").toUpperCase();

    // 1. Subdomain routing (`https://<id>.<GAIA_BASE_DOMAIN>/{.well-known/agent-card.json,a2a,health}`)
    const effectiveHost =
      (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ||
      req.headers.host;
    const subdomainId = this.resolveSubdomainHabitat(effectiveHost);
    if (subdomainId) {
      if (url.pathname === "/health") {
        sendJson(res, 200, {
          status: "ok",
          id: subdomainId,
          runtime: "pi-durable",
          open: this.host.listOpenIds().includes(subdomainId),
        });
        return;
      }
      const handler = await this.getA2ASurface(subdomainId, reqOrigin);
      const handled = await handler(req, res);
      if (!handled) sendJson(res, 404, { error: "Not found" });
      return;
    }

    // 2. Host health check (`GET /health`)
    if (url.pathname === "/health" && method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        name: "Gaia HabitatHost",
        runtime: "pi-durable",
        auth: this.auth.mode,
        model: `${this.defaultModel.provider}/${this.defaultModel.modelId}`,
        registeredHabitats: this.declarations.size,
        openHabitats: this.host.listOpenIds(),
      });
      return;
    }

    // 3. Control-plane REST API (`/api/habitats*`)
    if (url.pathname === "/api/habitats" || url.pathname.startsWith("/api/habitats/")) {
      const caller = await this.requireAdminAuth(req, res);
      if (!caller) return;

      if (url.pathname === "/api/habitats") {
        if (method === "GET") {
          sendJson(res, 200, { habitats: this.listHabitats(reqOrigin) });
          return;
        }
        if (method === "POST") {
          try {
            const parsed = UpsertHabitatSchema.parse(await readJsonBody(req));
            const habitat = await this.upsertHabitat(parsed, reqOrigin);
            sendJson(res, 201, { habitat });
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const subMatch = url.pathname.match(/^\/api\/habitats\/([^/]+)(?:\/(health|ask))?$/);
      if (!subMatch) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      const rawId = decodeURIComponent(subMatch[1]);
      const action = subMatch[2];
      let id: string;
      try {
        id = assertValidHabitatId(rawId);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        return;
      }

      if (action === "health" && method === "GET") {
        const exists = this.declarations.has(id) || id === "gaia";
        sendJson(res, exists ? 200 : 404, {
          status: exists ? "ok" : "not_found",
          id,
          open: this.host.listOpenIds().includes(id),
        });
        return;
      }

      if (action === "ask" && method === "POST") {
        try {
          const body = z
            .object({ prompt: z.string().min(1) })
            .parse(await readJsonBody(req));
          const hab = await this.host.get(id);
          const ans = await hab.ask(body.prompt);
          sendJson(res, 200, { id, text: ans.text, answerEntryId: ans.answerEntryId });
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (!action && method === "GET") {
        const found = this.listHabitats(reqOrigin).find((h) => h.id === id);
        if (!found) {
          sendJson(res, 404, { error: `Habitat "${id}" not found` });
          return;
        }
        sendJson(res, 200, { habitat: found });
        return;
      }

      if (!action && method === "PUT") {
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const parsed = UpsertHabitatSchema.parse({ ...body, id });
          const habitat = await this.upsertHabitat(parsed, reqOrigin);
          sendJson(res, 200, { habitat });
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (!action && method === "DELETE") {
        try {
          const purge = url.searchParams.get("purge") === "true";
          const out = await this.deleteHabitat(id, purge);
          sendJson(res, 200, out);
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    // 4. Child Habitat A2A surface (`/habitats/:id/{.well-known/agent-card.json,a2a,health}`)
    const childMatch = url.pathname.match(/^\/habitats\/([^/]+)(\/.*)?$/);
    if (childMatch) {
      let id: string;
      try {
        id = assertValidHabitatId(decodeURIComponent(childMatch[1]));
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        return;
      }
      const subpath = childMatch[2] || "/";
      if (subpath === "/health" && method === "GET") {
        sendJson(res, 200, {
          status: "ok",
          id,
          runtime: "pi-durable",
          open: this.host.listOpenIds().includes(id),
        });
        return;
      }
      const handler = await this.getA2ASurface(id, reqOrigin);
      req.url = subpath + url.search;
      const handled = await handler(req, res);
      if (!handled) sendJson(res, 404, { error: "Not found" });
      return;
    }

    // 5. Root `"gaia"` orchestrator A2A surface (`/.well-known/agent-card.json`, `/a2a`)
    if (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/a2a") {
      const handler = await this.getA2ASurface("gaia", reqOrigin);
      const handled = await handler(req, res);
      if (!handled) sendJson(res, 404, { error: "Not found" });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  }

  async close(): Promise<void> {
    clearInterval(this.evictTimer);
    await this.host.closeAll();
  }
}
