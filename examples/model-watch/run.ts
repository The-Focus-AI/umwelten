#!/usr/bin/env node
/**
 * Model Watch & Example Suite Runner (`pnpm run site:bench`).
 *
 * Default (`--mock`):
 *   Runs the full 20-model `FAST_MODEL_ROSTER` (Gemini 4 Hydrogen, Gemini 3.8 Flash,
 *   Gemini 3.5/3.1 Flash-Lite, Claude Haiku/Sonnet 5.5, GPT-6 Luna / 6.1 Terra,
 *   Cerebras GPT-OSS-120B, Groq GPT-OSS-20B, DeepSeek/GLM/Qwen/MiniMax Flash, and
 *   4 local `llama-swap` targets) end-to-end through `EvalSuite`, Node JS subprocess
 *   verification, and `PairwiseRanker` using `@earendil-works/pi-ai` `fauxProvider`,
 *   then executes every standalone script in `examples/` and captures stdout into
 *   `reports/data/{model-watch-mock,examples-mock}.json`.
 *
 * Live (`--live`):
 *   Probes all configured cloud API keys (`GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`,
 *   `OPENAI_API_KEY`, `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MYCEL_API_KEY`)
 *   plus local `llama-swap` / `ollama` daemons on your machine and writes
 *   `reports/data/model-watch-live.json`.
 *
 * Usage:
 *   pnpm run site:bench                 # deterministic mock across all 20 fast + local models
 *   pnpm run site:bench --live          # live run across reachable cloud + local providers
 *   pnpm run site:bench --live --fresh  # clear live EvaluationCache and re-measure from scratch
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { listMycelModels, runPiTurn, type ModelSpec } from "@umwelten/pi";
import {
  calculatorTool,
  createJevBackend,
  createLlmJudgmentBackend,
  EvalSuite,
  PairwiseRanker,
  runPilot,
  statisticsTool,
  summarizePilot,
  type TaskResultRecord,
} from "@umwelten/evaluation";
import {
  DEFAULT_FAST_JUDGE,
  FAST_MODEL_ROSTER,
} from "../_shared/fast-models.js";
import { setupExampleRuntime } from "../_shared/mock-runtime.js";
import { PILOT_CASES } from "../jev/fixtures.js";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "reports", "data");

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    live: { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    models: { type: "string" },
    judge: { type: "string" },
  },
});

const CLOSED_PREFIXES = [
  "anthropic/",
  "claude-",
  "openai/gpt-5",
  "openai/gpt-6",
  "gpt-",
  "x-ai/",
  "grok-",
  "gemini-",
  "google/gemini-",
  "minimax",
  "MiniMax",
  "inception/",
];

function inferWeights(name: string, provider: string): "open" | "closed" {
  const fromRoster = FAST_MODEL_ROSTER.find(
    (r) => r.provider === provider && r.name === name,
  );
  if (fromRoster) return fromRoster.weights;
  if (provider === "ollama" || provider === "llamaswap") return "open";
  if (name.includes("gpt-oss")) return "open";
  return CLOSED_PREFIXES.some((p) => name.startsWith(p)) ? "closed" : "open";
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/```(?:javascript|js|mjs|typescript|ts)?\s*\n([\s\S]*?)```/i);
  return match ? match[1].trim() : trimmed;
}

function parseLooseJson(raw: string): Record<string, unknown> | null {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    const s = clean.indexOf("{");
    const e = clean.lastIndexOf("}");
    if (s !== -1 && e > s) {
      try {
        return JSON.parse(clean.slice(s, e + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function runNodeHarness(
  moduleCode: string,
  harnessBody: string,
): { passed: number; total: number; details: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "umwelten-code-eval-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "solution.mjs"), moduleCode, "utf8");
    const testPath = path.join(tmpDir, "runner.mjs");
    fs.writeFileSync(testPath, harnessBody, "utf8");
    const stdout = execFileSync(process.execPath, [testPath], {
      cwd: tmpDir,
      timeout: 6000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(stdout.trim()) as {
      passed: number;
      total: number;
      failures: string[];
    };
    return {
      passed: parsed.passed,
      total: parsed.total,
      details:
        parsed.failures.length === 0
          ? `${parsed.passed}/${parsed.total} vectors ✓`
          : `${parsed.passed}/${parsed.total} (failed: ${parsed.failures.join("; ")})`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message.split("\n")[0].slice(0, 110) : String(err);
    return { passed: 0, total: 5, details: `Runtime/syntax error: ${msg}` };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function resolveTargetModels(isLive: boolean): Promise<{
  active: ModelSpec[];
  unavailable: Array<{ provider: string; name: string; error: string }>;
  judgeModel: ModelSpec;
}> {
  const unavailable: Array<{ provider: string; name: string; error: string }> = [];

  if (values.models) {
    const active = values.models.split(",").map((spec) => {
      const idx = spec.indexOf(":");
      if (idx === -1) throw new Error(`Expected provider:model, got "${spec}"`);
      return { provider: spec.slice(0, idx), name: spec.slice(idx + 1) };
    });
    const judgeModel = values.judge
      ? {
          provider: values.judge.split(":")[0],
          name: values.judge.split(":").slice(1).join(":"),
        }
      : active[0];
    return { active, unavailable, judgeModel };
  }

  if (!isLive) {
    return {
      active: FAST_MODEL_ROSTER,
      unavailable: [],
      judgeModel: DEFAULT_FAST_JUDGE,
    };
  }

  // Live discovery across configured cloud keys + local llama-swap / Mycel
  const candidates: ModelSpec[] = [];
  const envProviderMap: Record<string, string[]> = {
    google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    openai: ["OPENAI_API_KEY"],
    xai: ["XAI_API_KEY"],
    cerebras: ["CEREBRAS_API_KEY"],
    groq: ["GROQ_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
  };

  for (const entry of FAST_MODEL_ROSTER) {
    if (entry.tier === "local") {
      candidates.push(entry);
      continue;
    }
    const keys = envProviderMap[entry.provider] ?? [];
    if (keys.some((k) => Boolean(process.env[k]))) {
      candidates.push(entry);
    }
  }

  if (process.env.MYCEL_API_KEY) {
    process.env.MYCEL_URL ??= "https://mycel.thefocus.ai";
    process.env.MYCEL_END_USER ??= "umwelten-model-watch";
    const cat = await listMycelModels(process.env.MYCEL_API_KEY, process.env.MYCEL_URL);
    for (const m of cat) {
      if (m.name === "default" || m.name.startsWith("typesafe/jev")) continue;
      candidates.push(m);
    }
  }

  console.log(`Probing ${candidates.length} live/local candidate model(s)...`);
  const active: ModelSpec[] = [];
  for (const m of candidates) {
    try {
      await runPiTurn({
        model: m,
        prompt: "Reply with OK.",
        temperature: 0,
        maxTokens: 16,
      });
      active.push(m);
      console.log(`  ✓ ${m.provider}:${m.name} reachable`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isLocal = m.provider === "llamaswap" || m.provider === "ollama";
      if (!isLocal || process.env.LLAMASWAP_HOST) {
        unavailable.push({ provider: m.provider, name: m.name, error: msg });
      }
      console.log(`  ✗ ${m.provider}:${m.name} skipped (${msg.slice(0, 80)})`);
    }
  }

  if (active.length === 0) {
    throw new Error(
      "No live or local models reachable. Start llama-swap / set API keys, or omit --live to run in mock mode.",
    );
  }

  const preferredJudge =
    active.find((m) => m.name.includes("gemini-3.8-flash")) ??
    active.find((m) => m.name.includes("deepseek-v4.1-flash")) ??
    active[0];

  return { active, unavailable, judgeModel: preferredJudge };
}

async function runModelWatchSuites(
  models: ModelSpec[],
  judgeModel: ModelSpec,
  evalRoot: string,
  concurrency: number,
) {
  const suiteNames = [
    "model-watch-reasoning",
    "model-watch-knowledge",
    "model-watch-instruction",
    "model-watch-coding",
    "model-watch-tools",
  ];

  if (values.fresh) {
    for (const s of suiteNames) {
      fs.rmSync(path.join(evalRoot, s), { recursive: true, force: true });
    }
  }

  const reasonJudgeSchema = z.object({
    reasoning_quality: z.coerce.number().min(1).max(5),
    explanation: z.string(),
  });

  const reasoningSuite = new EvalSuite({
    name: "model-watch-reasoning",
    systemPrompt:
      "Think carefully, give a clear direct answer, and explain your reasoning concisely.",
    temperature: 0.2,
    models,
    judgeModel,
    judgeDelayMs: values.live ? 200 : 0,
    concurrency,
    tasks: [
      {
        id: "car-wash",
        name: "Car Wash (50m)",
        prompt:
          "I want to wash my car. The car wash is 50 meters away. Should I walk or drive?",
        maxScore: 5,
        judge: {
          schema: z.object({
            recommendation: z.string(),
            recognizes_need_for_car: z.coerce.boolean(),
            reasoning_quality: z.coerce.number().min(1).max(5),
            explanation: z.string(),
          }),
          instructions: [
            "ONLY DRIVE is correct — the car must physically be at the car wash to be washed.",
            "Saying 'drive' for convenience/laziness gets score 2; saying 'walk' gets score 1.",
          ],
        },
      },
      {
        id: "surgeon",
        name: "Surgeon Riddle",
        prompt:
          'A father and his son are in a car accident. The father dies. The son is rushed to the hospital. The surgeon says: "I can\'t operate on this boy, he\'s my son." How is this possible?',
        maxScore: 5,
        judge: {
          schema: reasonJudgeSchema,
          instructions: [
            "5=directly identifies the surgeon as the boy's mother (or second father).",
          ],
        },
      },
      {
        id: "bat-ball",
        name: "Bat & Ball",
        prompt:
          "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?",
        maxScore: 5,
        judge: {
          schema: reasonJudgeSchema,
          instructions: ["Correct answer is $0.05 (5 cents). 5=immediately proves $0.05."],
        },
      },
      {
        id: "counterfeit-coin",
        name: "12-Coin Balance",
        prompt:
          "You have 12 coins, one of which is counterfeit (either heavier or lighter than the others). Using a balance scale at most 3 times, explain a complete procedure that finds the counterfeit coin AND determines whether it is heavier or lighter.",
        maxScore: 5,
        judge: {
          schema: reasonJudgeSchema,
          instructions: [
            "5=complete 3-weighing decision tree covering balanced and tilted branches.",
            "3=starts with 4v4 but hand-waves tilted rotation.",
          ],
        },
      },
    ],
  });

  const knowledgeSuite = new EvalSuite({
    name: "model-watch-knowledge",
    systemPrompt:
      "Answer accurately. Return ONLY the requested JSON object with no markdown fences.",
    temperature: 0,
    models,
    concurrency,
    tasks: [
      {
        id: "strawberry-91",
        name: "Adversarial Count & Primality",
        prompt:
          'Return JSON: {"strawberry_rs": <integer count of letter r in "strawberry">, "is_91_prime": <boolean>, "smallest_prime_factor_of_91": <integer>}',
        maxScore: 5,
        verify: (r) => {
          const obj = parseLooseJson(r);
          if (!obj) return { score: 0, details: "Invalid JSON" };
          let s = 0;
          if (obj.strawberry_rs === 3) s += 2;
          if (obj.is_91_prime === false) s += 2;
          if (obj.smallest_prime_factor_of_91 === 7) s += 1;
          return { score: s, details: JSON.stringify(obj) };
        },
      },
      {
        id: "sheep-carbon14",
        name: "All-But-9 & Carbon-14",
        prompt:
          'Return JSON: {"sheep_left": <integer: a farmer has 17 sheep and all but 9 run away, how many are left?>, "c14_half_life_years": <integer standard Libby/Cambridge half-life of Carbon-14 in years>}',
        maxScore: 5,
        verify: (r) => {
          const obj = parseLooseJson(r);
          if (!obj) return { score: 0, details: "Invalid JSON" };
          let s = 0;
          if (obj.sheep_left === 9) s += 3;
          const hl = Number(obj.c14_half_life_years);
          if (hl >= 5568 && hl <= 5760) s += 2;
          return { score: s, details: JSON.stringify(obj) };
        },
      },
      {
        id: "transformer-https",
        name: "Transformer & Network Specs",
        prompt:
          'Return JSON: {"transformer_base_d_model": <integer d_model of base model in Vaswani et al. 2017>, "transformer_base_heads": <integer h in base model>, "https_default_port": <integer>}',
        maxScore: 5,
        verify: (r) => {
          const obj = parseLooseJson(r);
          if (!obj) return { score: 0, details: "Invalid JSON" };
          let s = 0;
          if (obj.transformer_base_d_model === 512) s += 2;
          if (obj.transformer_base_heads === 8) s += 2;
          if (obj.https_default_port === 443) s += 1;
          return { score: s, details: JSON.stringify(obj) };
        },
      },
      {
        id: "astana-int32",
        name: "Geography & Two's Complement",
        prompt:
          'Return JSON: {"kazakhstan_capital": <string current capital city>, "max_signed_int32": <integer maximum 32-bit signed two\'s complement integer>}',
        maxScore: 5,
        verify: (r) => {
          const obj = parseLooseJson(r);
          if (!obj) return { score: 0, details: "Invalid JSON" };
          let s = 0;
          if (typeof obj.kazakhstan_capital === "string" && /astana/i.test(obj.kazakhstan_capital))
            s += 2;
          if (obj.max_signed_int32 === 2147483647) s += 3;
          return { score: s, details: JSON.stringify(obj) };
        },
      },
    ],
  });

  const instructionSuite = new EvalSuite({
    name: "model-watch-instruction",
    systemPrompt:
      "Follow the given instructions with exact format compliance. Output ONLY what is requested — no extra prose or markdown fences.",
    temperature: 0,
    models,
    concurrency,
    tasks: [
      {
        id: "word-count",
        name: "12-Word Ocean",
        prompt:
          "Write a sentence about the ocean that contains EXACTLY 12 words. Just the sentence, nothing else.",
        maxScore: 5,
        verify: (r) => {
          const words = r
            .trim()
            .replace(/^["']|["']$/g, "")
            .split(/\s+/)
            .filter(Boolean);
          const diff = Math.abs(words.length - 12);
          if (diff === 0) return { score: 5, details: `${words.length} words ✓` };
          if (diff <= 1) return { score: 3, details: `${words.length} words (off by ${diff})` };
          return { score: 0, details: `${words.length} words (wanted 12)` };
        },
      },
      {
        id: "json-output",
        name: "Fence-Free Raw JSON",
        prompt:
          'Output a JSON object: {"name": string, "age": number 25-35, "skills": array of 3 strings, "active": true}. No markdown fences, no explanation.',
        maxScore: 5,
        verify: (r) => {
          let s = 0;
          const fails: string[] = [];
          const clean = r
            .trim()
            .replace(/^```json?\n?/, "")
            .replace(/\n?```$/, "")
            .trim();
          try {
            const obj = JSON.parse(clean) as Record<string, unknown>;
            if (typeof obj.name === "string" && obj.name.length > 0) s++;
            else fails.push("name");
            if (typeof obj.age === "number" && obj.age >= 25 && obj.age <= 35) s++;
            else fails.push("age");
            if (Array.isArray(obj.skills) && obj.skills.length === 3) s++;
            else fails.push("skills");
            if (obj.active === true) s++;
            else fails.push("active");
            if (!r.includes("```")) s++;
            else fails.push("fences");
          } catch {
            return { score: 0, details: "Invalid JSON" };
          }
          return { score: s, details: fails.length ? `Failed: ${fails.join(", ")}` : "Perfect" };
        },
      },
      {
        id: "negative-constraints",
        name: "Negative Constraints",
        prompt:
          'Write 2 sentences about a sunset, each on its own line. Do NOT use: "beautiful", "sky", "orange". No exclamation marks.',
        maxScore: 5,
        verify: (r) => {
          let s = 0;
          const fails: string[] = [];
          const lo = r.toLowerCase();
          if (!lo.includes("beautiful")) s++;
          else fails.push('"beautiful"');
          if (!lo.includes("sky")) s++;
          else fails.push('"sky"');
          if (!lo.includes("orange")) s++;
          else fails.push('"orange"');
          if (!r.includes("!")) s++;
          else fails.push("!");
          const lines = r
            .trim()
            .split("\n")
            .filter((l) => l.trim());
          if (lines.length === 2) s++;
          else fails.push(`${lines.length} lines`);
          return {
            score: s,
            details: fails.length ? `Failed: ${fails.join(", ")}` : "All constraints met",
          };
        },
      },
      {
        id: "markdown-table",
        name: "CSV to MD Table",
        prompt:
          "Convert to a markdown table (Name, Age, Role columns):\nAlice, 28, Engineer\nBob, 34, Designer\nCharlie, 22, Student\nOutput ONLY the table.",
        maxScore: 5,
        verify: (r) => {
          const lines = r
            .trim()
            .split("\n")
            .filter((l) => l.trim());
          let s = 0;
          const fails: string[] = [];
          if (lines.length === 5 && !r.includes("```")) s++;
          else fails.push(`${lines.length} lines / fences`);
          if (lines[0] && /Name/i.test(lines[0]) && /Age/i.test(lines[0])) s++;
          else fails.push("header");
          if (lines[1] && /[-|]+/.test(lines[1])) s++;
          else fails.push("separator");
          const hasData =
            lines.some((l) => /Alice/i.test(l) && /28/.test(l)) &&
            lines.some((l) => /Bob/i.test(l) && /34/.test(l));
          if (hasData) s++;
          else fails.push("data");
          if (lines.every((l) => l.includes("|"))) s++;
          else fails.push("pipes");
          return { score: s, details: fails.length ? `Failed: ${fails.join(", ")}` : "Perfect table" };
        },
      },
      {
        id: "acrostic-8words",
        name: "Acrostic + Exact 8-Word Lines",
        prompt:
          "Write 5 lines about distributed systems where: (1) the first letters of the 5 lines spell P-A-R-E-T in order, (2) EVERY line contains EXACTLY 8 words (hyphenated words count as 1 word; no numbering or bullets), and (3) the letter 'z' (case-insensitive) never appears. Output ONLY the 5 lines.",
        maxScore: 5,
        verify: (r) => {
          const lines = r
            .trim()
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          if (lines.length !== 5) {
            return { score: 0, details: `Expected 5 lines, got ${lines.length}` };
          }
          const target = ["P", "A", "R", "E", "T"];
          const acrosticOk = lines.every(
            (l, idx) => l.replace(/^[^A-Za-z]+/, "")[0]?.toUpperCase() === target[idx],
          );
          const wordCounts = lines.map((l) => l.split(/\s+/).filter(Boolean).length);
          const exactEightCount = wordCounts.filter((c) => c === 8).length;
          const noZ = !/z/i.test(r);
          let score = 0;
          if (acrosticOk) score += 1;
          if (noZ) score += 1;
          if (exactEightCount === 5) score += 3;
          else if (exactEightCount >= 4) score += 2;
          else if (exactEightCount >= 3) score += 1;
          return {
            score,
            details: `acrostic=${acrosticOk}, 8w=${exactEightCount}/5 [${wordCounts.join(",")}], noZ=${noZ}`,
          };
        },
      },
    ],
  });

  const codingSuite = new EvalSuite({
    name: "model-watch-coding",
    systemPrompt:
      "Output ONLY valid JavaScript ES module code (`export function ...`). Do not include explanations outside code.",
    temperature: 0,
    models,
    concurrency,
    tasks: [
      {
        id: "rail-fence-cipher",
        name: "Rail Fence Cipher (JS ESM)",
        prompt:
          "Write a JavaScript ES module exporting `encode(text, rails)` and `decode(cipher, rails)` implementing the classic Rail Fence (zigzag) cipher. Handle `rails <= 1` or `rails >= text.length` by returning the input unchanged. Output ONLY the JS module code.",
        maxScore: 10,
        verify: (r) => {
          const code = stripCodeFences(r);
          const harness = `
import { encode, decode } from "./solution.mjs";
const cases = [
  ["rail3_enc", () => encode("WEAREDISCOVEREDFLEEATONCE", 3) === "WECRLTEERDSOEEFEAOCAIVDEN"],
  ["rail3_dec", () => decode("WECRLTEERDSOEEFEAOCAIVDEN", 3) === "WEAREDISCOVEREDFLEEATONCE"],
  ["rail4_enc", () => encode("ATTACKATDAWN", 4) === "AATKTNTCDWAA" && decode("AATKTNTCDWAA", 4) === "ATTACKATDAWN"],
  ["rail4_exact", () => encode("EXACTRAILFENCE", 4) === "EACXRINEATLECF" && decode("EACXRINEATLECF", 4) === "EXACTRAILFENCE"],
  ["edge_short", () => encode("HI", 5) === "HI" && decode("HI", 1) === "HI"],
];
let passed = 0; const failures = [];
for (const [name, fn] of cases) {
  try { if (fn()) passed++; else failures.push(name); } catch (e) { failures.push(name + ":" + e.message); }
}
console.log(JSON.stringify({ passed, total: cases.length, failures }));
`;
          const res = runNodeHarness(code, harness);
          return { score: res.passed * 2, details: res.details };
        },
      },
      {
        id: "business-days",
        name: "Business Days w/ Holidays (JS ESM)",
        prompt:
          "Write a JavaScript ES module exporting `countBusinessDays(startIso, endIso, holidays = [])` where `startIso` and `endIso` are `'YYYY-MM-DD'` UTC dates (`startIso <= endIso`) and `holidays` is an array of `'YYYY-MM-DD'` strings. Return the count of weekdays (Mon–Fri) INCLUSIVE of both `startIso` and `endIso` that are NOT in `holidays` (a weekend holiday must not double-subtract). Output ONLY the JS module code.",
        maxScore: 10,
        verify: (r) => {
          const code = stripCodeFences(r);
          const harness = `
import { countBusinessDays } from "./solution.mjs";
const cases = [
  ["mon_to_fri", () => countBusinessDays("2025-03-03", "2025-03-07", []) === 5],
  ["across_wknd", () => countBusinessDays("2025-03-07", "2025-03-10", []) === 2],
  ["weekday_hol", () => countBusinessDays("2025-07-01", "2025-07-07", ["2025-07-04"]) === 4],
  ["sat_holiday", () => countBusinessDays("2026-07-03", "2026-07-06", ["2026-07-04"]) === 2],
  ["leap_feb24",  () => countBusinessDays("2024-02-28", "2024-03-01", []) === 3],
];
let passed = 0; const failures = [];
for (const [name, fn] of cases) {
  try { if (fn()) passed++; else failures.push(name); } catch (e) { failures.push(name + ":" + e.message); }
}
console.log(JSON.stringify({ passed, total: cases.length, failures }));
`;
          const res = runNodeHarness(code, harness);
          return { score: res.passed * 2, details: res.details };
        },
      },
      {
        id: "rational-evaluator",
        name: "Exact Rational Expression Parser (JS ESM)",
        prompt:
          "Write a JavaScript ES module exporting `evaluateRational(expr)` that evaluates an arithmetic string using exact arbitrary-precision rational arithmetic (`BigInt`) and returns a canonical reduced string `'num/den'` with `den > 0` (or `'num'` when `den === 1`). Support integers, `+`, `-`, `*`, `/` (exact fraction division), parentheses `(...)`, unary `-`, and integer exponentiation `^` where: (a) `^` is RIGHT-associative (`'2 ^ 3 ^ 2'` -> `'512'`), (b) unary `-` has LOWER precedence than `^` (`'-2 ^ 2'` -> `'-4'`, while `'(-2) ^ 2'` -> `'4'`, and `'2 ^ -3'` -> `'1/8'`), and (c) division by zero throws an `Error`. Output ONLY the JS module code.",
        maxScore: 10,
        verify: (r) => {
          const code = stripCodeFences(r);
          const harness = `
import { evaluateRational } from "./solution.mjs";
const cases = [
  ["frac_sum",   () => evaluateRational("1/3 + 1/6") === "1/2" && evaluateRational("6 / 3") === "2"],
  ["right_exp",  () => evaluateRational("2 ^ 3 ^ 2") === "512"],
  ["unary_prec", () => evaluateRational("-2 ^ 2") === "-4" && evaluateRational("(-2) ^ 2") === "4" && evaluateRational("2 ^ -3") === "1/8"],
  ["nested_neg", () => evaluateRational("(1/3 - 5/6) / (3/4)") === "-2/3"],
  ["div_zero",   () => { try { evaluateRational("5 / (1/2 - 2/4)"); return false; } catch { return true; } }],
];
let passed = 0; const failures = [];
for (const [name, fn] of cases) {
  try { if (fn()) passed++; else failures.push(name); } catch (e) { failures.push(name + ":" + e.message); }
}
console.log(JSON.stringify({ passed, total: cases.length, failures }));
`;
          const res = runNodeHarness(code, harness);
          return { score: res.passed * 2, details: res.details };
        },
      },
    ],
  });

  const toolsSuite = new EvalSuite({
    name: "model-watch-tools",
    systemPrompt:
      "You are a careful quantitative analyst. Use the provided calculator and statistics tools for every arithmetic step, and end your final answer with the exact numeric result.",
    temperature: 0,
    tools: { calculator: calculatorTool, statistics: statisticsTool },
    models,
    concurrency,
    tasks: [
      {
        id: "grocery-total",
        name: "Chained Grocery + Tax",
        prompt:
          "Compute the total cost of: 3 apples at $1.25 each, 2 loaves of bread at $3.50 each, 4 bottles of water at $0.75 each, and 1 cake at $12.99. Add 8% sales tax, rounded to cents. Use the calculator tool and end your response with the final dollar number (e.g. 28.88).",
        maxScore: 5,
        verify: (response, turn) => {
          const hasExact = /28\.88/.test(response);
          const calls = turn?.toolCalls.length ?? 0;
          return {
            score: (hasExact ? 3 : 0) + (calls >= 3 ? 2 : calls >= 1 ? 1 : 0),
            details: `exact28.88=${hasExact}, toolCalls=${calls}`,
          };
        },
      },
      {
        id: "stats-invoice",
        name: "Statistics + Margin Tool Chain",
        prompt:
          "Use the `statistics` tool to find the mean of [14.5, 22.0, 18.25, 31.75, 19.5], then use `calculator` to multiply that mean by 1.15 (15% markup). End with the exact final number.",
        maxScore: 5,
        verify: (response, turn) => {
          const hasExact = /24\.38/.test(response);
          const usedStats = turn?.toolCalls.some((c) => c.toolName === "statistics") ?? false;
          const usedCalc = turn?.toolCalls.some((c) => c.toolName === "calculator") ?? false;
          return {
            score: (hasExact ? 3 : 0) + (usedStats ? 1 : 0) + (usedCalc ? 1 : 0),
            details: `exact24.38=${hasExact}, stats=${usedStats}, calc=${usedCalc}, calls=${turn?.toolCalls.length ?? 0}`,
          };
        },
      },
    ],
  });

  const reasoningRecords = await reasoningSuite.run();
  const knowledgeRecords = await knowledgeSuite.run();
  const instructionRecords = await instructionSuite.run();
  const codingRecords = await codingSuite.run();
  const toolsRecords = await toolsSuite.run();

  const groceryEntries = toolsRecords
    .filter((r) => r.taskId === "grocery-total" && !r.error && r.responseText.trim().length > 0)
    .map((r) => ({
      key: `${r.provider}:${r.model}`,
      provider: r.provider,
      model: r.model,
      responseText: r.responseText,
    }));

  let eloByKey = new Map<string, number>();
  if (groceryEntries.length >= 2) {
    const ranker = new PairwiseRanker(groceryEntries, {
      judgeModel,
      judgeInstructions: [
        "Prefer exact $28.88 ($26.74 subtotal + $2.14 tax) with concise step breakdown.",
      ],
      pairingMode: groceryEntries.length > 8 ? "swiss" : "all",
      swissRounds: 4,
    });
    const ranked = await ranker.rank();
    eloByKey = new Map(
      ranked.rankings.map((e) => [`${e.provider}:${e.model}`, Math.round(e.elo)]),
    );
  }

  function sumModel(records: TaskResultRecord[], m: ModelSpec) {
    const mine = records.filter((r) => r.provider === m.provider && r.model === m.name);
    const score = mine.reduce((s, r) => s + r.score, 0);
    const maxScore = mine.reduce((s, r) => s + r.maxScore, 0);
    const cost = mine.reduce((s, r) => s + r.cost, 0);
    const durationMs = mine.reduce((s, r) => s + r.durationMs, 0);
    const tasks = mine.map((r) => ({
      taskId: r.taskId,
      score: r.score,
      maxScore: r.maxScore,
      details: r.details,
      costUsd: Number(r.cost.toFixed(6)),
      durationMs: r.durationMs,
    }));
    return {
      score,
      maxScore,
      pct: maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(1)) : 0,
      cost,
      durationMs,
      tasks,
    };
  }

  const rows = models.map((m) => {
    const r = sumModel(reasoningRecords, m);
    const k = sumModel(knowledgeRecords, m);
    const i = sumModel(instructionRecords, m);
    const c = sumModel(codingRecords, m);
    const t = sumModel(toolsRecords, m);
    const combined = Number(((r.pct + k.pct + i.pct + c.pct + t.pct) / 5).toFixed(1));
    const totalCost = Number((r.cost + k.cost + i.cost + c.cost + t.cost).toFixed(5));
    const totalDurationSec = Number(
      ((r.durationMs + k.durationMs + i.durationMs + c.durationMs + t.durationMs) / 1000).toFixed(1),
    );
    return {
      id: m.name,
      provider: m.provider,
      tier:
        m.provider === "ollama" || m.provider === "llamaswap"
          ? ("local" as const)
          : ("cloud" as const),
      weights: inferWeights(m.name, m.provider),
      pricingPerMillion: m.costs ?? null,
      combined,
      reasoning: r.pct,
      reasoningRaw: `${r.score}/${r.maxScore}`,
      knowledge: k.pct,
      knowledgeRaw: `${k.score}/${k.maxScore}`,
      instruction: i.pct,
      instructionRaw: `${i.score}/${i.maxScore}`,
      coding: c.pct,
      codingRaw: `${c.score}/${c.maxScore}`,
      tools: t.pct,
      toolsRaw: `${t.score}/${t.maxScore}`,
      elo: eloByKey.get(`${m.provider}:${m.name}`) ?? null,
      cost: totalCost,
      timeSec: totalDurationSec,
      taskBreakdown: {
        reasoning: r.tasks,
        knowledge: k.tasks,
        instruction: i.tasks,
        coding: c.tasks,
        tools: t.tasks,
      },
    };
  });

  rows.sort((a, b) => b.combined - a.combined || a.cost - b.cost);
  return { rows };
}

function captureExampleStdout(args: string[]): string {
  const out = execFileSync("pnpm", ["tsx", ...args], {
    cwd: ROOT,
    timeout: 45_000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\/tmp\/[A-Za-z0-9_-]+/g, "/tmp/umwelten-run")
    .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
    .trim();
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const runtime = setupExampleRuntime(FAST_MODEL_ROSTER, { fresh: values.fresh });
  const isLive = runtime.mode === "live";

  const { active, unavailable, judgeModel } = await resolveTargetModels(isLive);
  const watch = await runModelWatchSuites(
    active,
    judgeModel,
    runtime.evalDir,
    isLive ? 2 : 6,
  );

  const outFilename = isLive ? "model-watch-live.json" : "model-watch-mock.json";
  const watchPayload = {
    mode: runtime.mode,
    generatedAt: new Date().toISOString(),
    reproduceCommand: isLive ? "pnpm run site:bench --live" : "pnpm run site:bench",
    freshCommand: isLive ? "pnpm run site:bench --live --fresh" : "pnpm run site:bench --fresh",
    judgeModel: `${judgeModel.provider}:${judgeModel.name}`,
    dimensions: [
      { id: "reasoning", label: "Reasoning Traps", maxScore: 20, tasks: 4, scoring: "Zod JudgeTask" },
      { id: "knowledge", label: "Adversarial Knowledge", maxScore: 20, tasks: 4, scoring: "Deterministic JSON" },
      { id: "instruction", label: "Strict Format Compliance", maxScore: 25, tasks: 5, scoring: "Deterministic Verify" },
      { id: "coding", label: "Executed JS/ESM Coding", maxScore: 30, tasks: 3, scoring: "Node Subprocess (15 vectors)" },
      { id: "tools", label: "Multi-Step Tool Chaining", maxScore: 10, tasks: 2, scoring: "Tool-Call Count + Exact Math + Elo" },
    ],
    totalSuiteCostUsd: Number(watch.rows.reduce((s, r) => s + r.cost, 0).toFixed(5)),
    models: watch.rows,
    unavailableCatalogueModels: unavailable,
  };

  fs.writeFileSync(
    path.join(DATA_DIR, outFilename),
    JSON.stringify(watchPayload, null, 2) + "\n",
    "utf8",
  );

  if (isLive && process.env.MYCEL_API_KEY) {
    const families = ["support", "evidence", "completion"] as const;
    const cases = [0, 1, 2].flatMap((idx) =>
      families.map((f) => structuredClone(PILOT_CASES.filter((c) => c.family === f)[idx])),
    );
    const jevOut = path.join(ROOT, "output", "jev", "model-watch-native");
    const llmOut = path.join(ROOT, "output", "jev", "model-watch-llm");
    const jevBackend = createJevBackend({ provider: "mycel", model: "typesafe/jev-1.13" });
    const llmBackend = createLlmJudgmentBackend(judgeModel);
    const jevRun = await runPilot(jevBackend, cases, jevOut, {});
    const llmRun = await runPilot(llmBackend, cases, llmOut, {});
    fs.writeFileSync(
      path.join(DATA_DIR, "jev-live.json"),
      JSON.stringify(
        {
          executedAt: new Date().toISOString(),
          caseCount: cases.length,
          reproduceCommand: "pnpm tsx examples/jev/run.ts --backend mycel --live --limit 9",
          nativeJev: { backend: jevBackend.identity, summary: summarizePilot(jevRun.records) },
          llmBaseline: { backend: llmBackend.identity, summary: summarizePilot(llmRun.records) },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  // Execute every standalone example script cleanly and capture verbatim stdout
  if (!isLive) {
    console.log("\nExecuting standalone example scripts in mock mode to capture outputs...");
    const examplesMock = {
      mode: "mock" as const,
      generatedAt: new Date().toISOString(),
      outputs: {
        "car-wash-traps": captureExampleStdout(["examples/evals/car-wash.ts"]),
        "reasoning-puzzles": captureExampleStdout(["examples/evals/reasoning.ts"]),
        "instruction-compliance": captureExampleStdout(["examples/evals/instruction.ts"]),
        "tool-math-elo": captureExampleStdout(["examples/evals/tool-math.ts"]),
        "model-showdown-combiner": captureExampleStdout(["examples/model-showdown/generate-report.ts"]),
        "jev-calibration": captureExampleStdout(["examples/jev/run.ts", "--mock"]),
        "pi-extension-sessions": captureExampleStdout(["examples/pi-extension/demo.ts"]),
        "durable-habitat-a2a": captureExampleStdout(["examples/durable-habitat/host.ts"]),
        "mycel-exchange-e2e": captureExampleStdout(["examples/mycel-e2e/run.ts"]),
      },
    };
    fs.writeFileSync(
      path.join(DATA_DIR, "examples-mock.json"),
      JSON.stringify(examplesMock, null, 2) + "\n",
      "utf8",
    );
  }

  console.log(`\n✅ Wrote ${outFilename} -> ${DATA_DIR}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
