import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { getAdapterRegistry, initializeAdapters } from "./adapters/index.js";
import { projectSessions } from "./projection/index.js";
import { searchSessions } from "./search/index.js";
import {
  formatBeatToolSummary,
  messagesToBeats,
} from "./analysis/conversation-beats.js";
import {
  classifyReflectionAnswer,
  extractTitle,
  PromotionRouter,
  type PromotionTarget,
} from "./promotion/index.js";

export const sessionsCommand = new Command("sessions").description(
  "Cross-harness session sensemaking across Pi JSONL, Pi Durable SQLite, Claude Code, and Cursor",
);

sessionsCommand
  .command("explorations")
  .description("List projected Explorations across discovered Source Sessions")
  .option("-p, --project <dir>", "Project directory", process.cwd())
  .option("--json", "Output JSON")
  .action(async (opts: { project: string; json?: boolean }) => {
    initializeAdapters();
    const projected = await projectSessions(opts.project);
    if (opts.json) {
      console.log(JSON.stringify(projected, null, 2));
      return;
    }

    const table = new Table({
      head: ["ID", "Source", "Kind", "Members", "Name"],
    });
    for (const exp of projected.explorations.slice(0, 50)) {
      table.push([
        exp.id.slice(0, 24),
        exp.members[0]?.source ?? "—",
        exp.kind,
        String(exp.memberCount),
        (exp.name || "Untitled").slice(0, 56),
      ]);
    }
    console.log(table.toString());
    console.log(
      chalk.dim(
        `${projected.explorations.length} Exploration(s) projected across ${projected.sources.filter((s) => s.sessionCount > 0).length} active source(s).`,
      ),
    );
  });

sessionsCommand
  .command("search <query>")
  .description("Ripgrep search across persisted session JSONL files")
  .option("-n, --limit <n>", "Maximum hits to display", "20")
  .option("--json", "Output JSON")
  .action(async (query: string, opts: { limit: string; json?: boolean }) => {
    initializeAdapters();
    const hits = await searchSessions(query);
    const limited = hits.slice(0, parseInt(opts.limit, 10) || 20);
    if (opts.json) {
      console.log(JSON.stringify({ query, total: hits.length, hits: limited }, null, 2));
      return;
    }
    for (const h of limited) {
      console.log(
        `${chalk.dim(h.messageTimestamp ?? "")} ${chalk.cyan(h.projectPath ?? "")} [${h.role}] ${h.snippet}`,
      );
    }
    console.log(chalk.dim(`\n${hits.length} total hit(s).`));
  });

sessionsCommand
  .command("beats <sessionId>")
  .description("Show deterministic conversation beats for a discovered session")
  .option("--json", "Output JSON")
  .action(async (sessionId: string, opts: { json?: boolean }) => {
    const registry = getAdapterRegistry();
    for (const source of registry.getSources()) {
      const adapter = registry.get(source);
      if (!adapter) continue;
      const session = await adapter.getSession(sessionId);
      if (!session) continue;
      const beats = messagesToBeats(session.messages);
      if (opts.json) {
        console.log(JSON.stringify(beats, null, 2));
        return;
      }
      for (const beat of beats) {
        const tools = formatBeatToolSummary(beat.toolCount, beat.toolDurationMs);
        console.log(
          `${chalk.cyan(`#${beat.index + 1}`)} ${beat.topic ?? beat.userPreview}${tools ? chalk.dim(` (${tools})`) : ""}`,
        );
      }
      return;
    }
    console.error(`Session "${sessionId}" not found`);
    process.exit(1);
  });

sessionsCommand
  .command("promote <content>")
  .description("Promote distilled knowledge into FACTS.md, AGENTS.md, or .umwelten/reflections/")
  .option("-p, --project <dir>", "Project root", process.cwd())
  .option(
    "-t, --target <target>",
    "Target (project-fact | agent-instruction | saved-reflection | artifact)",
  )
  .option("--title <title>", "Optional title")
  .action(
    async (
      content: string,
      opts: { project: string; target?: string; title?: string },
    ) => {
      const classified = classifyReflectionAnswer(content);
      const target = (opts.target ?? classified.primary.target) as PromotionTarget;
      const router = new PromotionRouter({ projectRoot: opts.project });
      const res = await router.promote({
        target,
        confidence: classified.primary.confidence,
        label: classified.primary.label,
        content,
        title: opts.title ?? extractTitle(content),
        source: "heuristic",
      });
      console.log(`Promoted (${res.target}) → ${res.filePath}`);
    },
  );
