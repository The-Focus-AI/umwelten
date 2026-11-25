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
import {
  canonicalizeThinkingEffort,
  formatModelSpecString,
  getCatalogModelInfo,
  listMycelModels,
  parseModelSpecString,
  runPiTurn,
  type ModelSpec,
  type ThinkingEffort,
} from "@umwelten/pi";
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
import {
  discoverLocalOllamaModels,
  inferModelWeights,
  isLocalProviderName,
  loadModelMatrix,
  selectMatrixModels,
  type MatrixModelEntry,
} from "../_shared/model-matrix.js";
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
    group: { type: "string" },
    add: { type: "string" },
    exclude: { type: "string" },
    effort: { type: "string" },
    "discover-local": { type: "boolean", default: false },
    "lab-dir": { type: "string" },
    concurrency: { type: "string" },
    merge: { type: "boolean", default: false },
    suite: { type: "string", default: "full" },
  },
});

function splitCsv(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function inferWeights(name: string, provider: string): "open" | "closed" {
  const fromRoster = FAST_MODEL_ROSTER.find(
    (r) => r.provider === provider && r.name === name,
  );
  if (fromRoster) return fromRoster.weights;
  return inferModelWeights(name, provider);
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

function rowKey(m: { provider: string; id?: string; name?: string; reasoningEffort?: string }): string {
  const name = m.id ?? m.name ?? "";
  const effort = canonicalizeThinkingEffort(m.reasoningEffort as ThinkingEffort | undefined) ?? "default";
  return `${m.provider}::${name}::${effort}`;
}

async function resolveTargetModels(isLive: boolean): Promise<{
  active: MatrixModelEntry[];
  unavailable: Array<{ provider: string; name: string; error: string }>;
  judgeModel: ModelSpec;
}> {
  const unavailable: Array<{ provider: string; name: string; error: string }> = [];
  const manifest = loadModelMatrix();

  const requestedGroups = splitCsv(values.group);
  const explicitModels = splitCsv(values.models);
  const addSpecs = splitCsv(values.add);
  const excludeTokens = splitCsv(values.exclude);
  const rawEffort = values.effort?.trim().toLowerCase();
  const disableGroupEfforts = rawEffort === "default";
  const efforts =
    rawEffort && !disableGroupEfforts
      ? (splitCsv(values.effort) as ThinkingEffort[] | undefined)
      : undefined;

  const baseGroups = requestedGroups ?? manifest.defaultGroups;

  // Select base matrix entries (deferring exclude/efforts until after --discover-local)
  let selectedEntries = selectMatrixModels(manifest, {
    groups: explicitModels ? undefined : baseGroups,
    models: explicitModels,
    add: addSpecs,
    labDir: values["lab-dir"],
  });

  if (values["discover-local"]) {
    try {
      const ollamaFound = await discoverLocalOllamaModels();
      selectedEntries.push(...ollamaFound);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ollama discovery skipped (${msg.slice(0, 80)})`);
    }
  }

  // Re-apply exclude, efforts, and deduplication across combined candidates
  if (excludeTokens?.length) {
    selectedEntries = selectedEntries.filter((entry) => {
      const formatted = formatModelSpecString(entry);
      return !excludeTokens.some((tok) => {
        if (tok.endsWith(":*")) return entry.provider === tok.slice(0, -2);
        return (
          tok === entry.name ||
          tok === formatted ||
          (!tok.includes("@") && tok === `${entry.provider}:${entry.name}`)
        );
      });
    });
  }

  if (efforts?.length) {
    const expanded: MatrixModelEntry[] = [];
    for (const entry of selectedEntries) {
      for (const eff of efforts) {
        const norm = canonicalizeThinkingEffort(eff);
        expanded.push({
          ...entry,
          ...(norm ? { reasoningEffort: norm } : {}),
        });
      }
    }
    selectedEntries = expanded;
  } else if (!disableGroupEfforts) {
    const expanded: MatrixModelEntry[] = [];
    for (const entry of selectedEntries) {
      if (entry.reasoningEffort) {
        expanded.push(entry);
        continue;
      }
      const groupEfforts = entry.group
        ? manifest.groups[entry.group]?.defaultEfforts
        : undefined;
      if (groupEfforts && groupEfforts.length > 0) {
        for (const eff of groupEfforts) {
          const norm = canonicalizeThinkingEffort(eff);
          expanded.push({
            ...entry,
            ...(norm ? { reasoningEffort: norm } : {}),
          });
        }
      } else {
        expanded.push(entry);
      }
    }
    selectedEntries = expanded;
  }

  // Deduplicate by provider + name + effort + baseUrl
  const deduped: MatrixModelEntry[] = [];
  const seenKeys = new Set<string>();
  for (const e of selectedEntries) {
    const k = `${rowKey(e)}::${e.baseUrl ?? ""}`;
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    deduped.push(e);
  }

  const envProviderMap: Record<string, string[]> = {
    google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    openai: ["OPENAI_API_KEY"],
    xai: ["XAI_API_KEY"],
    cerebras: ["CEREBRAS_API_KEY"],
    groq: ["GROQ_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
    minimax: ["MINIMAX_API_KEY"],
  };
  const hasProviderCredentials = (provider: string): boolean => {
    const keys = envProviderMap[provider] ?? [];
    return keys.some((k) => Boolean(process.env[k]));
  };
  const defaultJudgeSpec = parseModelSpecString(manifest.defaultJudge);

  if (!isLive) {
    const judgeModel = values.judge
      ? parseModelSpecString(values.judge)
      : DEFAULT_FAST_JUDGE;
    return {
      active: deduped,
      unavailable: [],
      judgeModel,
    };
  }

  if (explicitModels) {
    const judgeModel = values.judge
      ? parseModelSpecString(values.judge)
      : hasProviderCredentials(defaultJudgeSpec.provider)
        ? defaultJudgeSpec
        : deduped[0];
    return { active: deduped, unavailable, judgeModel };
  }

  // Live discovery across configured cloud keys + local endpoints / Mycel
  const candidates: MatrixModelEntry[] = [];

  for (const entry of deduped) {
    if (entry.tier === "local" || isLocalProviderName(entry.provider)) {
      candidates.push(entry);
      continue;
    }
    if (hasProviderCredentials(entry.provider)) {
      candidates.push(entry);
    }
  }

  if (process.env.MYCEL_API_KEY) {
    process.env.MYCEL_URL ??= "https://mycel.thefocus.ai";
    process.env.MYCEL_END_USER ??= "umwelten-model-watch";
    const cat = await listMycelModels(process.env.MYCEL_API_KEY, process.env.MYCEL_URL);
    for (const m of cat) {
      if (m.name === "default" || m.name.startsWith("typesafe/jev")) continue;
      const targetEfforts = efforts?.length ? efforts : [undefined];
      for (const eff of targetEfforts) {
        candidates.push({
          ...m,
          weights: inferWeights(m.name, m.provider),
          tier: "cloud",
          enabled: true,
          ...(eff ? { reasoningEffort: canonicalizeThinkingEffort(eff) } : {}),
        });
      }
    }
  }

  // Probe unique (provider, name, baseUrl) endpoints once before running effort sweeps
  const uniqueProbeTargets = new Map<string, MatrixModelEntry>();
  for (const c of candidates) {
    const pk = `${c.provider}::${c.name}::${c.baseUrl ?? ""}`;
    if (!uniqueProbeTargets.has(pk)) {
      uniqueProbeTargets.set(pk, c);
    }
  }

  console.log(`Probing ${uniqueProbeTargets.size} unique live/local model(s)...`);
  const reachableKeys = new Set<string>();
  const explicitLocalRequested = Boolean(
    values["discover-local"] ||
      values["lab-dir"] ||
      requestedGroups?.some((g) => g.startsWith("local-")) ||
      addSpecs?.some((s) => isLocalProviderName(parseModelSpecString(s).provider)),
  );

  for (const [pk, m] of uniqueProbeTargets.entries()) {
    try {
      await runPiTurn({
        model: {
          provider: m.provider,
          name: m.name,
          ...(m.baseUrl ? { baseUrl: m.baseUrl } : {}),
        },
        prompt: "Reply with OK.",
        temperature: 0,
        maxTokens: 64,
      });
      reachableKeys.add(pk);
      console.log(`  ✓ ${m.provider}:${m.name} reachable`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isLocal = m.tier === "local" || isLocalProviderName(m.provider);
      if (!isLocal || explicitLocalRequested) {
        unavailable.push({ provider: m.provider, name: m.name, error: msg });
      }
      console.log(`  ✗ ${m.provider}:${m.name} skipped (${msg.slice(0, 80)})`);
    }
  }

  const active = candidates.filter((c) =>
    reachableKeys.has(`${c.provider}::${c.name}::${c.baseUrl ?? ""}`),
  );

  if (active.length === 0) {
    throw new Error(
      "No live or local models reachable. Start Ollama/local lab servers or set API keys, or omit --live to run in mock mode.",
    );
  }

  const preferredJudge = values.judge
    ? parseModelSpecString(values.judge)
    : hasProviderCredentials(defaultJudgeSpec.provider)
      ? defaultJudgeSpec
      : active.find((m) => formatModelSpecString(m).startsWith(manifest.defaultJudge)) ??
        active.find((m) => m.name.includes("gemini-4-hydrogen")) ??
        active.find((m) => m.name.includes("deepseek-v4.1-flash")) ??
        active[0];

  return { active, unavailable, judgeModel: preferredJudge };
}

async function runModelWatchSuites(
  models: MatrixModelEntry[],
  judgeModel: ModelSpec,
  evalRoot: string,
  concurrency: number,
  isLive: boolean,
  isSmoke: boolean,
) {
  const suiteNames = [
    "model-watch-reasoning",
    "model-watch-knowledge",
    "model-watch-instruction",
    "model-watch-coding",
    "model-watch-tools",
    "model-watch-elo",
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

  const buildSuites = (
    suiteModels: ModelSpec[],
    suiteConcurrency: number,
    executionOrder: "task-first" | "model-first" = "task-first",
  ) => {
    const reasoningAllTasks: EvalSuite["config"]["tasks"] = [
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
            reasoning_quality: z.coerce
              .number()
              .min(1)
              .max(5)
              .describe("5=correctly says drive because the car must be at the wash, 2=drive for convenience only, 1=walk"),
            explanation: z.string(),
          }),
          instructions: [
            "ONLY DRIVE is correct — the car must physically be at the car wash to be washed.",
            "Score 5: recommends driving AND explains that the car itself must be at the car wash to be washed.",
            "Score 2: recommends driving only for convenience/laziness without noting the car must be washed there.",
            "Score 1: recommends walking or misses that the car must go to the wash.",
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
            "5=directly identifies the surgeon as the boy's mother (or second father). 1=misses the relationship.",
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
          instructions: [
            "Correct answer is $0.05 (5 cents). 5=immediately proves $0.05. 1=answers $0.10 or wrong amount.",
          ],
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
            "1=invalid or exceeds 3 weighings.",
          ],
        },
      },
    ];

    const reasoningSuite = new EvalSuite({
      name: "model-watch-reasoning",
      systemPrompt:
        "Think carefully, give a clear direct answer, and explain your reasoning concisely.",
      temperature: 0.2,
      models: suiteModels,
      judgeModel,
      judgeDelayMs: isLive ? 200 : 0,
      concurrency: suiteConcurrency,
      executionOrder,
      tasks: isSmoke
        ? reasoningAllTasks.filter((t) => t.id === "car-wash")
        : reasoningAllTasks,
    });

  const knowledgeSuite = new EvalSuite({
    name: "model-watch-knowledge",
    systemPrompt:
      "Answer accurately. Return ONLY the requested JSON object with no markdown fences.",
    temperature: 0,
    models: suiteModels,
    concurrency: suiteConcurrency,
    executionOrder,
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

  const instructionAllTasks: EvalSuite["config"]["tasks"] = [
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
  ];

  const instructionSuite = new EvalSuite({
    name: "model-watch-instruction",
    systemPrompt:
      "Follow the given instructions with exact format compliance. Output ONLY what is requested — no extra prose or markdown fences.",
    temperature: 0,
    models: suiteModels,
    concurrency: suiteConcurrency,
    executionOrder,
    tasks: isSmoke
      ? instructionAllTasks.filter((t) => t.id === "json-output")
      : instructionAllTasks,
  });

  const codingSuite = new EvalSuite({
    name: "model-watch-coding",
    systemPrompt:
      "Output ONLY valid JavaScript ES module code (`export function ...`). Do not include explanations outside code.",
    temperature: 0,
    models: suiteModels,
    concurrency: suiteConcurrency,
    executionOrder,
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

  const toolsAllTasks: EvalSuite["config"]["tasks"] = [
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
  ];

  const toolsSuite = new EvalSuite({
    name: "model-watch-tools",
    systemPrompt:
      "You are a careful quantitative analyst. Use the provided calculator and statistics tools for every arithmetic step, and end your final answer with the exact numeric result.",
    temperature: 0,
    tools: { calculator: calculatorTool, statistics: statisticsTool },
    models: suiteModels,
    concurrency: suiteConcurrency,
    executionOrder,
    tasks: isSmoke
      ? toolsAllTasks.filter((t) => t.id === "grocery-total")
      : toolsAllTasks,
  });

    return {
      reasoningSuite,
      knowledgeSuite,
      instructionSuite,
      codingSuite,
      toolsSuite,
    };
  };

  const reasoningRecords: TaskResultRecord[] = [];
  const knowledgeRecords: TaskResultRecord[] = [];
  const instructionRecords: TaskResultRecord[] = [];
  const codingRecords: TaskResultRecord[] = [];
  const toolsRecords: TaskResultRecord[] = [];
  let judgeCostUsd = 0;

  async function runBatch(
    batchModels: ModelSpec[],
    batchConcurrency: number,
    executionOrder: "task-first" | "model-first",
  ) {
    if (batchModels.length === 0) return;
    const suites = buildSuites(batchModels, batchConcurrency, executionOrder);
    reasoningRecords.push(...(await suites.reasoningSuite.run()));
    if (!isSmoke) {
      knowledgeRecords.push(...(await suites.knowledgeSuite.run()));
    }
    instructionRecords.push(...(await suites.instructionSuite.run()));
    if (!isSmoke) {
      codingRecords.push(...(await suites.codingSuite.run()));
    }
    toolsRecords.push(...(await suites.toolsSuite.run()));
    judgeCostUsd +=
      suites.reasoningSuite.getLastRunStats().judgeCostUsd +
      (isSmoke ? 0 : suites.knowledgeSuite.getLastRunStats().judgeCostUsd) +
      suites.instructionSuite.getLastRunStats().judgeCostUsd +
      (isSmoke ? 0 : suites.codingSuite.getLastRunStats().judgeCostUsd) +
      suites.toolsSuite.getLastRunStats().judgeCostUsd;
  }

  if (isLive) {
    const cloudModels = models.filter(
      (m) => m.tier === "cloud" && !isLocalProviderName(m.provider),
    );
    const localModels = models.filter(
      (m) => m.tier === "local" || isLocalProviderName(m.provider),
    );
    await runBatch(cloudModels, concurrency, "task-first");
    // Run each local model through all 5 suites sequentially so weights stay hot in RAM
    for (const lm of localModels) {
      await runBatch([lm], 1, "model-first");
    }
  } else {
    await runBatch(models, concurrency, "task-first");
  }

  const groceryEntries = toolsRecords
    .filter((r) => r.taskId === "grocery-total" && !r.error && r.responseText.trim().length > 0)
    .map((r) => ({
      key: formatModelSpecString({
        provider: r.provider,
        name: r.model,
        reasoningEffort: r.reasoningEffort as ThinkingEffort | undefined,
      }),
      provider: r.provider,
      model: r.model,
      responseText: r.responseText,
    }));

  let eloByKey = new Map<string, number>();
  let eloJudgeCostUsd = 0;
  if (!isSmoke && groceryEntries.length >= 2) {
    const ranker = new PairwiseRanker(groceryEntries, {
      judgeModel,
      judgeInstructions: [
        "Prefer exact $28.88 ($26.74 subtotal + $2.14 tax) with concise step breakdown.",
      ],
      pairingMode: groceryEntries.length > 8 ? "swiss" : "all",
      swissRounds: 4,
      cacheDir: path.join(evalRoot, "model-watch-elo", "runs", "001"),
      delayMs: isLive ? 250 : 0,
    });
    const ranked = await ranker.rank();
    eloJudgeCostUsd = ranked.judgeCostUsd ?? 0;
    eloByKey = new Map(
      ranked.rankings.map((e) => [e.key, Math.round(e.elo)]),
    );
  }

  function sumModel(records: TaskResultRecord[], m: MatrixModelEntry) {
    const normEff = canonicalizeThinkingEffort(m.reasoningEffort);
    const mine = records.filter(
      (r) =>
        r.provider === m.provider &&
        r.model === m.name &&
        (r.reasoningEffort ?? undefined) === normEff,
    );
    const score = mine.reduce((s, r) => s + r.score, 0);
    const maxScore = mine.reduce((s, r) => s + r.maxScore, 0);
    const cost = mine.reduce((s, r) => s + r.cost, 0);
    const durationMs = mine.reduce((s, r) => s + r.durationMs, 0);
    let prompt = 0;
    let completion = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let reasoning = 0;
    let total = 0;
    let effectiveLevel: string | undefined;

    const tasks = mine.map((r) => {
      const tu = r.tokenUsage;
      prompt += tu?.promptTokens ?? 0;
      completion += tu?.completionTokens ?? 0;
      cacheRead += tu?.cacheReadTokens ?? 0;
      cacheWrite += tu?.cacheWriteTokens ?? 0;
      reasoning += tu?.reasoningTokens ?? 0;
      total += tu?.total ?? 0;
      if (!effectiveLevel && r.effectiveThinkingLevel) {
        effectiveLevel = r.effectiveThinkingLevel;
      }
      return {
        taskId: r.taskId,
        score: r.score,
        maxScore: r.maxScore,
        details: r.details,
        costUsd: Number(r.cost.toFixed(6)),
        durationMs: r.durationMs,
        ...(tu
          ? {
              tokens: {
                prompt: tu.promptTokens ?? 0,
                completion: tu.completionTokens ?? 0,
                cacheRead: tu.cacheReadTokens ?? 0,
                cacheWrite: tu.cacheWriteTokens ?? 0,
                reasoning: tu.reasoningTokens ?? 0,
                total: tu.total ?? 0,
              },
            }
          : {}),
        ...(r.error ? { error: r.error } : {}),
      };
    });
    return {
      score,
      maxScore,
      pct: maxScore > 0 ? Number(((score / maxScore) * 100).toFixed(1)) : 0,
      cost,
      durationMs,
      effectiveLevel,
      tokens: { prompt, completion, cacheRead, cacheWrite, reasoning, total },
      tasks,
    };
  }

  const rows = models.map((m) => {
    const r = sumModel(reasoningRecords, m);
    const k = sumModel(knowledgeRecords, m);
    const i = sumModel(instructionRecords, m);
    const c = sumModel(codingRecords, m);
    const t = sumModel(toolsRecords, m);
    const combined = isSmoke
      ? Number(((r.pct + i.pct + t.pct) / 3).toFixed(1))
      : Number(((r.pct + k.pct + i.pct + c.pct + t.pct) / 5).toFixed(1));
    const totalCost = Number((r.cost + k.cost + i.cost + c.cost + t.cost).toFixed(5));
    const totalDurationSec = Number(
      ((r.durationMs + k.durationMs + i.durationMs + c.durationMs + t.durationMs) / 1000).toFixed(1),
    );
    const tokens = {
      prompt: r.tokens.prompt + k.tokens.prompt + i.tokens.prompt + c.tokens.prompt + t.tokens.prompt,
      completion:
        r.tokens.completion +
        k.tokens.completion +
        i.tokens.completion +
        c.tokens.completion +
        t.tokens.completion,
      cacheRead:
        r.tokens.cacheRead +
        k.tokens.cacheRead +
        i.tokens.cacheRead +
        c.tokens.cacheRead +
        t.tokens.cacheRead,
      cacheWrite:
        r.tokens.cacheWrite +
        k.tokens.cacheWrite +
        i.tokens.cacheWrite +
        c.tokens.cacheWrite +
        t.tokens.cacheWrite,
      reasoning:
        r.tokens.reasoning +
        k.tokens.reasoning +
        i.tokens.reasoning +
        c.tokens.reasoning +
        t.tokens.reasoning,
      total: r.tokens.total + k.tokens.total + i.tokens.total + c.tokens.total + t.tokens.total,
    };
    const isLocal = m.tier === "local" || isLocalProviderName(m.provider);
    const catalogCost = isLocal ? null : getCatalogModelInfo(m).cost;
    const pricingPerMillion = isLocal
      ? { promptTokens: 0, completionTokens: 0 }
      : catalogCost
        ? {
            promptTokens: catalogCost.promptTokens,
            completionTokens: catalogCost.completionTokens,
          }
        : m.costs
          ? {
              promptTokens: m.costs.promptTokens,
              completionTokens: m.costs.completionTokens,
            }
          : null;
    const specStr = formatModelSpecString(m);
    const reasoningEffort = canonicalizeThinkingEffort(m.reasoningEffort) ?? "default";
    const effectiveThinkingLevel =
      r.effectiveLevel ??
      c.effectiveLevel ??
      i.effectiveLevel ??
      k.effectiveLevel ??
      t.effectiveLevel ??
      reasoningEffort;

    return {
      id: m.name,
      provider: m.provider,
      tier: isLocal ? ("local" as const) : ("cloud" as const),
      weights: inferWeights(m.name, m.provider),
      reasoningEffort,
      effectiveThinkingLevel,
      pricingPerMillion,
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
      elo: eloByKey.get(specStr) ?? null,
      cost: totalCost,
      timeSec: totalDurationSec,
      tokens,
      tokPerSec:
        totalDurationSec > 0
          ? Number((tokens.completion / totalDurationSec).toFixed(1))
          : null,
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
  return {
    rows,
    judgeCostUsd: Number(judgeCostUsd.toFixed(5)),
    eloJudgeCostUsd: Number(eloJudgeCostUsd.toFixed(5)),
  };
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

  const suiteArg = (values.suite ?? "full").trim().toLowerCase();
  if (suiteArg !== "smoke" && suiteArg !== "full") {
    throw new Error(`Invalid --suite "${values.suite}". Expected "smoke" or "full".`);
  }
  const isSmoke = suiteArg === "smoke";

  const isLiveMode = process.argv.includes("--live");
  const { active, unavailable, judgeModel } = await resolveTargetModels(isLiveMode);

  const runtime = setupExampleRuntime(active, { fresh: values.fresh });
  const isLive = runtime.mode === "live";

  const requestedConcurrency = values.concurrency
    ? parseInt(values.concurrency, 10)
    : undefined;
  const effectiveConcurrency =
    requestedConcurrency && Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
      ? requestedConcurrency
      : isLive
        ? 2
        : 6;

  const watch = await runModelWatchSuites(
    active,
    judgeModel,
    runtime.evalDir,
    effectiveConcurrency,
    isLive,
    isSmoke,
  );

  const outFilename =
    isSmoke && !values.merge
      ? "model-watch-smoke.json"
      : isLive
        ? "model-watch-live.json"
        : "model-watch-mock.json";
  const outPath = path.join(DATA_DIR, outFilename);

  let finalRows = watch.rows;
  if (values.merge && fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, "utf8")) as {
        models?: typeof watch.rows;
      };
      if (Array.isArray(prev.models)) {
        const mergedMap = new Map<string, (typeof watch.rows)[number]>();
        for (const row of prev.models) {
          mergedMap.set(rowKey(row), row);
        }
        for (const row of watch.rows) {
          mergedMap.set(rowKey(row), row);
        }
        finalRows = Array.from(mergedMap.values()).sort(
          (a, b) => b.combined - a.combined || a.cost - b.cost,
        );
      }
    } catch {
      // Ignore corrupt prior JSON and write fresh rows
    }
  }

  const totalSuiteCostUsd = Number(
    finalRows.reduce((s, r) => s + r.cost, 0).toFixed(5),
  );
  const totalRunCostUsd = Number(
    (totalSuiteCostUsd + watch.judgeCostUsd + watch.eloJudgeCostUsd).toFixed(5),
  );

  const watchPayload = {
    mode: runtime.mode,
    suite: isSmoke ? "smoke" : "full",
    generatedAt: new Date().toISOString(),
    reproduceCommand: isSmoke
      ? isLive
        ? "pnpm run site:bench -- --live --suite smoke"
        : "pnpm run site:bench -- --mock --suite smoke"
      : isLive
        ? "pnpm run site:bench --live"
        : "pnpm run site:bench",
    freshCommand: isSmoke
      ? isLive
        ? "pnpm run site:bench -- --live --suite smoke --fresh"
        : "pnpm run site:bench -- --mock --suite smoke --fresh"
      : isLive
        ? "pnpm run site:bench --live --fresh"
        : "pnpm run site:bench --fresh",
    judgeModel: formatModelSpecString(judgeModel),
    dimensions: isSmoke
      ? [
          { id: "reasoning", label: "Smoke: Car Wash", maxScore: 5, tasks: 1, scoring: "Zod JudgeTask" },
          { id: "instruction", label: "Smoke: Strict JSON", maxScore: 5, tasks: 1, scoring: "Deterministic Verify" },
          { id: "tools", label: "Smoke: Calculator Tool", maxScore: 5, tasks: 1, scoring: "Tool-Call + Math" },
        ]
      : [
          { id: "reasoning", label: "Reasoning Traps", maxScore: 20, tasks: 4, scoring: "Zod JudgeTask" },
          { id: "knowledge", label: "Adversarial Knowledge", maxScore: 20, tasks: 4, scoring: "Deterministic JSON" },
          { id: "instruction", label: "Strict Format Compliance", maxScore: 25, tasks: 5, scoring: "Deterministic Verify" },
          { id: "coding", label: "Executed JS/ESM Coding", maxScore: 30, tasks: 3, scoring: "Node Subprocess (15 vectors)" },
          { id: "tools", label: "Multi-Step Tool Chaining", maxScore: 10, tasks: 2, scoring: "Tool-Call Count + Exact Math + Elo" },
        ],
    totalSuiteCostUsd,
    judgeCostUsd: watch.judgeCostUsd,
    eloJudgeCostUsd: watch.eloJudgeCostUsd,
    totalRunCostUsd,
    models: finalRows,
    unavailableCatalogueModels: unavailable,
  };

  fs.writeFileSync(
    outPath,
    JSON.stringify(watchPayload, null, 2) + "\n",
    "utf8",
  );

  if (isSmoke) {
    console.log("\nSmoke Check Summary (3 tasks: car-wash, json-output, grocery-total):");
    console.log(
      "Model".padEnd(36),
      "Effort".padEnd(8),
      "Combined".padEnd(9),
      "Tokens".padEnd(8),
      "Tok/s".padEnd(7),
      "Time",
    );
    console.log("-".repeat(78));
    for (const r of finalRows) {
      console.log(
        `${r.provider}:${r.id}`.slice(0, 35).padEnd(36),
        r.reasoningEffort.padEnd(8),
        `${r.combined}%`.padEnd(9),
        String(r.tokens.total).padEnd(8),
        String(r.tokPerSec ?? "-").padEnd(7),
        `${r.timeSec}s`,
      );
    }
  }

  if (!isSmoke && isLive && process.env.MYCEL_API_KEY) {
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
  if (!isLive && !isSmoke) {
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
