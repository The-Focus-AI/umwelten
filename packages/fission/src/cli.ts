/**
 * `umwelten fission` — CLI surface.
 *
 *   fission chat     talk to a tree in the terminal, watching each decision
 *   fission serve    the tree browser + compaction playground
 *   fission report   write the standalone HTML report
 *   fission list     list trees
 *   fission strategies / detectors   what's registered
 */

import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { FissionStore } from "./tree/store.js";
import { FissionChat } from "./engine/fission-chat.js";
import { listDetectors } from "./detect/registry.js";
import { listAllStrategies } from "./compaction/register.js";
import { buildFissionReport } from "./report/build-report.js";
import { renderReportHtml } from "./report/render-html.js";
import { startFissionServer } from "./server/server.js";
import type { FissionConfig } from "./types.js";

const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_PROVIDER = "google";

interface CommonOptions {
  provider: string;
  model: string;
  analysisModel?: string;
  analysisProvider?: string;
  dir?: string;
}

function modelFrom(options: CommonOptions): ModelDetails {
  return { name: options.model, provider: options.provider };
}

function analysisModelFrom(options: CommonOptions): ModelDetails | undefined {
  if (!options.analysisModel && !options.analysisProvider) return undefined;
  return {
    name: options.analysisModel ?? options.model,
    provider: options.analysisProvider ?? options.provider,
  };
}

function storeFrom(options: CommonOptions): FissionStore {
  return options.dir ? new FissionStore(resolve(options.dir)) : new FissionStore();
}

function addCommon(command: Command): Command {
  return command
    .option("-p, --provider <provider>", "provider for the answering model", DEFAULT_PROVIDER)
    .option("-m, --model <model>", "answering model", DEFAULT_MODEL)
    .option("--analysis-model <model>", "model for analysis/detection/compaction (defaults to --model)")
    .option("--analysis-provider <provider>", "provider for the analysis model")
    .option("--dir <path>", "tree storage directory (default ~/.umwelten/fission)");
}

function configFromOptions(options: Record<string, unknown>): Partial<FissionConfig> {
  const config: Partial<FissionConfig> = {};
  if (options.detector) config.detectorId = String(options.detector);
  if (options.compaction) config.compactionStrategyId = String(options.compaction);
  if (options.carryover) config.carryoverStrategyId = String(options.carryover);
  if (options.threshold !== undefined) config.driftThreshold = Number(options.threshold);
  if (options.keepRecent !== undefined) config.keepRecentMessages = Number(options.keepRecent);
  if (options.autoFork === false) config.autoFork = false;
  if (options.shadow) {
    config.shadowDetectorIds = String(options.shadow)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }
  return config;
}

export const fissionCommand = new Command("fission").description(
  "Session fission: per-turn compaction, drift detection, and automatic thread spin-off",
);

// ------------------------------------------------------------------- chat

addCommon(
  fissionCommand
    .command("chat")
    .description("Chat with a fission tree in the terminal, watching every decision")
    .option("-t, --tree <treeId>", "resume an existing tree")
    .option("--title <title>", "title for a new tree", "Terminal exploration")
    .option("-d, --detector <id>", "fission detector")
    .option("-c, --compaction <id>", "compaction strategy")
    .option("--carryover <id>", "carry-over strategy for forks")
    .option("--threshold <n>", "drift threshold (0-1)")
    .option("--keep-recent <n>", "messages left verbatim at the tail")
    .option("--shadow <ids>", "comma-separated shadow detectors")
    .option("--no-auto-fork", "propose forks but don't apply them"),
).action(async (options) => {
  const store = storeFrom(options);
  const chat = options.tree
    ? await FissionChat.open({
        treeId: options.tree,
        store,
        model: modelFrom(options),
        analysisModel: analysisModelFrom(options),
      })
    : await FissionChat.create({
        store,
        model: modelFrom(options),
        analysisModel: analysisModelFrom(options),
        title: options.title,
        config: configFromOptions(options) as FissionConfig,
      });

  console.log(chalk.bold(`\n${chat.tree.data.title}`));
  console.log(chalk.dim(`tree ${chat.tree.id} · ${chat.tree.config.detectorId} @ ${chat.tree.config.driftThreshold} · ${chat.tree.config.compactionStrategyId}`));
  console.log(chalk.dim("Type a message. Ctrl+C to exit.\n"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const node = chat.activeNode;
      const text = await rl.question(chalk.cyan(`[${node.title}] › `));
      if (!text.trim()) continue;

      let streamed = false;
      await chat.send(text, {
        onEvent: (event) => {
          switch (event.type) {
            case "detect":
              if (!event.shadow) {
                const color = event.result.verdict === "fork" ? chalk.yellow : chalk.dim;
                console.log(
                  color(
                    `  ${event.result.verdict === "fork" ? "⑂" : "→"} ${event.result.detectorId} ${event.result.driftScore.toFixed(2)}/${event.result.threshold.toFixed(2)} ${event.result.usedLlm ? "(LLM)" : "(free)"} — ${event.result.reason}`,
                  ),
                );
              } else {
                console.log(
                  chalk.dim(
                    `    shadow ${event.result.detectorId}: ${event.result.verdict} ${event.result.driftScore.toFixed(2)}`,
                  ),
                );
              }
              break;
            case "fork":
              console.log(chalk.yellow.bold(`  ⑂ spun off "${event.child.title}"`));
              break;
            case "fork-proposed":
              console.log(chalk.yellow(`  ⑂ fork proposed but not applied — ${event.reason}`));
              break;
            case "tool-call":
              console.log(chalk.magenta(`  ⚒ ${event.name}`));
              break;
            case "answer-delta":
              process.stdout.write(event.delta);
              streamed = true;
              break;
            case "answer":
              if (!streamed) process.stdout.write(event.text);
              process.stdout.write("\n");
              break;
            case "compaction":
              console.log(
                chalk.dim(
                  `  ⤳ ${event.record.strategyId}: ${event.record.tokensBefore} → ${event.record.tokensAfter} tok (${(event.record.ratio * 100).toFixed(0)}%, ${event.record.latencyMs} ms)`,
                ),
              );
              break;
            case "error":
              console.log(chalk.red(`  ! ${event.message}`));
              break;
          }
        },
      });
      console.log();
    }
  } finally {
    rl.close();
  }
});

