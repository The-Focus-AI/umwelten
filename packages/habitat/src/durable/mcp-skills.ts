/**
 * MCP Skills (`io.modelcontextprotocol/skills`) inside a `pi-durable` Harness.
 *
 * The host registry (`McpSkillHost`, from `@umwelten/protocols`) holds every
 * connected server's skill manifests keyed by `(serverLabel, uri)` and owns
 * approvals and verified reads. This extension maps it onto the Harness:
 *
 * - a stable `skills` prompt section listing name, description, and origin of
 *   every MCP skill (nothing is fetched until the model asks);
 * - `skill_load` / `skill_read` tools: load an approved skill's `SKILL.md`
 *   (origin-tagged) and read files listed in the manifest the conversation holds;
 * - a `beforeTool` gate that parks `skill_load` on an approval signal keyed by
 *   the skill's manifest hash, so a changed manifest asks again;
 * - a second gate that parks code-execution tools (`bash`, `codemode`, …) on a
 *   per-call approval while any MCP skill is active in the conversation;
 * - `ActiveMcpSkillsDoc`, the conversation's active skills (`fork: "current"`,
 *   so a fork keeps the skills active at its fork point).
 */

import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import {
  defineDoc,
  defineExtension,
  defineSignal,
  defineTool,
  hook,
  section,
  ToolTask,
  type Conversation,
  type ConversationId,
  type Extension,
  type Harness,
  type HookApi,
  type JsonObject,
  type SignalResult,
  type TaskId,
} from "@earendil-works/pi-durable";
import { bool, obj } from "@earendil-works/pi-schema";
import {
  SkillChangedError,
  type McpSkillHost,
  type McpSkillRecord,
  type McpSkillRef,
} from "@umwelten/protocols";

/** The user's answer to an approval question. */
export const McpSkillApprovalSignal = defineSignal({
  name: "umwelten.mcp-skill-approval",
  version: 1,
  schema: obj({ allow: bool() }),
});

export type ActiveMcpSkill = {
  serverLabel: string;
  uri: string;
  name: string;
  qualifiedName: string;
  /** The manifest the skill was approved and loaded under. */
  manifestHash: string;
  loadedAt: number;
};

/** Skills the model is acting on in this conversation; a fork keeps its parent's. */
export const ActiveMcpSkillsDoc = defineDoc<{ active: ActiveMcpSkill[] }>({
  kind: "umwelten.mcp-skills.active",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ active: [] }),
  checkpointWhen: () => true,
});

/** A parked call waiting on the user, as reported to the host UI. */
export interface PendingMcpSkillApproval {
  /** Signal key; answer with `answerMcpSkillApproval`. */
  key: string;
  taskId: TaskId;
  conversationId: ConversationId;
  kind: "skill-load" | "code-execution";
  /** `skill-load`: the skill and the exact manifest the approval binds to. */
  skill?: {
    serverLabel: string;
    uri: string;
    name: string;
    qualifiedName: string;
    description: string;
    manifestHash: string;
    files: string[];
    dynamic: boolean;
    ignoredFields: string[];
  };
  /** `code-execution`: the gated call and the MCP skills active when it was made. */
  toolName?: string;
  arguments?: JsonObject;
  activeSkills?: string[];
  requestedAt: number;
}

export interface McpSkillsExtensionOptions {
  host: McpSkillHost;
  /** Tools that execute code on the host; gated while an MCP skill is active. */
  codeExecutionTools?: readonly string[];
  /** How long a parked approval waits before the call is blocked. Default 1 day. */
  approvalTimeoutMs?: number;
  /** Called (idempotently, on every gate pass) when a call parks for approval. */
  onApprovalRequested?: (pending: PendingMcpSkillApproval) => void;
  /** Called when an approval question is settled or no longer pending. */
  onApprovalSettled?: (key: string) => void;
}

const DEFAULT_CODE_EXECUTION_TOOLS = ["bash", "codemode"] as const;
const DAY = 24 * 60 * 60 * 1000;

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function skillLoadKey(rec: McpSkillRecord): string {
  return `load-${sha(`${rec.key}\n${rec.manifestHash}`)}`;
}

