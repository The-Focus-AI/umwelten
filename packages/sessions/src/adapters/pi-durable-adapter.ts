/**
 * Pi Durable Session Adapter (`@earendil-works/pi-durable`)
 *
 * Discovers and reads host-agnostic `pi-durable` SQLite stores (`*.sqlite`,
 * e.g. `habitat.sqlite` or `.umwelten/durable/*.sqlite`) using a read-only
 * `Harness`, projecting root conversations and zero-copy forked conversations
 * into Umwelten `SourceSession`s and `Exploration`s.
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, contentText } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  CompactionEntry,
  createRegistry,
  Harness,
  ResetEntry,
  ToolResultEntry,
  UserEntry,
  type ConversationId,
  type Cursor,
  type EntryRecord,
  type Storage,
} from "@earendil-works/pi-durable";
import {
  openNodeSqliteDatabase,
  openNodeSqliteStorage,
} from "@earendil-works/pi-durable/storage/sqlite/node";
import type {
  NormalizedMessage,
  NormalizedSession,
  NormalizedSessionEntry,
  SessionDiscoveryOptions,
  SessionDiscoveryResult,
  SessionMetrics,
  SessionSource,
} from "../types/normalized-types.js";
import type { SessionAdapter } from "./adapter.js";

const SOURCE: SessionSource = "pi-durable";

export interface PiDurableAdapterOptions {
  /** Base directory holding `.sqlite` session files (default: `~/.umwelten/durable`). */
  storeDir?: string;
  /** Explicit `.sqlite` file paths to inspect in addition to `storeDir`. */
  sqliteFiles?: string[];
}

async function isPiDurableSqliteFile(file: string): Promise<boolean> {
  const db = await openNodeSqliteDatabase(file, { mode: "read-only" });
  try {
    const row = await db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'durable_schema'",
    );
    return row?.name === "durable_schema";
  } catch {
    return false;
  } finally {
    await db.close().catch(() => undefined);
  }
}

function encodeSessionId(sqliteFile: string, conversationId: number): string {
  return `pi-durable:${Buffer.from(resolve(sqliteFile)).toString("base64url")}:${conversationId}`;
}

function decodeSessionId(
  sessionId: string,
): { sqliteFile: string; conversationId: ConversationId } | null {
  if (!sessionId.startsWith("pi-durable:")) return null;
  const rest = sessionId.slice("pi-durable:".length);
  const sepIdx = rest.lastIndexOf(":");
  if (sepIdx <= 0) return null;
  const encodedPath = rest.slice(0, sepIdx);
  const convId = Number(rest.slice(sepIdx + 1));
  if (!Number.isInteger(convId) || convId <= 0) return null;
  try {
    const sqliteFile = Buffer.from(encodedPath, "base64url").toString("utf8");
    return { sqliteFile, conversationId: convId as ConversationId };
  } catch {
    return null;
  }
}