// ------------------------------------------------------------------ serve

addCommon(
  fissionCommand
    .command("serve")
    .description("Start the tree browser and compaction playground")
    .option("--port <port>", "port", "7431")
    .option("--host <host>", "bind address", "127.0.0.1"),
).action(async (options) => {
  const handle = await startFissionServer({
    port: Number(options.port),
    host: options.host,
    store: storeFrom(options),
    model: modelFrom(options),
    analysisModel: analysisModelFrom(options),
  });
  console.log(chalk.bold(`Fission browser: ${handle.url}`));
  console.log(chalk.dim(`answering with ${options.provider}/${options.model}`));
  console.log(chalk.dim("Ctrl+C to stop."));
});

// ----------------------------------------------------------------- report

addCommon(
  fissionCommand
    .command("report")
    .argument("[treeId]", "tree to report on (defaults to the most recent)")
    .description("Write a standalone HTML report for a tree")
    .option("-o, --out <path>", "output file (default fission-report.html)")
    .option("--json", "emit JSON instead of HTML"),
).action(async (treeId, options) => {
  const store = storeFrom(options);
  let id = treeId;
  if (!id) {
    const trees = await store.listTrees();
    if (trees.length === 0) {
      console.error(chalk.red("No trees found. Run `umwelten fission chat` first."));
      process.exitCode = 1;
      return;
    }
    id = trees[0].id;
  }

  const tree = await store.load(id);
  const report = buildFissionReport(tree);
  const out = resolve(
    options.out ?? (options.json ? "fission-report.json" : "fission-report.html"),
  );
  await writeFile(out, options.json ? JSON.stringify(report, null, 2) : renderReportHtml(report), "utf8");

  console.log(chalk.bold(`Report written to ${out}`));
  console.log(
    chalk.dim(
      `${report.stats.turnCount} turns · ${report.stats.nodeCount} threads · ${report.stats.forkCount} forks · ${report.stats.labeledTurns} labeled`,
    ),
  );
  if (report.stats.labeledTurns === 0) {
    console.log(
      chalk.dim(
        "No labeled turns — detector accuracy is empty. Label decisions in `umwelten fission serve` to fill it in.",
      ),
    );
  }
});

// ------------------------------------------------------------------- list

addCommon(
  fissionCommand.command("list").description("List stored fission trees"),
).action(async (options) => {
  const trees = await storeFrom(options).listTrees();
  if (trees.length === 0) {
    console.log(chalk.dim("No trees yet."));
    return;
  }
  for (const tree of trees) {
    console.log(
      `${chalk.bold(tree.title)}  ${chalk.dim(tree.id)}\n  ${Object.keys(tree.nodes).length} threads · ${tree.config.detectorId} · updated ${tree.updatedAt.slice(0, 19).replace("T", " ")}`,
    );
  }
});

// -------------------------------------------------------- strategies/detectors

fissionCommand
  .command("strategies")
  .description("List registered compaction strategies")
  .action(async () => {
    for (const strategy of await listAllStrategies()) {
      console.log(`${chalk.bold(strategy.id)}\n  ${strategy.description}`);
    }
  });

fissionCommand
  .command("detectors")
  .description("List registered fission detectors")
  .action(() => {
    for (const detector of listDetectors()) {
      console.log(
        `${chalk.bold(detector.id)} ${detector.usesLlm ? chalk.yellow("(may call the model)") : chalk.green("(free)")}\n  ${detector.description}`,
      );
    }
  });
