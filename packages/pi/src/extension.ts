/**
 * `@umwelten/pi` — Pi CLI Extension (`pi install ./packages/pi`).
 *
 * Adds Umwelten's session sensemaking and knowledge promotion onto Pi's native
 * model/provider runtime (`builtinModels()` + `~/.pi/agent/models.json`):
 *   1. Cross-tool `umwelten_session_search` across Pi JSONL v3 trees, Pi Durable SQLite stores, Claude Code, and Cursor
 *   2. `umwelten_promote_knowledge` routing Reflections into `FACTS.md`, `AGENTS.md`, or `.umwelten/reflections/`
 *   3. `/umwelten-explorations` command
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  classifyReflectionAnswer,
  extractTitle,
  initializeAdapters,
  projectSessions,
  PromotionRouter,
  searchSessions,
  type PromotionTarget,
} from "@umwelten/sessions";

export default function umweltenPiExtension(pi: ExtensionAPI): void {
  // 1. Cross-tool Session Search tool (Pi JSONL, Pi Durable SQLite, Claude Code, Cursor)
  pi.registerTool({
    name: "umwelten_session_search",
    label: "Session Search",
    description:
      "Search across persisted Source Sessions on disk (Pi, Pi Durable SQLite, Claude Code, Cursor) using ripgrep.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Exact or keyword phrase to search across all sessions",
        },
        maxHits: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum session hits to return (default: 10)",
        },
      },
    } as any,
    async execute(_toolCallId, params: any) {
      initializeAdapters();
      const maxHits = typeof params.maxHits === "number" ? params.maxHits : 10;
      const hits = await searchSessions(String(params.query ?? ""));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query: params.query,
                totalHits: hits.length,
                hits: hits.slice(0, maxHits),
              },
              null,
              2,
            ),
          },
        ],
        details: { count: hits.length },
      };
    },
  });

  // 2. Knowledge Promotion tool (`FACTS.md`, `AGENTS.md`, `SavedReflection`)
  pi.registerTool({
    name: "umwelten_promote_knowledge",
    label: "Promote Knowledge",
    description:
      "Promote a distilled Project Fact, Agent Instruction, Reflection, or Artifact into project-local Umwelten files (FACTS.md, AGENTS.md, .umwelten/reflections/).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["content"],
      properties: {
        content: {
          type: "string",
          description: "Markdown knowledge or reflection content to promote",
        },
        target: {
          type: "string",
          enum: [
            "project-fact",
            "agent-instruction",
            "saved-reflection",
            "artifact",
          ],
          description:
            "Destination target (auto-classified from content if omitted)",
        },
        title: {
          type: "string",
          description: "Optional short title for reflections or artifacts",
        },
      },
    } as any,
    async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
      const text = String(params.content ?? "");
      const classified = classifyReflectionAnswer(text);
      const target = (params.target ?? classified.primary.target) as PromotionTarget;
      const router = new PromotionRouter({ projectRoot: ctx.cwd });
      const promoted = await router.promote({
        target,
        confidence: classified.primary.confidence,
        label: classified.primary.label,
        content: text,
        title:
          typeof params.title === "string" ? params.title : extractTitle(text),
        source: "heuristic",
      });
      return {
        content: [
          {
            type: "text",
            text: `Promoted to ${promoted.target}: ${promoted.filePath}`,
          },
        ],
        details: { target: promoted.target, filePath: promoted.filePath },
      };
    },
  });

  // 3. `/umwelten-explorations` command
  pi.registerCommand("umwelten-explorations", {
    description:
      "Summarize discovered Source Sessions and Explorations for the current project",
    handler: async (_args, ctx) => {
      initializeAdapters();
      const projected = await projectSessions(ctx.cwd);
      const breakdown = projected.sources
        .filter((s) => s.sessionCount > 0)
        .map((s) => `${s.displayName}: ${s.sessionCount}`)
        .join(", ");
      ctx.ui.notify(
        `Umwelten found ${projected.explorations.length} Explorations (${breakdown || "none yet"})`,
        "info",
      );
    },
  });
}
