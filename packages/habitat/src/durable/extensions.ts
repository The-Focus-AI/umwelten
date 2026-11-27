import { resolve, sep } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  CompactionTask,
  defineDoc,
  defineDocFamily,
  defineExtension,
  defineTask,
  defineTool,
  GenerationTask,
  hook,
  hookTask,
  ToolTask,
  UserEntry,
  type ConversationDocFamilyToken,
  type EntryId,
  type Extension,
  type JsonObject,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import {
  zodOrJsonToSchema,
  type ExecutableTool as UmweltenTool,
} from "@umwelten/pi";
import { parseCron, nextCronDate } from "../schedule/cron.js";
import {
  buildHabitatUIResource,
  type HabitatUIResource,
} from "../ui-resources.js";

// ── 1. Repo Scope Guard Extension (Owned read/write vs Mounted read-only) ─

export interface RepoScopeExtensionOptions {
  /** Primary writable directory (Owned repo or workDir). */
  ownedRoot?: string;
  /** Additional read-only directories (Mounted repos). */
  mountedReadOnlyRoots?: string[];
  /** Additional writable roots (e.g. workDir scratch/artifacts). */
  extraWritableRoots?: string[];
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const normCandidate = resolve(candidatePath);
  const normRoot = resolve(rootPath);
  return (
    normCandidate === normRoot || normCandidate.startsWith(`${normRoot}${sep}`)
  );
}

export function createRepoScopeExtension(
  options: RepoScopeExtensionOptions,
): Extension {
  const readOnlyRoots = (options.mountedReadOnlyRoots ?? []).map((p) =>
    resolve(p),
  );
  const writableRoots = [
    ...(options.ownedRoot ? [resolve(options.ownedRoot)] : []),
    ...(options.extraWritableRoots ?? []).map((p) => resolve(p)),
  ];
  const allAllowedRoots = [...writableRoots, ...readOnlyRoots];

  const baseDir = options.ownedRoot
    ? resolve(options.ownedRoot)
    : process.cwd();

  return defineExtension({
    name: "umwelten.repo-scope",
    hooks: [
      hook(ToolTask, {
        beforeTool(call) {
          const rawPath =
            typeof call.arguments?.path === "string"
              ? call.arguments.path
              : undefined;
          if (!rawPath) return undefined;

          const resolved = resolve(baseDir, rawPath);

          if (
            allAllowedRoots.length > 0 &&
            !allAllowedRoots.some((root) => isWithinRoot(resolved, root))
          ) {
            return {
              block: `Path "${rawPath}" is outside this Habitat's allowed Owned and Mounted repository roots.`,
            };
          }

          if (call.name === "write" || call.name === "edit") {
            const hitReadOnly = readOnlyRoots.find(
              (roRoot) =>
                isWithinRoot(resolved, roRoot) &&
                !writableRoots.some(
                  (rwRoot) =>
                    rwRoot.length > roRoot.length &&
                    isWithinRoot(resolved, rwRoot),
                ),
            );
            if (hitReadOnly) {
              return {
                block: `Mounted repository "${hitReadOnly}" is read-only; writes are only allowed in the Owned repository.`,
              };
            }
          }

          return undefined;
        },
      }),
    ],
  });
}

// ── 2. Durable Cron Schedule Extension (`defineTask` + `sleepUntil`) ──────

export type DurableScheduleSpec = {
  id: string;
  cron: string;
  prompt: string;
  enabled?: boolean;
};

export type ScheduleDocState = {
  schedules: DurableScheduleSpec[];
  lastFiredAt: Record<string, number>;
};

export const HabitatSchedulesDoc = defineDoc<ScheduleDocState>({
  kind: "umwelten.schedules",
  version: 1,
  scope: "session",
  initial: () => ({ schedules: [], lastFiredAt: {} }),
  checkpointWhen: () => true,
});

type CronTaskInput = {
  scheduleId: string;
  cron: string;
  prompt: string;
};

type CronTaskCheckpoint =
  | { phase: "arm"; nextAt?: number }
  | { phase: "fire"; scheduledFor: number };

export const HabitatCronTask = defineTask<
  CronTaskInput,
  CronTaskCheckpoint,
  void
>({
  name: "umwelten.cron",
  version: 1,
  initial: () => ({ phase: "arm" }),
  phases: {
    async arm(task, runtime, ctx) {
      const parsed = parseCron(task.input.cron);
      const now = new Date(runtime.now());
      const nextDate = nextCronDate(parsed, now);
      if (!nextDate) {
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result: undefined },
          }),
          ctx,
        );
        return;
      }
      const nextAt = nextDate.getTime();
      await runtime.sleepUntil(
        nextAt,
        { phase: "fire", scheduledFor: nextAt },
        ctx,
      );
    },
    async fire(task, runtime, ctx) {
      const conv = await runtime.conversation(runtime.conversationId, ctx);
      const firedAt = runtime.now();
      await runtime.commit(async (tx) => {
        if (conv) {
          await conv.submit(tx, {
            type: "input",
            content: task.input.prompt,
            whenBusy: "followUp",
            requestId: `cron:${task.input.scheduleId}:${task.state.checkpoint.scheduledFor}`,
          });
        }
        const doc = await tx.doc(HabitatSchedulesDoc);
        doc.lastFiredAt[task.input.scheduleId] = firedAt;
        const parsed = parseCron(task.input.cron);
        const nextDate = nextCronDate(parsed, new Date(firedAt + 1000));
        if (!nextDate) {
          return {
            status: "terminal",
            outcome: { status: "completed", result: undefined },
          };
        }
        const nextAt = nextDate.getTime();
        return {
          status: "sleeping",
          until: nextAt,
          checkpoint: { phase: "fire", scheduledFor: nextAt },
        };
      }, ctx);
    },
  },
  async abort(_task, runtime, ctx) {
    await runtime.commit(
      () => ({
        status: "terminal",
        outcome: { status: "aborted", reason: "schedule cancelled" },
      }),
      ctx,
    );
  },
});

