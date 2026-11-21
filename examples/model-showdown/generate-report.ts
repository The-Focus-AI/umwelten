#!/usr/bin/env node
/**
 * Multi-Suite Combined Report Generator
 *
 * Combines cached per-dimension `EvalSuite` runs into normalized scorecards.
 * Defaults to `output/mock-evaluations` (`MODEL_WATCH_SUITE`) unless `--live`
 * is passed.
 *
 * Usage:
 *   pnpm tsx examples/model-showdown/generate-report.ts               # console table (mock cache)
 *   pnpm tsx examples/model-showdown/generate-report.ts --live        # console table (live cache)
 *   pnpm tsx examples/model-showdown/generate-report.ts --format md   # structured markdown
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildNarrativeReport,
  buildSuiteReport,
  loadSuite,
} from "@umwelten/evaluation/evaluation/combine/index.js";
import { Reporter } from "@umwelten/evaluation/reporting/reporter.js";
import { MODEL_WATCH_SUITE, SHOWDOWN_SUITE } from "./suite-config.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const isLive = args.includes("--live");
const useLegacy = args.includes("--legacy-showdown");

const baseDir = isLive
  ? path.join(process.cwd(), "output", "evaluations")
  : path.join(process.cwd(), "output", "mock-evaluations");

const formatIdx = args.indexOf("--format");
const format = formatIdx >= 0 ? args[formatIdx + 1] : "console";

const outputIdx = args.indexOf("--output");
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

const baseSuite = useLegacy ? SHOWDOWN_SUITE : MODEL_WATCH_SUITE;
const result = loadSuite(baseSuite, { baseDir });

if (result.scorecards.length === 0) {
  console.error(`No cached suite results found under ${baseDir}.`);
  console.error(
    `Run \`pnpm run site:bench${isLive ? " --live" : ""}\` first to populate the suite caches.`,
  );
  process.exit(1);
}

const reporter = new Reporter();
let output = "";

if (format === "narrative" || format === "full") {
  output = buildNarrativeReport(result, {
    title: "Umwelten Multi-Dimension Evaluation Report",
  });
} else if (format === "md" || format === "markdown") {
  output = reporter.toMarkdown(
    buildSuiteReport(result, { title: "Umwelten — Combined Dimension Standings" }),
  );
} else if (format === "json") {
  output = reporter.toJson(
    buildSuiteReport(result, { title: "Umwelten — Combined Dimension Standings" }),
  );
} else {
  reporter.toConsole(
    buildSuiteReport(result, { title: "Umwelten — Combined Dimension Standings" }),
  );
}

if (outputFile && output) {
  const resolved = path.resolve(outputFile);
  fs.writeFileSync(resolved, output, "utf8");
  console.error(`Report saved to: ${resolved}`);
} else if (output) {
  console.log(output);
}
