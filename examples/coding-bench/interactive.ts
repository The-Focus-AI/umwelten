#!/usr/bin/env node
/**
 * Interactive Terminal Coding-Session Eval & REPL (`pnpm run bench:interactive`
 * or `pnpm run bench:code -- --interactive`).
 *
 * Lets you pick fixture, model, thinking effort, and extensions (or prefill
 * via CLI flags), watches live tool calls & streaming partials in the shell,
 * supports `Ctrl+C` abort without losing the checkout, and opens a post-run
 * REPL (`/diff`, `/status`, `/grade`, `/tests`, `/save`, `/quit`, or chat).
 */

import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  BUILTIN_CODING_EXTENSIONS,
  InteractiveCodingSession,
  type CodingSessionEvent,
  type CodingSessionRecord,
  type CodingTaskSpec,
} from "@umwelten/evaluation";
import {
  canonicalizeThinkingEffort,
  formatModelSpecString,
  parseModelSpecString,
  type ThinkingEffort,
} from "@umwelten/pi";
import {
  loadModelMatrix,
  selectMatrixModels,
  type MatrixModelEntry,
} from "../_shared/model-matrix.js";
import {
  createMockTargetMap,
  MOCK_CODING_MODELS,
} from "./mock-solutions.js";
import { saveSingleRecordToCodingReport } from "./report-store.js";
import { loadCodingFixtures } from "./tasks.js";

const EFFORT_OPTIONS: Array<ThinkingEffort | "default"> = [
  "default",
  "off",
  "low",
  "medium",
  "high",
];

function splitCsv(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

interface PromptReader {
  ask(prompt: string): Promise<string | null>;
  close(): void;
}

function createQueuedPromptReader(): PromptReader {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const queue: string[] = [];
  const waiters: Array<(line: string | null) => void> = [];
  let closed = false;

  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else queue.push(line);
  });

  rl.on("close", () => {
    closed = true;
    while (waiters.length > 0) {
      waiters.shift()!(null);
    }
  });

  return {
    ask(prompt: string): Promise<string | null> {
      process.stdout.write(prompt);
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    close() {
      if (!closed) {
        closed = true;
        rl.close();
      }
    },
  };
}

