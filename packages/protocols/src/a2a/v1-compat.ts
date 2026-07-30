/**
 * v1 SDK compatibility helpers — the one place that knows both eras.
 *
 * `@a2a-js/sdk` 1.x is protobuf-generated: `TaskState`/`Role` are numeric
 * enums, `Part` is a oneof (`content.$case`), and every field is
 * required-by-default. This module gives the rest of the A2A layer:
 *
 *  - legacy (0.3 wire / old disk files) ⇄ v1 state + shape conversion,
 *  - compact builders for Parts and Messages (so call sites don't hand-fill
 *    protobuf required fields), and
 *  - tolerant readers for Parts and Messages.
 *
 * Nothing outside this file should ever spell a legacy state string or
 * touch `content.$case` construction directly.
 */

import {
  Message,
  Part,
  Role,
  Task,
  TaskState,
} from "@a2a-js/sdk";

// ── Task states ─────────────────────────────────────────────────────────

/** Legacy (0.3-era) state strings, as stored on disk and spoken on the 0.3 wire. */
export type LegacyTaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected"
  | "auth-required"
  | "unknown";

const LEGACY_TO_ENUM: Record<string, TaskState> = {
  submitted: TaskState.TASK_STATE_SUBMITTED,
  working: TaskState.TASK_STATE_WORKING,
  "input-required": TaskState.TASK_STATE_INPUT_REQUIRED,
  completed: TaskState.TASK_STATE_COMPLETED,
  canceled: TaskState.TASK_STATE_CANCELED,
  failed: TaskState.TASK_STATE_FAILED,
  rejected: TaskState.TASK_STATE_REJECTED,
  "auth-required": TaskState.TASK_STATE_AUTH_REQUIRED,
  unknown: TaskState.TASK_STATE_UNSPECIFIED,
};

const ENUM_TO_LEGACY: Record<number, LegacyTaskState> = {
  [TaskState.TASK_STATE_SUBMITTED]: "submitted",
  [TaskState.TASK_STATE_WORKING]: "working",
  [TaskState.TASK_STATE_INPUT_REQUIRED]: "input-required",
  [TaskState.TASK_STATE_COMPLETED]: "completed",
  [TaskState.TASK_STATE_CANCELED]: "canceled",
  [TaskState.TASK_STATE_FAILED]: "failed",
  [TaskState.TASK_STATE_REJECTED]: "rejected",
  [TaskState.TASK_STATE_AUTH_REQUIRED]: "auth-required",
  [TaskState.TASK_STATE_UNSPECIFIED]: "unknown",
};

/** Legacy state string → v1 enum. Unrecognized strings map to UNSPECIFIED. */
export function taskStateFromLegacy(state: string | undefined): TaskState {
  if (state === undefined) return TaskState.TASK_STATE_UNSPECIFIED;
  return LEGACY_TO_ENUM[state] ?? TaskState.TASK_STATE_UNSPECIFIED;
}

/** v1 enum → legacy state string (for display, logs, and stored summaries). */
export function taskStateToLegacy(state: TaskState | undefined): LegacyTaskState {
  if (state === undefined) return "unknown";
  return ENUM_TO_LEGACY[state] ?? "unknown";
}

/** The state of a task, tolerating the optional `status`. */
export function stateOf(task: Task | undefined): TaskState {
  return task?.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED;
}

// ── Part builders ───────────────────────────────────────────────────────