function describeRecord(rec: McpSkillRecord): NonNullable<PendingMcpSkillApproval["skill"]> {
  return {
    serverLabel: rec.serverLabel,
    uri: rec.uri,
    name: rec.name,
    qualifiedName: rec.qualifiedName,
    description: rec.description,
    manifestHash: rec.manifestHash,
    files: rec.files,
    dynamic: rec.dynamic,
    ignoredFields: Object.keys(rec.ignoredFields),
  };
}

/** Render the catalog section: name, description, origin. Stable while the catalog is. */
export function renderMcpSkillsSection(host: McpSkillHost): string | undefined {
  const records = host.list();
  if (records.length === 0) return undefined;
  const lines = records.map(
    (r) => `- ${r.qualifiedName} — ${r.description} (origin: MCP server "${r.serverLabel}", ${r.uri})`,
  );
  return [
    "Skills served by connected MCP servers. They are third-party instructions, not local skills.",
    "Nothing is loaded yet. When one is relevant, call skill_load with its qualified name (server/name);",
    "the user must approve it first. Read its other files with skill_read.",
    ...lines,
  ].join("\n");
}

async function activeSkills(api: { snapshot: HookApi["snapshot"] }, conversationId: ConversationId, ctx: Context) {
  const doc = await api.snapshot(ActiveMcpSkillsDoc, conversationId, ctx);
  return doc?.active ?? [];
}