export function createCronScheduleExtension(): Extension {
  return defineExtension({
    name: "umwelten.schedules",
    tasks: [HabitatCronTask],
  });
}

// ── 3. Turn Fan-out Extension (Annotations & Baselines on `pi-durable`) ───

export type AnnotationRecord = {
  probeId: string;
  answerEntryId: number;
  value: string;
  createdAt: number;
};

export const ConversationAnnotationsDoc: ConversationDocFamilyToken<
  { items: AnnotationRecord[] },
  null
> = defineDocFamily<{ items: AnnotationRecord[] }, null>({
  kind: "umwelten.annotations",
  version: 1,
  family: true,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ items: [] }),
  checkpointWhen: () => true,
});

export interface TurnAnnotationProbe {
  id: string;
  evaluate: (
    transcript: { lastUserText: string; lastAssistantText: string },
    ctx: Context,
  ) => Promise<string> | string;
}

export interface TurnFanoutExtensionOptions {
  annotations?: TurnAnnotationProbe[];
  customCompact?: (input: {
    reason: string;
    messageCount: number;
    instructions?: string;
  }) => Promise<string | undefined> | string | undefined;
}

export function createTurnFanoutExtension(
  options: TurnFanoutExtensionOptions = {},
): Extension {
  const probes = options.annotations ?? [];

  const AnnotationFanoutTask = defineTask<
    { first: EntryId; answer: EntryId; last: EntryId },
    { phase: "probe" },
    void
  >({
    name: "umwelten.fanout-probe",
    version: 1,
    initial: () => ({ phase: "probe" }),
    phases: {
      async probe(task, runtime, ctx) {
        const page = await runtime.entries(
          {
            minEntryId: task.input.first,
            maxEntryId: task.input.last,
            order: "ascending",
          },
          50,
          undefined,
          ctx,
        );

        let lastUserText = "";
        let lastAssistantText = "";
        for (const entry of page.items) {
          if (UserEntry.is(entry) && entry.model?.[0]?.role === "user") {
            lastUserText = contentText(entry.model[0].content);
          } else if (
            AssistantEntry.is(entry) &&
            entry.model?.[0]?.role === "assistant"
          ) {
            const asst = entry.model[0];
            lastAssistantText = asst.content
              .filter(
                (b): b is Extract<(typeof asst.content)[number], { type: "text" }> =>
                  b.type === "text",
              )
              .map((b) => b.text)
              .join("\n");
          }
        }

        const evaluated: AnnotationRecord[] = await Promise.all(
          probes.map(async (p) => ({
            probeId: p.id,
            answerEntryId: Number(task.input.answer),
            value: await p.evaluate({ lastUserText, lastAssistantText }, ctx),
            createdAt: runtime.now(),
          })),
        );

        await runtime.commit(async (tx) => {
          for (const item of evaluated) {
            const doc = await tx.doc(
              ConversationAnnotationsDoc,
              runtime.conversationId,
              item.probeId,
              null,
            );
            doc.items.push(item);
          }
          return {
            status: "terminal",
            outcome: { status: "completed", result: undefined },
          };
        }, ctx);
      },
    },
    async abort(_task, runtime, ctx) {
      await runtime.commit(
        () => ({
          status: "terminal",
          outcome: { status: "aborted" },
        }),
        ctx,
      );
    },
  });

  const hooks = [];
  if (probes.length > 0) {
    hooks.push(
      hook(GenerationTask, {
        afterRun(run) {
          return {
            tasks: [
              hookTask(AnnotationFanoutTask, {
                first: run.first,
                answer: run.answer,
                last: run.last,
              }),
            ],
          };
        },
      }),
    );
  }

  if (options.customCompact) {
    const compactFn = options.customCompact;
    hooks.push(
      hook(CompactionTask, {
        async beforeCompact(compaction) {
          const summary = await compactFn({
            reason: compaction.reason,
            messageCount: compaction.messages.length,
            instructions: compaction.instructions,
          });
          return summary ? { summary } : undefined;
        },
      }),
    );
  }

  return defineExtension({
    name: "umwelten.fanout",
    tasks: [AnnotationFanoutTask],
    hooks,
  });
}

