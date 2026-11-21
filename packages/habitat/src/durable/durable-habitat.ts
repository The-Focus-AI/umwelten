/**
 * Host-agnostic `pi-durable` Habitat runtime (`DurableHabitat` & `HabitatHost`).
 *
 * Replaces bespoke `HabitatSessionManager`, `FileTaskStore`, `HabitatScheduler`,
 * and per-Habitat Docker container overhead with `@earendil-works/pi-durable`'s
 * transactional `Harness` over generic `Storage` (`openNodeSqliteStorage`,
 * `MemoryStorage`, Chord `StoreStorage`, or Postgres) and optional `ExecutionEnv`
 * (`NodeExecutionEnv`, `@earendil-works/pi-env` SSH, Gondolin, or Sprites),
 * plus native A2A 1.0 serving via `@leocavalcante/pi-a2a/durable`.
 */

import { mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { AgentCard } from "@a2a-js/sdk";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import {
  AssistantEntry,
  createRegistry,
  Harness,
  MemoryStorage,
  type Conversation,
  type ConversationId,
  type EntryId,
  type Extension,
  type ModelRef,
  type Registry,
  type Storage,
  type Wake,
} from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { MutableModels } from "@earendil-works/pi-ai";
import {
  createDurableA2A,
  type DurableA2A,
  type Identity as A2AIdentity,
} from "@leocavalcante/pi-a2a/durable";
import { a2aHttpHandler, bearerAuth } from "@leocavalcante/pi-a2a/server";
import {
  getPiModels,
  type ExecutableTool as UmweltenTool,
} from "@umwelten/pi";
import {
  bridgeUmweltenToolsToExtension,
  ConversationAnnotationsDoc,
  ConversationUIResourcesDoc,
  createCronScheduleExtension,
  createRepoScopeExtension,
  createTurnFanoutExtension,
  createUiResourcesExtension,
  HabitatCronTask,
  HabitatSchedulesDoc,
  type DurableScheduleSpec,
  type TurnFanoutExtensionOptions,
} from "./extensions.js";

function isPrivateOrForwardedTls(req: IncomingMessage): boolean {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (proto === "https") return true;

  const raw = (req.socket?.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (raw.startsWith("10.") || raw.startsWith("192.168.")) return true;
  const m172 = raw.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (raw.startsWith("fc") || raw.startsWith("fd")) return true;
  return false;
}

export interface DurableHabitatOptions {
  id: string;
  name?: string;
  description?: string;
  /** Directory storing `habitat.sqlite` when `storage` is omitted. */
  workDir?: string;
  /** Pluggable `pi-durable` Storage (`openNodeSqliteStorage`, `MemoryStorage`, Postgres, etc.). */
  storage?: Storage;
  /** Pluggable `pi-ai` Models registry. */
  models?: MutableModels;
  /** Default model for conversations (`{ provider, modelId }`). */
  model?: ModelRef;
  /** System instructions for the Habitat's conversations. */
  instructions?: string;
  /**
   * Optional POSIX `ExecutionEnv`. Omit (`undefined`) for API/MCP-only Habitats
   * so they run with zero container/filesystem privileges; pass `"local"` or an
   * `ExecutionEnv` (`NodeExecutionEnv`, `RemoteExecutionEnv`, Sprite) for coding Habitats.
   */
  env?: ExecutionEnv | "local";
  ownedRepoRoot?: string;
  mountedReadOnlyRoots?: string[];
  schedules?: DurableScheduleSpec[];
  fanout?: TurnFanoutExtensionOptions;
  tools?: Record<string, UmweltenTool>;
  extensions?: Extension[];
  publicOrigin?: string;
  onWake?: (wake: Wake) => void;
}

export class DurableHabitat {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly harness: Harness;
  readonly registry: Registry;
  readonly models: MutableModels;
  readonly sqlitePath?: string;
  private readonly defaultModel?: ModelRef;
  private readonly defaultInstructions?: string;
  private readonly userConversations = new Map<string, ConversationId>();

  private constructor(params: {
    id: string;
    name: string;
    description: string;
    harness: Harness;
    registry: Registry;
    models: MutableModels;
    sqlitePath?: string;
    defaultModel?: ModelRef;
    defaultInstructions?: string;
  }) {
    this.id = params.id;
    this.name = params.name;
    this.description = params.description;
    this.harness = params.harness;
    this.registry = params.registry;
    this.models = params.models;
    this.sqlitePath = params.sqlitePath;
    this.defaultModel = params.defaultModel;
    this.defaultInstructions = params.defaultInstructions;
  }

  static async open(
    options: DurableHabitatOptions,
    ctx: Context = BACKGROUND_CONTEXT,
  ): Promise<DurableHabitat> {
    let sqlitePath: string | undefined;
    let storage = options.storage;
    if (!storage) {
      if (options.workDir) {
        const dir = resolve(options.workDir);
        await mkdir(dir, { recursive: true });
        sqlitePath = join(dir, "habitat.sqlite");
        storage = await openNodeSqliteStorage(sqlitePath);
      } else {
        storage = new MemoryStorage();
      }
    }

    const models = options.models ?? getPiModels();
    const registry = createRegistry();

    const executionEnv: ExecutionEnv | undefined =
      options.env === "local"
        ? new NodeExecutionEnv({
            cwd: options.ownedRepoRoot ?? options.workDir ?? process.cwd(),
          })
        : options.env;

    if (executionEnv) {
      registry.install(CodingTools);
      registry.install(
        createRepoScopeExtension({
          ownedRoot: options.ownedRepoRoot ?? options.workDir,
          mountedReadOnlyRoots: options.mountedReadOnlyRoots,
          extraWritableRoots: options.workDir ? [options.workDir] : undefined,
        }),
      );
    }

    registry.install(createToolSearchExtension());
    registry.install(createCronScheduleExtension());
    registry.install(createTurnFanoutExtension(options.fanout));
    registry.install(
      createUiResourcesExtension({ publicOrigin: options.publicOrigin }),
    );

    if (options.tools && Object.keys(options.tools).length > 0) {
      registry.install(
        bridgeUmweltenToolsToExtension("umwelten.habitat-tools", options.tools),
      );
    }

    for (const ext of options.extensions ?? []) {
      registry.install(ext);
    }

    const harness = await Harness.open(
      storage,
      {
        models,
        registry,
        env: () => executionEnv,
        onWake: options.onWake,
      },
      ctx,
    );

    const rootConv = await harness.root(ctx, {
      agent: {
        ...(options.model ? { model: options.model } : {}),
        ...(options.instructions ? { instructions: options.instructions } : {}),
      },
    });

    if (options.schedules?.length) {
      await rootConv.commit(async (tx) => {
        const doc = await tx.doc(HabitatSchedulesDoc);
        const existingIds = new Set(doc.schedules.map((s) => s.id));
        for (const sched of options.schedules ?? []) {
          if (sched.enabled === false || existingIds.has(sched.id)) continue;
          doc.schedules.push(sched);
          await tx.createTask(
            HabitatCronTask,
            {
              scheduleId: sched.id,
              cron: sched.cron,
              prompt: sched.prompt,
            },
            {
              ownership: { kind: "conversation" },
              conversationId: rootConv.id,
              background: true,
            },
          );
        }
      }, ctx);
      harness.resume();
    }

    return new DurableHabitat({
      id: options.id,
      name: options.name ?? options.id,
      description:
        options.description ?? `Durable Habitat agent (${options.id})`,
      harness,
      registry,
      models,
      sqlitePath,
      defaultModel: options.model,
      defaultInstructions: options.instructions,
    });
  }

  async root(ctx: Context = BACKGROUND_CONTEXT): Promise<Conversation> {
    return this.harness.root(ctx);
  }

  /**
   * Submit a user message to the root (or specified) conversation, wait until
   * settled, and return the assistant's committed answer text and entry ID.
   */
  async ask(
    prompt: string,
    options?: {
      conversation?: Conversation;
      requestId?: string;
      ctx?: Context;
    },
  ): Promise<{ text: string; answerEntryId?: EntryId }> {
    const ctx = options?.ctx ?? BACKGROUND_CONTEXT;
    const conv = options?.conversation ?? (await this.root(ctx));
    const sub = await conv.submit(
      {
        type: "input",
        content: prompt,
        whenBusy: "followUp",
        ...(options?.requestId ? { requestId: options.requestId } : {}),
      },
      ctx,
    );
    await sub.wait(ctx);
    await conv.waitForIdle(ctx);

    const page = await conv.entries(
      { order: "descending" },
      20,
      undefined,
      ctx,
    );
    for (const entry of page.items) {
      if (AssistantEntry.is(entry) && entry.model?.[0]?.role === "assistant") {
        const asst = entry.model[0];
        const text = asst.content
          .filter(
            (b): b is Extract<(typeof asst.content)[number], { type: "text" }> =>
              b.type === "text",
          )
          .map((b) => b.text)
          .join("\n");
        return { text, answerEntryId: entry.id };
      }
    }
    return { text: "" };
  }

  /**
   * Fork a conversation at a specific committed `EntryId` (zero-copy SQLite fork).
   */
  async fork(
    atEntryId: EntryId,
    options?: {
      from?: Conversation;
      instructions?: string;
      model?: ModelRef;
      ctx?: Context;
    },
  ): Promise<Conversation> {
    const ctx = options?.ctx ?? BACKGROUND_CONTEXT;
    const base = options?.from ?? (await this.root(ctx));
    return base.fork(
      atEntryId,
      {
        ownership: { kind: "ownerless" },
        agent: {
          ...(options?.model ?? this.defaultModel
            ? { model: options?.model ?? this.defaultModel }
            : {}),
          ...(options?.instructions ?? this.defaultInstructions
            ? { instructions: options?.instructions ?? this.defaultInstructions }
            : {}),
        },
      },
      ctx,
    );
  }

  async getAnnotations(
    probeId: string,
    conversationId?: ConversationId,
    ctx: Context = BACKGROUND_CONTEXT,
  ) {
    const convId = conversationId ?? (await this.root(ctx)).id;
    return this.harness.snapshot(
      ConversationAnnotationsDoc,
      convId,
      probeId,
      ctx,
    );
  }

  async getUIResources(
    conversationId?: ConversationId,
    ctx: Context = BACKGROUND_CONTEXT,
  ) {
    const convId = conversationId ?? (await this.root(ctx)).id;
    return this.harness.snapshot(ConversationUIResourcesDoc, convId, ctx);
  }

  /**
   * Expose this `DurableHabitat` over A2A v1.0 using `@leocavalcante/pi-a2a/durable`,
   * isolating conversations per `(tenant, userId)` speaker identity.
   */
  createA2ASurface(options: {
    endpointUrl: string;
    bearerToken?: string;
    bearerFormat?: string;
    allowUnauthenticatedLoopback?: boolean;
    authenticate?: (
      req: IncomingMessage,
    ) => string | undefined | Promise<string | undefined>;
  }): {
    adapter: DurableA2A;
    httpHandler: (
      req: IncomingMessage,
      res: ServerResponse,
    ) => Promise<boolean>;
  } {
    const hasAuth = Boolean(options.authenticate || options.bearerToken);
    const card = AgentCard.fromJSON({
      name: this.name,
      description: this.description,
      version: "0.6.0",
      supportedInterfaces: [
        {
          url: options.endpointUrl,
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      capabilities: { streaming: true },
      ...(hasAuth
        ? {
            securitySchemes: {
              bearer: {
                httpAuthSecurityScheme: {
                  scheme: "Bearer",
                  ...(options.bearerFormat
                    ? { bearerFormat: options.bearerFormat }
                    : {}),
                },
              },
            },
          }
        : {}),
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: this.id,
          name: this.name,
          description: this.description,
          tags: ["habitat", "pi-durable"],
        },
      ],
    });

    const adapter = createDurableA2A({
      harness: this.harness,
      card,
      conversation: async (identity: A2AIdentity) => {
        const key = `${identity.tenant}:${identity.userId}`;
        const existingId = this.userConversations.get(key);
        if (existingId !== undefined) {
          const found = await this.harness.conversation(
            existingId,
            BACKGROUND_CONTEXT,
          );
          if (found) return found;
        }
        const created = await this.harness.createConversation(
          {
            ownership: { kind: "ownerless" },
            agent: {
              ...(this.defaultModel ? { model: this.defaultModel } : {}),
              ...(this.defaultInstructions
                ? { instructions: this.defaultInstructions }
                : {}),
            },
          },
          BACKGROUND_CONTEXT,
        );
        this.userConversations.set(key, created.id);
        return created;
      },
    });

    const auth =
      options.authenticate ??
      (options.bearerToken
        ? bearerAuth(() => options.bearerToken, "operator")
        : undefined);

    const rawHttpHandler = a2aHttpHandler(adapter, {
      authenticate: auth,
      allowUnauthenticatedLoopback: options.allowUnauthenticatedLoopback,
    });

    const httpHandler = async (
      req: IncomingMessage,
      res: ServerResponse,
    ): Promise<boolean> => {
      if (isPrivateOrForwardedTls(req) && req.socket && !(req.socket as { encrypted?: boolean }).encrypted) {
        Object.defineProperty(req.socket, "encrypted", {
          value: true,
          configurable: true,
        });
      }
      return rawHttpHandler(req, res);
    };

    return { adapter, httpHandler };
  }

  async close(ctx: Context = BACKGROUND_CONTEXT): Promise<void> {
    await this.harness.close(ctx);
  }
}

// ── Multi-Habitat Host Process (replaces 50 separate Docker containers) ──

export interface HabitatHostOptions {
  /** Base directory containing `<habitatId>/habitat.sqlite` directories. */
  dataDir: string;
  /** Default model for newly opened Habitats when not overridden per Habitat. */
  defaultModel?: ModelRef;
  /** Evict idle Habitat Harnesses from RAM after this many milliseconds (default: 10 min). */
  idleEvictMs?: number;
  modelsFactory?: (habitatId: string) => MutableModels;
}

interface HostedEntry {
  habitat: DurableHabitat;
  lastTouchedAt: number;
  wakeTimer?: ReturnType<typeof setTimeout>;
  httpHandler?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void>;
}

export class HabitatHost {
  private readonly dataDir: string;
  private readonly defaultModel?: ModelRef;
  private readonly idleEvictMs: number;
  private readonly modelsFactory?: (habitatId: string) => MutableModels;
  private readonly openHabitats = new Map<string, HostedEntry>();
  private readonly configs = new Map<
    string,
    Omit<DurableHabitatOptions, "id" | "workDir" | "onWake">
  >();
  private closed = false;

  constructor(options: HabitatHostOptions) {
    this.dataDir = resolve(options.dataDir);
    this.defaultModel = options.defaultModel;
    this.idleEvictMs = options.idleEvictMs ?? 10 * 60_000;
    this.modelsFactory = options.modelsFactory;
  }

  register(
    id: string,
    config: Omit<DurableHabitatOptions, "id" | "workDir" | "onWake"> = {},
  ): void {
    this.configs.set(id, config);
  }

  unregister(id: string): void {
    this.configs.delete(id);
  }

  async closeOne(id: string, ctx: Context = BACKGROUND_CONTEXT): Promise<void> {
    const existing = this.openHabitats.get(id);
    if (!existing) return;
    this.openHabitats.delete(id);
    if (existing.wakeTimer) clearTimeout(existing.wakeTimer);
    await existing.habitat.close(ctx);
  }

  listOpenIds(): string[] {
    return Array.from(this.openHabitats.keys());
  }

  async get(
    id: string,
    ctx: Context = BACKGROUND_CONTEXT,
  ): Promise<DurableHabitat> {
    if (this.closed) throw new Error("HabitatHost is closed");
    const existing = this.openHabitats.get(id);
    if (existing) {
      existing.lastTouchedAt = Date.now();
      return existing.habitat;
    }

    const cfg = this.configs.get(id) ?? {};
    const workDir = join(this.dataDir, id);

    let entryRef: HostedEntry | undefined;
    const armWake = (wake: Wake) => {
      if (this.closed || !entryRef) return;
      if (entryRef.wakeTimer) {
        clearTimeout(entryRef.wakeTimer);
        entryRef.wakeTimer = undefined;
      }
      if (wake.at !== undefined) {
        const delay = Math.max(0, wake.at - Date.now());
        entryRef.wakeTimer = setTimeout(() => {
          void this.get(id)
            .then((h) => h.harness.resume())
            .catch(() => undefined);
        }, delay);
        entryRef.wakeTimer.unref?.();
      }
    };

    const habitat = await DurableHabitat.open(
      {
        ...cfg,
        id,
        workDir,
        model: cfg.model ?? this.defaultModel,
        models: cfg.models ?? this.modelsFactory?.(id),
        onWake: armWake,
      },
      ctx,
    );

    entryRef = { habitat, lastTouchedAt: Date.now() };
    this.openHabitats.set(id, entryRef);
    armWake(habitat.harness.wake());
    return habitat;
  }

  /**
   * Evict open Habitats that have no active running tasks and have been idle
   * past `idleEvictMs`. Any sleeping schedule/alarm re-opens the `.sqlite` file
   * automatically when its timer fires.
   */
  async evictIdle(
    now = Date.now(),
    ctx: Context = BACKGROUND_CONTEXT,
  ): Promise<string[]> {
    const evicted: string[] = [];
    for (const [id, entry] of this.openHabitats.entries()) {
      if (now - entry.lastTouchedAt < this.idleEvictMs) continue;
      const wake = entry.habitat.harness.wake();
      if (wake.active) continue;
      this.openHabitats.delete(id);
      await entry.habitat.close(ctx);
      // Keep `wakeTimer` armed if `wake.at` is set so sleeping cron tasks wake it!
      if (wake.at !== undefined) {
        const delay = Math.max(0, wake.at - Date.now());
        const timer = setTimeout(() => {
          void this.get(id)
            .then((h) => h.harness.resume())
            .catch(() => undefined);
        }, delay);
        timer.unref?.();
      }
      evicted.push(id);
    }
    return evicted;
  }

  /**
   * Multiplex `/health` and `/habitats/:id/{.well-known/agent-card.json,a2a}`
   * across lazy-opened SQLite `DurableHabitat` instances on a single Node server.
   */
  createHttpHandler(
    configure?: (
      id: string,
    ) => { name?: string; publicOrigin?: string; bearerToken?: string },
  ): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    return async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ status: "ok", openHabitats: this.listOpenIds() }),
        );
        return;
      }

      const match = url.pathname.match(/^\/habitats\/([^/]+)(\/.*)?$/);
      if (!match) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const id = decodeURIComponent(match[1]);
      const subpath = match[2] || "/";
      const extra = configure?.(id);
      if (extra?.name && !this.configs.has(id)) {
        this.register(id, {
          name: extra.name,
          publicOrigin: extra.publicOrigin,
        });
      }

      const habitat = await this.get(id);
      const entry = this.openHabitats.get(id)!;
      if (!entry.httpHandler) {
        const origin = (
          extra?.publicOrigin ?? `http://127.0.0.1/habitats/${encodeURIComponent(id)}`
        ).replace(/\/$/, "");
        entry.httpHandler = habitat.createA2ASurface({
          endpointUrl: `${origin}/a2a`,
          bearerToken: extra?.bearerToken,
          allowUnauthenticatedLoopback: !extra?.bearerToken,
        }).httpHandler;
      }

      req.url = subpath + url.search;
      await entry.httpHandler!(req, res);
    };
  }

  async closeAll(ctx: Context = BACKGROUND_CONTEXT): Promise<void> {
    this.closed = true;
    const entries = Array.from(this.openHabitats.values());
    this.openHabitats.clear();
    for (const entry of entries) {
      if (entry.wakeTimer) clearTimeout(entry.wakeTimer);
      await entry.habitat.close(ctx);
    }
  }
}
