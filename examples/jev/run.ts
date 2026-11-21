import "@umwelten/pi";
import { parseArgs } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createJevBackend,
  createLlmJudgmentBackend,
  runPilot,
  summarizePilot,
  validateCase,
} from "@umwelten/evaluation";
import { FAST_MODEL_ROSTER } from "../_shared/fast-models.js";
import { setupExampleRuntime } from "../_shared/mock-runtime.js";
import { PILOT_CASES } from "./fixtures.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    backend: { type: "string", default: "openrouter" },
    provider: { type: "string" },
    model: { type: "string" },
    limit: { type: "string", default: "6" },
    out: { type: "string", default: "output/jev/pilot" },
    mock: { type: "boolean", default: false },
    live: { type: "boolean", default: false },
    replay: { type: "boolean", default: false },
    "reverse-options": { type: "boolean", default: false },
  },
});

const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > PILOT_CASES.length)
  throw new Error("--limit must be an integer from 1 to 60");
if ([values.mock, values.live, values.replay].filter(Boolean).length > 1)
  throw new Error("Choose at most one of --mock, --live, or --replay");
if (!["openrouter", "typesafe", "mycel", "llm"].includes(values.backend))
  throw new Error("--backend must be openrouter, typesafe, mycel or llm");
if (values.backend === "llm" && (!values.provider || !values.model))
  throw new Error("LLM mode requires --provider and --model");

// Interleave families so the default three-call smoke covers all judgment kinds.
const families = ["support", "evidence", "completion"];
const cases = Array.from({ length: 20 }, (_, i) =>
  families.map((family) => PILOT_CASES.filter((c) => c.family === family)[i]),
)
  .flat()
  .slice(0, limit)
  .map((original) => {
    const testCase = structuredClone(original);
    if (values["reverse-options"]) {
      for (const q of Object.values(testCase.request.questions)) {
        if (q.kind === "choice")
          q.options = Object.fromEntries(Object.entries(q.options).reverse());
      }
    }
    return testCase;
  });
PILOT_CASES.forEach(validateCase);
if (values.mock) {
  setupExampleRuntime(FAST_MODEL_ROSTER, { fresh: true });
}
const backend = values.mock
  ? createLlmJudgmentBackend({
      provider: values.provider ?? "google",
      name: values.model ?? "gemini-3.8-flash",
    })
  : values.backend === "llm"
    ? createLlmJudgmentBackend({
        provider: values.provider!,
        name: values.model!,
      })
    : createJevBackend({
        provider: values.backend as "openrouter" | "typesafe" | "mycel",
        model: values.model,
      });

if (values.mock) {
  const mockOut = path.join(os.tmpdir(), `umwelten-jev-mock-${process.pid}`);
  await mkdir(mockOut, { recursive: true });
  try {
    const { records } = await runPilot(backend, cases, mockOut, {});
    const s = summarizePilot(records);
    console.log(
      JSON.stringify(
        {
          mode: "mock",
          backend: backend.identity,
          cases: s.calls,
          completed: s.completed,
          groups: s.groups.map((g) => ({
            key: g.key,
            accuracy: g.accuracyAmongValid,
            meanBrier: g.meanBrier !== null ? Number(g.meanBrier.toFixed(4)) : null,
            meanRps:
              g.meanRankedProbabilityScore !== null
                ? Number(g.meanRankedProbabilityScore.toFixed(4))
                : null,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(mockOut, { recursive: true, force: true });
  }
} else if (!values.live && !values.replay) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        dataset: "synthetic-development-v1",
        validatedCases: PILOT_CASES.length,
        selectedCases: cases.length,
        families,
        backend: backend.identity,
        note: "No inference or account changes. Add --live for paid calls or --replay for cached results. This dry run produces no model results.",
      },
      null,
      2,
    ),
  );
} else {
  if (values.live) {
    const key =
      values.backend === "typesafe"
        ? "TYPESAFE_API_KEY"
        : values.backend === "openrouter"
          ? "OPENROUTER_API_KEY"
          : values.backend === "mycel" || values.provider === "mycel"
            ? "MYCEL_API_KEY"
            : values.provider === "openrouter"
              ? "OPENROUTER_API_KEY"
              : undefined;
    if (key && !process.env[key])
      throw new Error(`Configure ${key} in the environment before --live`);
    if (
      (values.backend === "mycel" || values.provider === "mycel") &&
      (!process.env.MYCEL_URL ||
        !(process.env.MYCEL_END_USER || process.env.HABITAT_ID))
    ) {
      throw new Error(
        "Mycel requires MYCEL_URL and MYCEL_END_USER (or HABITAT_ID), in addition to its Application credential",
      );
    }
  }
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const { records, cacheHits } = await runPilot(backend, cases, values.out, {
    replay: values.replay,
    signal: controller.signal,
  });
  const summary = {
    backend: backend.identity,
    cacheHits,
    ...summarizePilot(records),
  };
  await writeFile(
    path.join(values.out, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exitCode = 1;
}