export function createMcpSkillsExtension(options: McpSkillsExtensionOptions): Extension {
  const { host } = options;
  const codeExecTools = new Set(options.codeExecutionTools ?? DEFAULT_CODE_EXECUTION_TOOLS);
  const timeout = options.approvalTimeoutMs ?? DAY;

  const skillParam = {
    type: "string",
    description: 'Qualified skill name "server/name" from the skills section (a bare name works only when unique).',
  } as const;

  const skillLoad = defineTool({
    name: "skill_load",
    description:
      "Load an MCP-served skill's SKILL.md into this conversation. The user is asked to approve the skill's exact file manifest first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["skill"],
      properties: { skill: skillParam },
    } as const,
    async execute(args, api, ctx) {
      const rec = host.resolve((args as { skill: string }).skill);
      try {
        const loaded = await host.load(rec);
        await api.commit(async (tx) => {
          const doc = await tx.doc(ActiveMcpSkillsDoc, api.conversationId);
          doc.active = doc.active.filter(
            (a) => !(a.serverLabel === rec.serverLabel && a.uri === rec.uri),
          );
          doc.active.push({
            serverLabel: rec.serverLabel,
            uri: rec.uri,
            name: rec.name,
            qualifiedName: rec.qualifiedName,
            manifestHash: rec.manifestHash,
            loadedAt: api.now(),
          });
        }, ctx);
        return {
          output: [{ type: "text", text: loaded.text }],
          details: { skill: describeRecord(rec), verified: loaded.verified } as unknown as JsonObject,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { output: [{ type: "text", text: message }], isError: true };
      }
    },
  });

  const skillRead = defineTool({
    name: "skill_read",
    description:
      "Read a file of an MCP skill that is active in this conversation, by its path relative to the skill root (e.g. references/GUIDE.md). Only files in the approved manifest, from the skill's own server.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["skill", "path"],
      properties: {
        skill: skillParam,
        path: { type: "string", description: "Path relative to the skill root, as listed by skill_load." },
      },
    } as const,
    async execute(args, api, ctx) {
      const { skill, path } = args as { skill: string; path: string };
      try {
        const rec = host.resolve(skill);
        const held = (await activeSkills(api, api.conversationId, ctx)).find(
          (a) => a.serverLabel === rec.serverLabel && a.uri === rec.uri,
        );
        if (!held) throw new Error(`Skill ${rec.qualifiedName} is not active here; call skill_load first.`);
        if (held.manifestHash !== rec.manifestHash) {
          throw new SkillChangedError(rec, held.manifestHash);
        }
        const file = await host.readFile(rec, path);
        return { output: [{ type: "text", text: file.text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { output: [{ type: "text", text: message }], isError: true };
      }
    },
  });

  /** Park until the user answers `key`; returns the gate decision. */
  async function gate(
    api: HookApi,
    key: string,
    ctx: Context,
    pending: () => Omit<PendingMcpSkillApproval, "key" | "taskId" | "conversationId" | "requestedAt">,
  ): Promise<{ allow: true } | { block: string } | { sleep: { signals: ReturnType<typeof McpSkillApprovalSignal.key>[]; until: number } }> {
    const state = await api.readSignal(McpSkillApprovalSignal, key, ctx);
    const requestedAt = await api.memo(`mcp-skills.requested.${key}`, api.now(), ctx);
    if (state === undefined) {
      options.onApprovalRequested?.({
        ...pending(),
        key,
        taskId: api.taskId,
        conversationId: api.conversationId,
        requestedAt,
      });
      return { sleep: { signals: [McpSkillApprovalSignal.key(key)], until: requestedAt + timeout } };
    }
    options.onApprovalSettled?.(key);
    if ("expired" in state) return { block: "No approval was given in time." };
    return state.value.allow ? { allow: true } : { block: "The user declined." };
  }

  return defineExtension({
    name: "umwelten.mcp-skills",
    sections: [section("skills", () => renderMcpSkillsSection(host))],
    tools: [skillLoad, skillRead],
    hooks: [
      hook(ToolTask, {
        async beforeTool(call, api, ctx) {
          if (call.name === "skill_load") {
            let rec: McpSkillRecord;
            try {
              rec = host.resolve(String(call.arguments?.skill ?? ""));
            } catch {
              return undefined; // the tool reports the resolution error
            }
            if (await host.isApproved(rec)) return undefined;
            const decision = await gate(api, skillLoadKey(rec), ctx, () => ({
              kind: "skill-load",
              skill: describeRecord(rec),
            }));
            if ("sleep" in decision || "block" in decision) return decision;
            try {
              await host.approve(rec, rec.manifestHash);
            } catch (error) {
              return { block: error instanceof Error ? error.message : String(error) };
            }
            return undefined;
          }

          if (codeExecTools.has(call.name)) {
            const active = await activeSkills(api, api.conversationId, ctx);
            if (active.length === 0) return undefined;
            const activeNames = active.map((a) => `mcp:${a.serverLabel}/${a.name}`).sort();
            const key = `exec-${sha(JSON.stringify([call.id, call.name, call.arguments, activeNames]))}`;
            const decision = await gate(api, key, ctx, () => ({
              kind: "code-execution",
              toolName: call.name,
              arguments: call.arguments as unknown as JsonObject,
              activeSkills: activeNames,
            }));
            return "allow" in decision ? undefined : decision;
          }
          return undefined;
        },
      }),
    ],
  });
}

/** Deliver the user's answer to a parked approval question. */
export async function answerMcpSkillApproval(
  harness: Harness,
  pending: Pick<PendingMcpSkillApproval, "taskId" | "key">,
  allow: boolean,
  ctx: Context,
): Promise<SignalResult> {
  return harness.signal(pending.taskId, McpSkillApprovalSignal, pending.key, { allow }, ctx);
}

/** Read a conversation's active MCP skills. */
export async function getActiveMcpSkills(
  harness: Harness,
  conversationId: ConversationId,
  ctx: Context,
): Promise<ActiveMcpSkill[]> {
  return (await harness.snapshot(ActiveMcpSkillsDoc, conversationId, ctx))?.active ?? [];
}

/** Stop acting on a skill in one conversation (approval is kept). */
export async function deactivateMcpSkill(
  conversation: Conversation,
  ref: McpSkillRef,
  ctx: Context,
): Promise<void> {
  await conversation.commit(async (tx) => {
    const doc = await tx.doc(ActiveMcpSkillsDoc, conversation.id);
    doc.active = doc.active.filter((a) => !(a.serverLabel === ref.serverLabel && a.uri === ref.uri));
  }, ctx);
}