async function promptChoice(
  rl: PromptReader,
  label: string,
  items: Array<{ title: string; detail?: string }>,
  defaultIdx: number = 0,
): Promise<number> {
  console.log(`\n${label}:`);
  items.forEach((item, i) => {
    const marker = i === defaultIdx ? "*" : " ";
    console.log(
      `  ${marker}[${i + 1}] ${item.title}${item.detail ? ` — ${item.detail}` : ""}`,
    );
  });
  while (true) {
    const answer = await rl.ask(
      `Select [1-${items.length}] (default ${defaultIdx + 1}): `,
    );
    if (answer === null) return defaultIdx;
    const raw = answer.trim();
    if (!raw) return defaultIdx;
    const n = parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) {
      return n - 1;
    }
    console.log(`Please enter a number between 1 and ${items.length}.`);
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${s.length > 60 ? s.slice(0, 57) + "..." : s}`;
    })
    .join(", ");
}

function printGradeCard(rec: CodingSessionRecord, label: string): void {
  const icon = rec.passed ? "✅ PASS" : rec.score > 0 ? "🟡 PARTIAL" : "❌ FAIL";
  console.log(`\n┌─ ${label}: ${icon} (${rec.score}/${rec.maxScore}) ─────────────────────────`);
  console.log(
    `│ Visible: ${rec.visibleTests.passed}/${rec.visibleTests.total} · ` +
      `Hidden: ${rec.hiddenTests.passed}/${rec.hiddenTests.total}` +
      (rec.cheatedProtectedFiles ? " · CHEATED PROTECTED FILES" : ""),
  );
  console.log(
    `│ Turns: ${rec.turns} · Tools: ${rec.toolCallsTotal} (${rec.toolErrors} err) · ` +
      `Cost: $${rec.costUsd.toFixed(4)} · Time: ${(rec.durationMs / 1000).toFixed(1)}s`,
  );
  if (rec.changedFiles.length > 0) {
    console.log(`│ Changed: ${rec.changedFiles.join(", ")}`);
  }
  console.log("└────────────────────────────────────────────────────────────");
}

function createTerminalEventPrinter(): (event: CodingSessionEvent) => void {
  let lastPartialAt = 0;
  let partialNoticePrinted = false;

  return (event: CodingSessionEvent) => {
    switch (event.type) {
      case "session_started":
        console.log(
          `\n▶ Started session ${event.sessionId} · ${event.provider}:${event.model}[${event.effort}]` +
            `\n  Fixture: ${event.taskId} (${event.title})` +
            `\n  Extensions: ${event.extensionProfile}` +
            `\n  Checkout: ${event.workspaceDir}`,
        );
        break;
      case "turn_start":
        partialNoticePrinted = false;
        console.log(`\n── Turn ${event.turn} (ctrl+c to abort) ──`);
        break;
      case "partial": {
        const now = Date.now();
        if (now - lastPartialAt < 750) break;
        lastPartialAt = now;
        const statusParts: string[] = [];
        if (event.thinking.length > 0) statusParts.push(`think ${event.thinking.length}c`);
        if (event.text.length > 0) statusParts.push(`text ${event.text.length}c`);
        if (event.activeTools.length > 0) {
          statusParts.push(
            event.activeTools.map((t) => `${t.name}:${t.status}`).join(","),
          );
        }
        if (statusParts.length > 0) {
          console.log(`  ... streaming (${statusParts.join(" · ")})`);
          partialNoticePrinted = true;
        }
        break;
      }
      case "assistant_turn":
        if (partialNoticePrinted) partialNoticePrinted = false;
        if (event.thinking.trim()) {
          const snippet = event.thinking.trim().slice(0, 220).replace(/\s+/g, " ");
          console.log(`  [think] ${snippet}${event.thinking.length > 220 ? "..." : ""}`);
        }
        if (event.text.trim()) {
          console.log(`  [assistant] ${event.text.trim()}`);
        }
        console.log(
          `  ($${event.costUsd.toFixed(4)} · ${event.tokens.total} tok${event.tokens.reasoning ? ` / ${event.tokens.reasoning} think` : ""})`,
        );
        break;
      case "tool_start":
        console.log(`  → ${event.name}(${summarizeArgs(event.arguments)})`);
        break;
      case "tool_end": {
        const firstLine = event.outputPreview.split("\n")[0]?.slice(0, 120) ?? "";
        const tag = event.isError ? "✗" : "✓";
        console.log(`  ${tag} ${event.name}${firstLine ? `: ${firstLine}` : ""}`);
        break;
      }
      case "graded":
        printGradeCard(
          event.record,
          event.isInitialEval ? "Initial Autonomous Grade" : "Re-Graded Snapshot",
        );
        break;
      case "followup_done":
        console.log(
          `\n  [follow-up done · +${event.turns} turn(s), +$${event.costUsd.toFixed(4)}]`,
        );
        break;
      case "status":
        if (event.error) {
          console.log(`  ! status=${event.status}: ${event.error}`);
        }
        break;
    }
  };
}

export interface InteractiveCliOptions {
  argv?: string[];
}

export async function runInteractiveCodingCli(
  options: InteractiveCliOptions = {},
): Promise<void> {
  const { values } = parseArgs({
    args: (options.argv ?? process.argv.slice(2)).filter((a) => a !== "--"),
    options: {
      interactive: { type: "boolean", short: "i", default: false },
      live: { type: "boolean", default: false },
      mock: { type: "boolean", default: false },
      models: { type: "string" },
      tasks: { type: "string" },
      effort: { type: "string" },
      extensions: { type: "string" },
      extension: { type: "string", multiple: true },
      "max-turns": { type: "string" },
      "timeout-sec": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage: pnpm run bench:interactive [-- --mock|--live --models provider:model --tasks 01-ledger-rounding --effort high]

Interactive Terminal Coding-Session Eval & REPL on @earendil-works/pi-durable.
Flags may be prefilled or omitted for interactive numbered prompts.

REPL commands after initial autonomous run:
  /diff     Show git status & unified diff inside the isolated checkout
  /status   Show session status, turns, cost, and latest score
  /grade    Re-grade a clean snapshot against visible + held-out hidden tests
  /tests    Run the public tests inside the checkout
  /save     Save the INITIAL autonomous score to reports/data/coding-bench-{live,mock}.json
  /quit     Clean up the temporary checkout and exit`);
    return;
  }

  const rl = createQueuedPromptReader();
  let session: InteractiveCodingSession | undefined;
  let shuttingDown = false;

  const sigintHandler = () => {
    if (
      session &&
      (session.status === "running" || session.status === "chatting")
    ) {
      console.log("\n⚠ Abort requested — stopping current agent turn cleanly...");
      void session.abort();
      return;
    }
    if (!shuttingDown) {
      shuttingDown = true;
      console.log("\nClosing checkout and exiting...");
      void (async () => {
        if (session) await session.close();
        rl.close();
        process.exit(0);
      })();
    }
  };

  process.on("SIGINT", sigintHandler);

  try {
    console.log("═══ Umwelten · Interactive Pi Durable Coding-Session Eval ═══");
    const fixtures = loadCodingFixtures();

    // 1. Mode (live vs mock)
    let isLive = values.live && !values.mock;
    if (!values.live && !values.mock) {
      const idx = await promptChoice(
        rl,
        "Mode",
        [
          { title: "Live API / Local GPU", detail: "calls configured cloud keys or local Ollama/MLX" },
          { title: "Mock Preview", detail: "offline fauxProvider scripted fixes + real grading" },
        ],
        0,
      );
      isLive = idx === 0;
    }

    // 2. Fixture
    const preTasks = splitCsv(values.tasks);
    let task: CodingTaskSpec;
    if (preTasks?.length) {
      const found = fixtures.find((t) => t.id === preTasks[0]);
      if (!found) throw new Error(`Unknown task "${preTasks[0]}"`);
      task = found;
    } else {
      const idx = await promptChoice(
        rl,
        "Coding Fixture",
        fixtures.map((t) => ({
          title: `${t.id} — ${t.title}`,
          detail: `${t.difficulty} · ${t.language}`,
        })),
        0,
      );
      task = fixtures[idx];
    }

    // 3. Model
    const manifest = loadModelMatrix();
    const matrixModels: MatrixModelEntry[] = isLive
      ? selectMatrixModels(manifest, { groups: Object.keys(manifest.groups) })
      : [...MOCK_CODING_MODELS];

    let spec: MatrixModelEntry;
    const preModels = splitCsv(values.models);
    if (preModels?.length) {
      const parsed = parseModelSpecString(preModels[0]);
      const match = matrixModels.find(
        (m) => m.provider === parsed.provider && m.name === parsed.name,
      );
      spec = match
        ? { ...match, ...(parsed.reasoningEffort ? { reasoningEffort: parsed.reasoningEffort } : {}) }
        : {
            ...parsed,
            weights: parsed.provider === "ollama" || parsed.provider === "mlx" ? "open" : "closed",
            tier: parsed.provider === "ollama" || parsed.provider === "mlx" ? "local" : "cloud",
            enabled: true,
          };
    } else {
      const items = [
        ...matrixModels.map((m) => ({
          title: `${m.provider}:${m.name}`,
          detail: `${m.group ?? m.tier} · ${m.weights}${m.reasoningEffort ? ` @${m.reasoningEffort}` : ""}`,
        })),
        { title: "Custom provider:model[@effort]", detail: "enter any Pi spec manually" },
      ];
      const idx = await promptChoice(rl, "Model", items, 0);
      if (idx === items.length - 1) {
        const raw = ((await rl.ask("Enter provider:model[@effort]: ")) ?? "").trim();
        const parsed = parseModelSpecString(raw);
        spec = {
          ...parsed,
          weights: parsed.provider === "ollama" || parsed.provider === "mlx" ? "open" : "closed",
          tier: parsed.provider === "ollama" || parsed.provider === "mlx" ? "local" : "cloud",
          enabled: true,
        };
      } else {
        spec = { ...matrixModels[idx] };
      }
    }

    // 4. Thinking effort
    if (values.effort) {
      const eff = canonicalizeThinkingEffort(
        splitCsv(values.effort)?.[0] as ThinkingEffort,
      );
      if (eff) spec = { ...spec, reasoningEffort: eff };
    } else if (!spec.reasoningEffort) {
      const idx = await promptChoice(
        rl,
        "Thinking Effort",
        EFFORT_OPTIONS.map((e) => ({ title: e })),
        spec.tier === "local" ? 1 : 2,
      );
      const chosen = EFFORT_OPTIONS[idx];
      if (chosen !== "default") {
        spec = { ...spec, reasoningEffort: chosen };
      }
    }

    // 5. Extensions
    let extensionNames = splitCsv(values.extensions);
    const customExtensionPaths = (values.extension ?? []).flatMap((item) =>
      item.split(",").map((s) => s.trim()).filter(Boolean),
    );
    if (!extensionNames) {
      const extChoice = await promptChoice(
        rl,
        "Pi Durable Extension Profile",
        [
          { title: "pi-default", detail: "read, write, edit, bash + repo-scope guard" },
          { title: "pi-default + search-tools", detail: "adds find_files & grep_files" },
          { title: "pi-default + verify-on-yield", detail: "auto-nudges on yield if visible tests fail" },
          { title: "pi-default + search-tools + verify-on-yield", detail: "search + self-check loop" },
          { title: "Custom CSV list / extension path", detail: `built-ins: ${BUILTIN_CODING_EXTENSIONS.join(", ")}` },
        ],
        0,
      );
      if (extChoice === 0) extensionNames = ["pi-default"];
      else if (extChoice === 1) extensionNames = ["search-tools"];
      else if (extChoice === 2) extensionNames = ["verify-on-yield"];
      else if (extChoice === 3) extensionNames = ["search-tools", "verify-on-yield"];
      else {
        const rawExt = ((await rl.ask("Built-ins CSV (e.g. search-tools,codemode): ")) ?? "").trim();
        extensionNames = splitCsv(rawExt) ?? ["pi-default"];
        const rawPath = ((await rl.ask("Optional custom extension file path (or blank): ")) ?? "").trim();
        if (rawPath) customExtensionPaths.push(rawPath);
      }
    }

    const maxTurns = values["max-turns"]
      ? parseInt(values["max-turns"], 10)
      : undefined;
    const timeoutMs = values["timeout-sec"]
      ? parseInt(values["timeout-sec"], 10) * 1000
      : undefined;

    const evalDir = path.join(
      process.cwd(),
      "output",
      isLive ? "evaluations" : "mock-evaluations",
      "coding-bench",
      "runs",
      "001",
    );
    const overrideTarget = isLive
      ? undefined
      : createMockTargetMap([spec]).get(formatModelSpecString(spec));

    session = await InteractiveCodingSession.start({
      task,
      spec,
      extensionNames,
      customExtensionPaths,
      maxTurns,
      timeoutMs,
      outputDir: evalDir,
      overrideTarget,
      onEvent: createTerminalEventPrinter(),
    });

    await session.runInitialEval();

    console.log(
      "\nCommands: /diff · /status · /grade · /tests · /save · /quit · or type a follow-up message to keep chatting in this checkout.",
    );

    while (!shuttingDown && session.status !== "closed") {
      const line = await rl.ask(`\n[${task.id} · ${session.status}] > `);
      if (line === null) break;
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "exit") {
        break;
      } else if (trimmed === "/diff") {
        const diff = await session.getDiff();
        console.log(diff.gitDiff || "(clean working tree — no tracked modifications)");
      } else if (trimmed === "/status") {
        const diff = await session.getDiff();
        console.log(
          diff.changedFiles.length > 0
            ? `Changed files:\n  ${diff.changedFiles.join("\n  ")}\n\n${diff.gitDiffStat}`
            : "(no changed files)",
        );
      } else if (trimmed === "/grade") {
        await session.grade();
      } else if (trimmed === "/tests") {
        console.log(
          session.latestRecord?.gradingOutput ||
            "(no grading output recorded yet)",
        );
      } else if (trimmed === "/save") {
        if (!session.initialRecord) {
          console.log("Nothing to save: initial autonomous evaluation did not complete.");
        } else {
          const { outPath } = saveSingleRecordToCodingReport({
            record: session.initialRecord,
            mode: isLive ? "live" : "mock",
            specCosts: spec.costs,
          });
          console.log(`✅ Saved initial autonomous score to ${outPath}`);
        }
      } else {
        try {
          await session.sendFollowUp(trimmed);
        } catch (err) {
          console.error(
            `Error in follow-up: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    if (session) {
      await session.close();
    }
    rl.close();
  }
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  runInteractiveCodingCli().catch((err) => {
    console.error("Interactive coding session failed:", err);
    process.exit(1);
  });
}