export async function readPiDurableStorageConversations(
  storage: Storage,
  sourceLabel: string,
): Promise<NormalizedSession[]> {
  const harness = await Harness.open(
    storage,
    {
      models: createModels(),
      registry: createRegistry(),
      readOnly: true,
    },
    BACKGROUND_CONTEXT,
  );

  try {
    // Scan all conversations via storage directly (read-only)
    const convIds: ConversationId[] = [];
    let convCursor: Cursor | undefined;
    for (;;) {
      const page = await storage.scanConversations(
        { order: "ascending" },
        100,
        convCursor,
        BACKGROUND_CONTEXT,
      );
      for (const item of page.items) {
        convIds.push(item.id);
      }
      if (!page.next) break;
      convCursor = page.next;
    }

    const sessions: NormalizedSession[] = [];

    for (const convId of convIds) {
      const conv = await harness.conversation(convId, BACKGROUND_CONTEXT);
      if (!conv) continue;

      const entries: EntryRecord[] = [];
      let entryCursor: Cursor | undefined;
      for (;;) {
        const page = await conv.entries(
          { order: "ascending" },
          200,
          entryCursor,
          BACKGROUND_CONTEXT,
        );
        entries.push(...page.items);
        if (!page.next) break;
        entryCursor = page.next;
      }

      const messages: NormalizedMessage[] = [];
      let userCount = 0;
      let assistantCount = 0;
      let toolCallCount = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let firstPrompt: string | undefined;
      let firstTs: number | undefined;
      let lastTs: number | undefined;

      for (const entry of entries) {
        if (UserEntry.is(entry) && entry.model?.[0]?.role === "user") {
          const userMsg = entry.model[0];
          const text = contentText(userMsg.content);
          if (!firstPrompt && text.trim()) firstPrompt = text.trim();
          const ts = userMsg.timestamp;
          if (ts) {
            firstTs = firstTs === undefined ? ts : Math.min(firstTs, ts);
            lastTs = lastTs === undefined ? ts : Math.max(lastTs, ts);
          }
          userCount++;
          messages.push({
            id: `entry-${entry.id}`,
            role: "user",
            content: text,
            timestamp: ts ? new Date(ts).toISOString() : undefined,
          });
        } else if (
          AssistantEntry.is(entry) &&
          entry.model?.[0]?.role === "assistant"
        ) {
          const asst = entry.model[0];
          const ts = asst.timestamp;
          if (ts) {
            firstTs = firstTs === undefined ? ts : Math.min(firstTs, ts);
            lastTs = lastTs === undefined ? ts : Math.max(lastTs, ts);
          }
          const textBlocks = asst.content
            .filter(
              (b): b is Extract<(typeof asst.content)[number], { type: "text" }> =>
                b.type === "text",
            )
            .map((b) => b.text)
            .join("\n");
          const calls = asst.content.filter((b) => b.type === "toolCall");
          toolCallCount += calls.length;
          assistantCount++;
          inputTokens += asst.usage?.input ?? 0;
          outputTokens += asst.usage?.output ?? 0;

          messages.push({
            id: `entry-${entry.id}`,
            role: "assistant",
            content: textBlocks,
            timestamp: ts ? new Date(ts).toISOString() : undefined,
            model: `${asst.provider}/${asst.model}`,
            tokens: {
              input: asst.usage?.input,
              output: asst.usage?.output,
              cacheRead: asst.usage?.cacheRead,
              cacheWrite: asst.usage?.cacheWrite,
              total: asst.usage?.totalTokens,
            },
            sourceData: calls.length > 0 ? { toolCalls: calls } : undefined,
          });
        } else if (
          ToolResultEntry.is(entry) &&
          entry.model?.[0]?.role === "toolResult"
        ) {
          const tr = entry.model[0];
          const text = tr.content
            .filter(
              (b): b is Extract<(typeof tr.content)[number], { type: "text" }> =>
                b.type === "text",
            )
            .map((b) => b.text)
            .join("\n");
          messages.push({
            id: `entry-${entry.id}`,
            role: "tool",
            content: text,
            timestamp: tr.timestamp
              ? new Date(tr.timestamp).toISOString()
              : undefined,
            tool: {
              name: tr.toolName,
              output: text,
              duration: tr.durationMs,
              isError: tr.isError,
            },
          });
        } else if (
          CompactionEntry.is(entry) &&
          entry.model?.[0]?.role === "user"
        ) {
          const summaryText = contentText(entry.model[0].content);
          messages.push({
            id: `entry-${entry.id}`,
            role: "system",
            content: `[Compaction summary]: ${summaryText}`,
          });
        } else if (ResetEntry.is(entry) && entry.model?.[0]?.role === "user") {
          const handoffText = contentText(entry.model[0].content);
          messages.push({
            id: `entry-${entry.id}`,
            role: "system",
            content: `[Context handoff]: ${handoffText}`,
          });
        }
      }

      if (messages.length === 0) continue;

      const createdIso = firstTs
        ? new Date(firstTs).toISOString()
        : new Date().toISOString();
      const modifiedIso = lastTs
        ? new Date(lastTs).toISOString()
        : createdIso;

      const metrics: SessionMetrics = {
        userMessages: userCount,
        assistantMessages: assistantCount,
        toolCalls: toolCallCount,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };

      sessions.push({
        id: encodeSessionId(sourceLabel, convId),
        source: SOURCE,
        sourceId: `${basename(sourceLabel)}#${convId}`,
        projectPath: resolve(sourceLabel, ".."),
        firstPrompt: firstPrompt ?? `Conversation #${convId}`,
        created: createdIso,
        modified: modifiedIso,
        messageCount: messages.length,
        messages,
        metrics,
        sourceData: {
          sqliteFile: sourceLabel,
          conversationId: convId,
        },
      });
    }

    return sessions;
  } finally {
    await harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
  }
}

