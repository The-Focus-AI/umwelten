/**
 * `umwelten sessions habitat <cmd>` — native Habitat transcript introspection (transcript per session dir).
 */

import { Command } from "commander";
import { join } from "node:path";
import chalk from "chalk";
import { Habitat } from "../habitat/index.js";
import type { ModelDetails } from "../cognition/types.js";
import type { HabitatOptions } from "../habitat/types.js";
import {
  parseSessionFile,
  summarizeSession,
  getBeatsForSession,
  sessionMessagesToNormalized,
  extractTextContent,
  extractReasoning,
} from "../interaction/persistence/session-parser.js";
import type {
  SessionMessage,
  AssistantMessageEntry,
  UserMessageEntry,
} from "../interaction/types/types.js";
import { formatBeatToolSummary } from "../interaction/analysis/conversation-beats.js";
import {
  loadPulledBeatPayload,
  replayBeatWithHabitat,
} from "../interaction/persistence/beat-replay.js";

const TRANSCRIPT = "transcript.jsonl";

/** Merge opts from this command up to root (parent options first). */
function mergedOpts(cmd: Command | null): Record<string, unknown> {
  const chain: Command[] = [];
  let cur: Command | null = cmd;
  while (cur) {
    chain.unshift(cur);
    cur = (cur as Command & { parent?: Command }).parent ?? null;
  }
  const out: Record<string, unknown> = {};
  for (const c of chain) {
    Object.assign(out, c.opts());
  }
  return out;
}

function habitatOptionsFromMerged(merged: Record<string, unknown>): HabitatOptions {
  return {
    workDir: merged.workDir as string | undefined,
    sessionsDir: merged.sessionsDir as string | undefined,
    envPrefix: (merged.envPrefix as string | undefined) ?? "HABITAT",
    defaultWorkDirName: "habitats",
    defaultSessionsDirName: "habitats-sessions",
  };
}

async function createHabitatForSessions(merged: Record<string, unknown>): Promise<Habitat> {
  return Habitat.create(habitatOptionsFromMerged(merged));
}

