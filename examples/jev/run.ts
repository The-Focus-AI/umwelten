import "@umwelten/core/env/load.js";
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createJevBackend } from "@umwelten/core/judgment/jev.js";
import { createLlmJudgmentBackend } from "@umwelten/core/judgment/llm.js";
import {
  runPilot,
  summarizePilot,
  validateCase,
} from "@umwelten/evaluation/evaluation/judgment/pilot.js";
import { PILOT_CASES } from "./fixtures.js";

const { values } = parseArgs({
  options: {
    backend: { type: "string", default: "openrouter" },
    provider: { type: "string" },
    model: { type: "string" },
    limit: { type: "string", default: "3" },
    out: { type: "string", default: "output/jev/pilot" },
    live: { type: "boolean", default: false },
    replay: { type: "boolean", default: false },
    "reverse-options": { type: "boolean", default: false },
  },
});

const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > PILOT_CASES.length)
  throw new Error("--limit must be an integer from 1 to 60");
if (values.live && values.replay)
  throw new Error("Choose --live or --replay, not both");
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
const backend =
  values.backend === "llm"
    ? createLlmJudgmentBackend({
        provider: values.provider!,
        name: values.model!,
      })
    : createJevBackend({
        provider: values.backend as "openrouter" | "typesafe" | "mycel",
        model: values.model,
      });

if (!values.live && !values.replay) {
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