// ── 4. UI Resources (`ui://`) & Umwelten Tool Bridge Extension ────────────

export const ConversationUIResourcesDoc = defineDoc<{
  resources: JsonObject[];
}>({
  kind: "umwelten.ui-resources",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ resources: [] }),
  checkpointWhen: () => true,
});

export function createUiResourcesExtension(options?: {
  publicOrigin?: string;
}): Extension {
  const publishUiTool = defineTool({
    name: "publish_ui_resource",
    description:
      "Publish an interactive `ui://` MCP-UI resource (raw HTML or external URL) to the current conversation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["uri"],
      properties: {
        uri: {
          type: "string",
          description: 'UI resource URI starting with "ui://"',
        },
        html: {
          type: "string",
          description: "Inline HTML rendered in a sandboxed iframe",
        },
        externalUrl: {
          type: "string",
          description: "External or relative URL to render in an iframe",
        },
      },
    } as const,
    async execute(args, api, ctx) {
      const typedArgs = args as {
        uri: string;
        html?: string;
        externalUrl?: string;
      };
      const built: HabitatUIResource = buildHabitatUIResource({
        uri: typedArgs.uri,
        html: typedArgs.html,
        externalUrl: typedArgs.externalUrl,
        origin: options?.publicOrigin,
      });

      await api.commit(async (tx) => {
        const doc = await tx.doc(
          ConversationUIResourcesDoc,
          api.conversationId,
        );
        doc.resources.push(built as unknown as JsonObject);
      }, ctx);

      return {
        output: [
          {
            type: "text",
            text: `Published UI resource ${built.uri} (${built.mimeType})`,
          },
        ],
        details: built as unknown as JsonObject,
      };
    },
  });

  return defineExtension({
    name: "umwelten.ui-resources",
    tools: [publishUiTool],
  });
}

/**
 * Bridge an Umwelten `Record<string, Tool>` map into a `pi-durable` `Extension`.
 */
export function bridgeUmweltenToolsToExtension(
  extensionName: string,
  tools: Record<string, UmweltenTool>,
): Extension {
  const registrations: ToolRegistration[] = [];

  for (const [name, toolDef] of Object.entries(tools)) {
    if (typeof toolDef.execute !== "function") continue;
    const executeFn = toolDef.execute;
    registrations.push(
      defineTool({
        name,
        description: toolDef.description ?? `Tool ${name}`,
        parameters: zodOrJsonToSchema(toolDef.inputSchema),
        async execute(args, _api, ctx) {
          const result = await executeFn(args, {
            toolCallId: `durable-${name}`,
            abortSignal: ctx.abortSignal,
          });
          const text =
            typeof result === "string"
              ? result
              : JSON.stringify(result ?? null, null, 2);
          return {
            output: [{ type: "text", text }],
          };
        },
      }),
    );
  }

  return defineExtension({
    name: extensionName,
    tools: registrations,
  });
}

/** The client surface `bridgeMcpClientToExtension` needs (satisfied by `RemoteMcpClient`). */
export interface McpToolSource {
  readonly label: string;
  getTools(): Record<
    string,
    {
      description: string;
      inputSchema: Record<string, unknown>;
      execute(params: Record<string, unknown>, opts?: { abortSignal?: AbortSignal }): Promise<unknown>;
    }
  >;
}

/** Tool name prefix for one MCP server: `mcp__<label>__`. */
export function mcpToolPrefix(label: string): string {
  return `mcp__${label.replace(/[^a-zA-Z0-9_-]/g, "_")}__`;
}

/**
 * Bridge one connected MCP server's tools into a `pi-durable` extension named
 * `mcp.<label>`, tools prefixed `mcp__<label>__`. The model sees the concise
 * result; `ui://` resources and `_meta` stay in the result `details`.
 */
export function bridgeMcpClientToExtension(source: McpToolSource): Extension {
  const prefix = mcpToolPrefix(source.label);
  const registrations: ToolRegistration[] = Object.entries(source.getTools()).map(([name, mcpTool]) =>
    defineTool({
      name: `${prefix}${name}`,
      description: `[MCP server "${source.label}"] ${mcpTool.description}`,
      parameters: mcpTool.inputSchema as JsonObject,
      async execute(args, _api, ctx) {
        const result = (await mcpTool.execute(args as Record<string, unknown>, {
          abortSignal: ctx.abortSignal,
        })) as { success?: boolean; data?: unknown; error?: unknown; _uiResources?: unknown; _meta?: unknown };
        const payload = result.success === false ? result.error : result.data;
        const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? null, null, 2);
        const details: JsonObject = {};
        if (result._uiResources) details.uiResources = result._uiResources as JsonObject[];
        if (result._meta) details.meta = result._meta as JsonObject;
        return {
          output: [{ type: "text", text }],
          ...(result.success === false ? { isError: true } : {}),
          ...(Object.keys(details).length > 0 ? { details } : {}),
        };
      },
    }),
  );
  return defineExtension({
    name: `mcp.${source.label}`,
    namespace: { name: prefix.slice(0, -2), description: `Tools of MCP server "${source.label}"` },
    tools: registrations,
  });
}