function formatDurationShort(ms: number): string {
  if (!ms || ms < 0) return "N/A";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function resolveNativeSession(
  habitat: Habitat,
  sessionId: string,
): Promise<{ sessionId: string; sessionDir: string } | null> {
  const all = await habitat.listSessions();
  const entry = all.find(
    (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId),
  );
  if (!entry) return null;
  const sessionDir = await habitat.getSessionDir(entry.sessionId);
  if (!sessionDir) return null;
  return { sessionId: entry.sessionId, sessionDir };
}

function getMessageByIndexOrUuid(
  messages: SessionMessage[],
  indexOrUuid: string,
): SessionMessage | null {
  const idx = parseInt(indexOrUuid, 10);
  if (!Number.isNaN(idx) && idx >= 0 && idx < messages.length) {
    return messages[idx];
  }
  return messages.find((m) => (m as { uuid?: string }).uuid === indexOrUuid) ?? null;
}

export function registerSessionsHabitatCommands(sessionsCommand: Command): void {
  const habitatRoot = new Command("habitat").description(
    "Native Habitat sessions (transcript.jsonl under the habitat sessions directory)",
  );

  habitatRoot
    .option("--work-dir <path>", "Habitat work directory")
    .option("--sessions-dir <path>", "Override sessions directory")
    .option(
      "--env-prefix <prefix>",
      "Env prefix for default model vars (e.g. JEEVES uses JEEVES_PROVIDER)",
      "HABITAT",
    );

  habitatRoot
    .command("list")
    .description("List native habitat sessions")
    .option("--limit <n>", "Max sessions", "20")
    .action(async (options: { limit: string }, cmd) => {
      try {
        const merged = mergedOpts(cmd);
        const habitat = await createHabitatForSessions(merged);
        const limit = parseInt(options.limit, 10) || 20;
        const sessions = await habitat.listSessions();
        const slice = sessions.slice(0, limit);
        console.log(`Sessions (${slice.length} of ${sessions.length}):\n`);
        for (const s of slice) {
          const fp = (s.metadata?.firstPrompt as string) ?? "";
          const mc = (s.metadata?.messageCount as number) ?? 0;
          const short = s.sessionId.split("-").slice(0, 2).join("-");
          console.log(
            `  ${short}  ${mc} msg  ${fp.slice(0, 50)}${fp.length > 50 ? "..." : ""}`,
          );
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  habitatRoot
    .command("show")
    .description("Summary, beat count, and size breakdown for one session id (prefix allowed)")
    .argument("<session-id>", "Session id or prefix")
    .option("--json", "JSON output")
    .action(async (sessionId: string, options: { json?: boolean }, cmd) => {
      try {
        const merged = mergedOpts(cmd);
        const habitat = await createHabitatForSessions(merged);
        const resolved = await resolveNativeSession(habitat, sessionId);
        if (!resolved) {
          console.error(chalk.red(`Session not found: ${sessionId}`));
          process.exit(1);
        }
        const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
        const messages = await parseSessionFile(transcriptPath);
        const summary = summarizeSession(messages);
        const { beats } = await getBeatsForSession(messages);
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                sessionId: resolved.sessionId,
                ...summary,
                beatCount: beats.length,
                sizeBreakdown: summary.sizeBreakdown,
              },
              null,
              2,
            ),
          );
          return;
        }
        console.log(`\nSession: ${resolved.sessionId}\n`);
        console.log(
          `  Messages: ${summary.totalMessages} (user: ${summary.userMessages}, assistant: ${summary.assistantMessages}, tool: ${summary.toolCalls})`,
        );
        console.log(`  Beats: ${beats.length}`);
        if (summary.duration != null)
          console.log(`  Duration: ${formatDurationShort(summary.duration)}`);
        if (summary.tokenUsage.input_tokens + summary.tokenUsage.output_tokens > 0) {
          console.log(
            `  Tokens: in ${summary.tokenUsage.input_tokens}, out ${summary.tokenUsage.output_tokens}`,
          );
        }
        if (summary.estimatedCost > 0)
          console.log(`  Est. cost: $${summary.estimatedCost.toFixed(4)}`);
        if (summary.reasoningCount != null && summary.reasoningCount > 0) {
          console.log(
            `  Reasoning: ${summary.reasoningCount} entries, ${summary.totalReasoningChars} chars`,
          );
        }
        const sb = summary.sizeBreakdown;
        if (sb) {
          console.log(
            `  Size (chars): user ${sb.userChars}, reasoning ${sb.reasoningChars}, tool call ${sb.toolCallChars}, tool response ${sb.toolResponseChars}, assistant ${sb.assistantChars}`,
          );
        }
        if (summary.firstMessage) {
          console.log(
            `  First prompt: ${summary.firstMessage.slice(0, 80)}${summary.firstMessage.length > 80 ? "..." : ""}`,
          );
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  habitatRoot
    .command("beats")
    .description("Print conversation beats (optional --topic filter)")
    .argument("<session-id>", "Session id or prefix")
    .option("--topic <text>", "Filter by topic or user preview substring")
    .action(async (sessionId: string, options: { topic?: string }, cmd) => {
      try {
        const merged = mergedOpts(cmd);
        const habitat = await createHabitatForSessions(merged);
        const resolved = await resolveNativeSession(habitat, sessionId);
        if (!resolved) {
          console.error(chalk.red(`Session not found: ${sessionId}`));
          process.exit(1);
        }
        const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
        const messages = await parseSessionFile(transcriptPath);
        const { beats } = await getBeatsForSession(messages);
        const topicFilter = options.topic?.trim();
        const tf = topicFilter?.toLowerCase() ?? "";
        const filtered = topicFilter
          ? beats.filter(
              (b) =>
                (b.topic?.toLowerCase().includes(tf) ?? false) ||
                b.userPreview.toLowerCase().includes(tf),
            )
          : beats;
        console.log(
          `\nBeats (${filtered.length}${topicFilter ? ` matching "${topicFilter}"` : ""} of ${beats.length}): ${resolved.sessionId}\n`,
        );
        for (const b of filtered) {
          const toolSummary = formatBeatToolSummary(b.toolCount, b.toolDurationMs);
          const topicLabel = b.topic ? ` [${b.topic}]` : "";
          console.log(
            `  ${b.index}.${topicLabel} ${b.userPreview.slice(0, 60)}${b.userPreview.length > 60 ? "..." : ""}`,
          );
          if (toolSummary) console.log(`     ${toolSummary}`);
          if (b.assistantPreview) {
            console.log(
              `     → ${b.assistantPreview.slice(0, 60)}${b.assistantPreview.length > 60 ? "..." : ""}`,
            );
          }
          console.log("");
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  habitatRoot
    .command("messages")
    .description("Print last N normalized transcript messages")
    .argument("<session-id>", "Session id or prefix")
    .option("--limit <n>", "Last N messages", "50")
    .action(async (sessionId: string, options: { limit: string }, cmd) => {
      try {
        const merged = mergedOpts(cmd);
        const habitat = await createHabitatForSessions(merged);
        const resolved = await resolveNativeSession(habitat, sessionId);
        if (!resolved) {
          console.error(chalk.red(`Session not found: ${sessionId}`));
          process.exit(1);
        }
        const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
        const messages = await parseSessionFile(transcriptPath);
        const normalized = sessionMessagesToNormalized(messages);
        const limit = parseInt(options.limit, 10) || 50;
        const slice = normalized.slice(-limit);
        console.log(`\nMessages (last ${slice.length}): ${resolved.sessionId}\n`);
        for (const m of slice) {
          const role = m.role.toUpperCase();
          const content = m.tool ? `[${m.tool.name}]` : (m.content ?? "").slice(0, 200);
          console.log(
            `  [${role}] ${content}${(m.content?.length ?? 0) > 200 ? "..." : ""}`,
          );
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  habitatRoot
    .command("message")
    .description("Inspect one raw JSONL message by index or uuid")
    .argument("<session-id>", "Session id or prefix")
    .argument("<index|uuid>", "Message index or uuid")
    .action(async (sessionId: string, indexOrUuid: string, cmd) => {
      try {
        const merged = mergedOpts(cmd);
        const habitat = await createHabitatForSessions(merged);
        const resolved = await resolveNativeSession(habitat, sessionId);
        if (!resolved) {
          console.error(chalk.red(`Session not found: ${sessionId}`));
          process.exit(1);
        }
        const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
        const messages = await parseSessionFile(transcriptPath);
        const msg = getMessageByIndexOrUuid(messages, indexOrUuid);
        if (!msg) {
          console.error(chalk.red(`Message not found: ${indexOrUuid}`));
          process.exit(1);
        }
        const uuid = (msg as { uuid?: string }).uuid ?? "";
        console.log(`\nMessage: ${indexOrUuid} (uuid: ${uuid})\n`);
        if (msg.type === "user") {
          const content = (msg as UserMessageEntry).message.content;
          const texts = extractTextContent(content);
          console.log(texts.join("\n"));
          if (typeof content !== "string" && Array.isArray(content)) {
            const toolResults = content.filter((b) => b.type === "tool_result");
            if (toolResults.length > 0) {
              console.log("\n--- Tool results ---");
              for (const tr of toolResults) {
                const c = tr.content;
                console.log(
                  typeof c === "string" ? c.slice(0, 500) : JSON.stringify(c).slice(0, 500),
                );
              }
            }
          }
        } else if (msg.type === "assistant") {
          const am = msg as AssistantMessageEntry;
          const reasoning = extractReasoning(am);
          if (reasoning) {
            console.log("--- Reasoning ---\n");
            console.log(reasoning);
            console.log("\n--- Content ---\n");
          }
          const content = am.message.content;
          const texts = extractTextContent(content);
          console.log(texts.join("\n"));
          if (typeof content !== "string" && Array.isArray(content)) {
            const toolCalls = content.filter((b) => b.type === "tool_use");
            if (toolCalls.length > 0) {
              console.log("\n--- Tool calls ---");
              for (const tc of toolCalls) {
                console.log(`${tc.name}:`, JSON.stringify(tc.input, null, 2).slice(0, 300));
              }
            }
          }
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  habitatRoot
    .command("pull")
    .description("Export one beat as JSON (for sessions habitat replay)")
    .argument("<session-id>", "Session id or prefix")
    .argument("<beat-index>", "Beat index from sessions habitat beats")
    .option("--output <file>", "Write to file instead of stdout")
    .action(async (sessionId: string, beatIndexStr: string, cmd) => {
      try {
        const merged = mergedOpts(cmd);
        const outputPath = merged.output as string | undefined;
        const habitat = await createHabitatForSessions(merged);
        const resolved = await resolveNativeSession(habitat, sessionId);
        if (!resolved) {
          console.error(chalk.red(`Session not found: ${sessionId}`));
          process.exit(1);
        }
        const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
        const messages = await parseSessionFile(transcriptPath);
        const { beats } = await getBeatsForSession(messages);
        const beatIndex = parseInt(beatIndexStr, 10);
        if (Number.isNaN(beatIndex) || beatIndex < 0 || beatIndex >= beats.length) {
          console.error(
            chalk.red(
              `Beat index ${beatIndexStr} out of range (0..${beats.length > 0 ? beats.length - 1 : 0})`,
            ),
          );
          process.exit(1);
        }
        const beat = beats[beatIndex];
        const payload = {
          sessionId: resolved.sessionId,
          beatIndex,
          messages: beat.messages,
          userPreview: beat.userPreview,
          assistantPreview: beat.assistantPreview,
          toolCount: beat.toolCount,
        };
        const json = JSON.stringify(payload, null, 2);
        if (outputPath) {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(outputPath, json, "utf-8");
          console.log(`Wrote beat ${beatIndex} to ${outputPath}`);
        } else {
          console.log(json);
        }
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  habitatRoot
    .command("replay")
    .description(
      "Re-run one pulled beat through the current habitat stimulus (regenerates assistant turn)",
    )
    .argument("<file>", "Pulled JSON path, or - for stdin")
    .option("-p, --provider <p>", "Model provider override")
    .option("-m, --model <m>", "Model name override")
    .action(async (file: string, cmd) => {
      try {
        const merged = mergedOpts(cmd);
        const provider = merged.provider as string | undefined;
        const model = merged.model as string | undefined;
        const payload = await loadPulledBeatPayload(file);
        const prefix = (merged.envPrefix as string) ?? "HABITAT";
        const modelDetails: ModelDetails = {
          provider: (provider ??
            process.env[`${prefix}_PROVIDER`] ??
            "google") as ModelDetails["provider"],
          name:
            model ??
            process.env[`${prefix}_MODEL`] ??
            "gemini-3-flash-preview",
        };
        const text = await replayBeatWithHabitat(
          payload,
          habitatOptionsFromMerged(merged),
          modelDetails,
        );
        console.log(text);
      } catch (e) {
        console.error(chalk.red(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }
    });

  sessionsCommand.addCommand(habitatRoot);
}
