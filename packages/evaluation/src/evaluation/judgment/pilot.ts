import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  JudgmentAnswer,
  JudgmentBackend,
  JudgmentRequest,
  JudgmentResult,
} from "@umwelten/core/judgment/types.js";
import { JudgmentError } from "@umwelten/core/judgment/types.js";
import { validateRequest } from "@umwelten/core/judgment/schema.js";
import {
  brierScore,
  rankedProbabilityScore,
  reliabilityBins,
  selectiveRisk,
} from "./metrics.js";

export interface JudgmentCase {
  id: string;
  family: string;
  group: string;
  request: JudgmentRequest;
  /** Binary boolean, choice key, or zero-based ordinal index. Never sent to a backend. */
  expected: Record<string, boolean | string | number>;
}

export interface PilotRecord {
  version: 1;
  key: string;
  backend: string;
  case: JudgmentCase;
  result?: JudgmentResult;
  error?: string;
  errorDetails?: { status?: number; raw?: unknown };
}

/** JSON insertion order is intentional: option/question order is experimental data. */
export function pilotKey(backend: string, testCase: JudgmentCase): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, backend, testCase }))
    .digest("hex");
}

export function validateCase(testCase: JudgmentCase): void {
  validateRequest(testCase.request);
  const questions = Object.entries(testCase.request.questions);
  if (
    !testCase.id ||
    !testCase.family ||
    !testCase.group ||
    questions.length !== Object.keys(testCase.expected).length
  )
    throw new Error("Invalid case metadata/labels");
  for (const [id, q] of questions) {
    const label = testCase.expected[id];
    if (
      q.kind === "binary"
        ? typeof label !== "boolean"
        : q.kind === "choice"
          ? typeof label !== "string" || !Object.hasOwn(q.options, label)
          : typeof label !== "number" ||
            !Number.isInteger(label) ||
            label < 0 ||
            label >= q.levels.length
    )
      throw new Error(`Invalid label ${testCase.id}/${id}`);
  }
}

/** Sequential, bounded, opt-in calls. Reuses both successes and failures; use a new directory to repeat. */
export async function runPilot(
  backend: JudgmentBackend,
  cases: readonly JudgmentCase[],
  directory: string,
  options: { replay?: boolean; signal?: AbortSignal; timeoutMs?: number } = {},
) {
  cases.forEach(validateCase);
  if (new Set(cases.map((c) => c.id)).size !== cases.length)
    throw new Error("Duplicate case ids");
  if (!options.replay) await mkdir(directory, { recursive: true });
  const records: PilotRecord[] = [];
  let cacheHits = 0;
  for (const testCase of cases) {
    options.signal?.throwIfAborted();
    const key = pilotKey(backend.identity, testCase);
    const file = path.join(directory, `${key}.json`);
    try {
      const record = JSON.parse(await readFile(file, "utf8")) as PilotRecord;
      if (
        record.version !== 1 ||
        record.key !== key ||
        pilotKey(record.backend, record.case) !== key ||
        Boolean(record.result) === Boolean(record.error)
      )
        throw new Error(`Invalid cached record: ${key}`);
      records.push(record);
      cacheHits++;
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (options.replay)
        throw new Error(
          `Replay cache missing for ${testCase.id}; no calls made`,
          { cause: error },
        );
    }
    const record: PilotRecord = {
      version: 1,
      key,
      backend: backend.identity,
      case: testCase,
    };
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      record.result = await backend.judge(testCase.request, { signal });
    } catch (error) {
      // Avoid persisting arbitrary SDK messages, which can include requests/headers.
      record.error = error instanceof Error ? error.name : "UnknownError";
      if (error instanceof JudgmentError) {
        record.error = error.kind;
        record.errorDetails = error.details;
      }
    }
    await writeFile(`${file}.tmp`, JSON.stringify(record, null, 2));
    await rename(`${file}.tmp`, file);
    records.push(record);
    options.signal?.throwIfAborted();
  }
  return { records, cacheHits };
}

function scoreAnswer(
  answer: JudgmentAnswer,
  expected: boolean | string | number,
) {
  let probabilities: number[];
  let observed: number;
  let selected: number;
  if (answer.kind === "binary") {
    probabilities = [1 - answer.probabilityTrue, answer.probabilityTrue];
    observed = Number(expected);
    selected = answer.probabilityTrue >= 0.5 ? 1 : 0;
  } else if (answer.kind === "choice") {
    const keys = Object.keys(answer.probabilities);
    probabilities = Object.values(answer.probabilities);
    observed = keys.indexOf(String(expected));
    selected = keys.indexOf(answer.selected);
  } else {
    probabilities = answer.probabilities;
    observed = Number(expected);
    selected = probabilities.indexOf(Math.max(...probabilities));
  }
  return {
    probability: probabilities[selected],
    correct: selected === observed,
    brier: brierScore(probabilities, observed),
    rps:
      answer.kind === "ordinal"
        ? rankedProbabilityScore(probabilities, observed)
        : null,
  };
}

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const percentile = (values: number[], quantile: number) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1]
    : null;

export function summarizePilot(records: readonly PilotRecord[]) {
  const rows = records.flatMap((record) =>
    Object.entries(record.case.request.questions).map(([id, question]) => ({
      family: record.case.family,
      kind: question.kind,
      score: record.result
        ? scoreAnswer(record.result.answers[id], record.case.expected[id])
        : null,
    })),
  );
  const groups = [...new Set(rows.map((r) => `${r.family}/${r.kind}`))].map(
    (key) => {
      const group = rows.filter((r) => `${r.family}/${r.kind}` === key);
      const scores = group.flatMap((r) => (r.score ? [r.score] : []));
      return {
        key,
        questions: group.length,
        valid: scores.length,
        failed: group.length - scores.length,
        accuracyAmongValid: mean(scores.map((s) => Number(s.correct))),
        meanBrier: mean(scores.map((s) => s.brier)),
        meanRankedProbabilityScore: mean(
          scores.flatMap((s) => (s.rps === null ? [] : [s.rps])),
        ),
        reliability: reliabilityBins(scores),
        selectiveRiskAmongValid: [0.5, 0.8, 0.9, 0.95, 0.99].map((t) =>
          selectiveRisk(scores, t),
        ),
      };
    },
  );
  const results = records.flatMap((r) => (r.result ? [r.result] : []));
  const knownCosts = results.flatMap((r) =>
    r.metadata.cost ? [r.metadata.cost.usd] : [],
  );
  const times = results.map((r) => r.metadata.durationMs);
  return {
    warning:
      "Synthetic development pilot, not held-out evidence of calibration. Cached records retain original call timing/cost; replay adds no inference cost. SDK-internal retries, if any, are included in wall time but not individually recorded.",
    calls: records.length,
    completed: results.length,
    failed: records.length - results.length,
    knownCostUsd: knownCosts.reduce((a, b) => a + b, 0),
    unknownCostCalls: records.length - knownCosts.length,
    successfulCallLatencyMs: {
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
    },
    groups,
  };
}