export class PiDurableSessionAdapter implements SessionAdapter {
  readonly source: SessionSource = SOURCE;
  readonly displayName = "Pi Durable";
  private readonly storeDir: string;
  private readonly explicitFiles: string[];

  constructor(options: PiDurableAdapterOptions = {}) {
    this.storeDir =
      options.storeDir ?? join(homedir(), ".umwelten", "durable");
    this.explicitFiles = (options.sqliteFiles ?? []).map((f) => resolve(f));
  }

  getSourceLocation(): string {
    return this.storeDir;
  }

  private async candidateFiles(projectPath?: string): Promise<string[]> {
    const found = new Set<string>(this.explicitFiles);
    const dirs = [this.storeDir];
    if (projectPath) {
      dirs.push(
        resolve(projectPath),
        join(resolve(projectPath), ".umwelten", "durable"),
      );
    }

    for (const dir of dirs) {
      try {
        const items = await readdir(dir);
        for (const item of items) {
          if (item.endsWith(".sqlite") || item.endsWith(".db")) {
            const full = join(dir, item);
            const info = await stat(full).catch(() => null);
            if (info?.isFile() && info.size > 0) {
              found.add(full);
            }
          }
        }
      } catch {
        // Directory does not exist
      }
    }

    return Array.from(found);
  }

  async canHandle(projectPath: string): Promise<boolean> {
    const files = await this.candidateFiles(projectPath);
    return files.length > 0;
  }

  async discoverProjects(): Promise<string[]> {
    const files = await this.candidateFiles();
    return Array.from(new Set(files.map((f) => resolve(f, ".."))));
  }

  async discoverSessions(
    options?: SessionDiscoveryOptions,
  ): Promise<SessionDiscoveryResult> {
    const files = await this.candidateFiles(options?.projectPath);
    const entries: NormalizedSessionEntry[] = [];

    for (const file of files) {
      try {
        if (!(await isPiDurableSqliteFile(file))) continue;
        const storage = await openNodeSqliteStorage(file);
        const sessions = await readPiDurableStorageConversations(storage, file);
        for (const s of sessions) {
          const { messages: _omit, ...entry } = s;
          entries.push(entry);
        }
      } catch {
        // Not a readable pi-durable SQLite database; skip cleanly
      }
    }

    entries.sort(
      (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
    );

    const limited = options?.limit ? entries.slice(0, options.limit) : entries;
    return {
      source: SOURCE,
      sessions: limited,
      totalCount: entries.length,
      hasMore: limited.length < entries.length,
    };
  }

  async getSessionEntry(
    sessionId: string,
  ): Promise<NormalizedSessionEntry | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const { messages: _omit, ...entry } = session;
    return entry;
  }

  async getSession(sessionId: string): Promise<NormalizedSession | null> {
    const decoded = decodeSessionId(sessionId);
    if (!decoded) return null;
    try {
      if (!(await isPiDurableSqliteFile(decoded.sqliteFile))) return null;
      const storage = await openNodeSqliteStorage(decoded.sqliteFile);
      const sessions = await readPiDurableStorageConversations(
        storage,
        decoded.sqliteFile,
      );
      return (
        sessions.find(
          (s) => s.sourceData?.conversationId === decoded.conversationId,
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
    const session = await this.getSession(sessionId);
    return session?.messages ?? [];
  }

  async hasSessionsForProject(projectPath: string): Promise<boolean> {
    const res = await this.discoverSessions({ projectPath, limit: 1 });
    return res.totalCount > 0;
  }
}

export function createPiDurableSessionAdapter(
  options?: PiDurableAdapterOptions,
): PiDurableSessionAdapter {
  return new PiDurableSessionAdapter(options);
}