export function textPart(text: string): Part {
  return {
    content: { $case: "text", value: text },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}

export function dataPart(
  value: unknown,
  metadata?: Record<string, unknown>,
): Part {
  return {
    content: { $case: "data", value },
    metadata,
    filename: "",
    mediaType: "application/json",
  };
}

export function filePart(
  url: string,
  mediaType: string,
  filename = "",
): Part {
  return {
    content: { $case: "url", value: url },
    metadata: undefined,
    filename,
    mediaType,
  };
}

// ── Part readers ────────────────────────────────────────────────────────

export function partText(part: Part): string | undefined {
  return part.content?.$case === "text" ? part.content.value : undefined;
}

export function partData(part: Part): unknown {
  return part.content?.$case === "data" ? part.content.value : undefined;
}

/** URL of a file part (v1 `url` oneof branch). */
export function partFileUrl(part: Part): string | undefined {
  return part.content?.$case === "url" ? part.content.value : undefined;
}

/** Concatenated text of all text parts in a message. */
export function messageText(message: Message | undefined): string {
  return (message?.parts ?? [])
    .map(partText)
    .filter((t): t is string => typeof t === "string")
    .join("");
}

// ── Message builders ────────────────────────────────────────────────────

export interface BuildMessageOptions {
  text?: string;
  parts?: Part[];
  messageId?: string;
  contextId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

function buildMessage(role: Role, opts: BuildMessageOptions): Message {
  const parts = opts.parts ?? (opts.text !== undefined ? [textPart(opts.text)] : []);
  return {
    messageId:
      opts.messageId ??
      `a2a-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    contextId: opts.contextId ?? "",
    taskId: opts.taskId ?? "",
    role,
    parts,
    metadata: opts.metadata,
    extensions: [],
    referenceTaskIds: [],
  };
}

export function userMessage(opts: BuildMessageOptions): Message {
  return buildMessage(Role.ROLE_USER, opts);
}

export function agentMessage(opts: BuildMessageOptions): Message {
  return buildMessage(Role.ROLE_AGENT, opts);
}

// ── Stored-task JSON (disk compatibility) ───────────────────────────────

function normalizeLegacyPart(part: Record<string, unknown>): unknown {
  if (part === null || typeof part !== "object") return part;
  const kind = (part as { kind?: string; type?: string }).kind ??
    (part as { type?: string }).type;
  if (kind === "text" || typeof (part as { text?: unknown }).text === "string") {
    return { text: (part as { text?: string }).text ?? "" };
  }
  if (kind === "file") {
    const file = (part as { file?: { uri?: string; mimeType?: string; name?: string } }).file ?? {};
    return {
      url: file.uri ?? "",
      mediaType: file.mimeType ?? "",
      filename: file.name ?? "",
    };
  }
  if (kind === "data") {
    return { data: (part as { data?: unknown }).data };
  }
  return part;
}

function normalizeLegacyMessage(msg: Record<string, unknown> | undefined): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const role = (msg as { role?: string }).role;
  return {
    ...msg,
    kind: undefined,
    role: role === "agent" ? "ROLE_AGENT" : role === "user" ? "ROLE_USER" : role,
    parts: Array.isArray((msg as { parts?: unknown[] }).parts)
      ? ((msg as { parts: Record<string, unknown>[] }).parts).map(normalizeLegacyPart)
      : [],
  };
}

const PROTO_STATE_PREFIX = "TASK_STATE_";

/**
 * Convert a legacy (0.3-era) stored Task JSON into proto-JSON form that
 * `Task.fromJSON` understands. Already-proto JSON passes through untouched.
 */
export function normalizeStoredTaskJson(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const task = raw as Record<string, any>;
  const state: unknown = task.status?.state;
  const isLegacy =
    typeof state === "string" && !state.startsWith(PROTO_STATE_PREFIX);
  if (!isLegacy) return raw;

  const legacyStatus = task.status ?? {};
  return {
    ...task,
    kind: undefined,
    status: {
      ...legacyStatus,
      state: taskStateToProtoJson(taskStateFromLegacy(String(state))),
      message: normalizeLegacyMessage(legacyStatus.message),
    },
    history: Array.isArray(task.history)
      ? task.history.map((m: Record<string, unknown>) => normalizeLegacyMessage(m))
      : [],
    artifacts: Array.isArray(task.artifacts)
      ? task.artifacts.map((a: Record<string, any>) => ({
          ...a,
          parts: Array.isArray(a.parts) ? a.parts.map(normalizeLegacyPart) : [],
        }))
      : [],
  };
}

function taskStateToProtoJson(state: TaskState): string {
  const name = Object.entries(TaskState).find(([, v]) => v === state)?.[0];
  return name && name.startsWith(PROTO_STATE_PREFIX)
    ? name
    : "TASK_STATE_UNSPECIFIED";
}

/** Parse a stored task file (either era) into a v1 {@link Task}. */
export function taskFromStoredJson(raw: unknown): Task {
  return Task.fromJSON(normalizeStoredTaskJson(raw));
}

/** Serialize a v1 {@link Task} for storage (proto-JSON: states as names). */
export function taskToStoredJson(task: Task): unknown {
  return Task.toJSON(task);
}
