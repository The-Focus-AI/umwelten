/**
 * Deterministic mock runtime for Umwelten examples, built directly on
 * `@earendil-works/pi-ai`'s `fauxProvider`, `fauxAssistantMessage`, and `fauxToolCall`.
 *
 * - Default (or `--mock`): runs every example end-to-end offline in <2s using
 *   isolated cache dir `output/mock-evaluations/` so real `output/evaluations/`
 *   is never polluted.
 * - `--live`: leaves Pi's real cloud + local providers (`google`, `anthropic`,
 *   `openai`, `cerebras`, `groq`, `openrouter`, `mycel`, `llamaswap`, `ollama`) untouched.
 */

import fs from "node:fs";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
  type AssistantMessage,
  type FauxResponseStep,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { registerPiProvider, type ModelSpec } from "@umwelten/pi";
import { DEFAULT_FAST_JUDGE, FAST_MODEL_ROSTER } from "./fast-models.js";

const RAIL_FENCE_JS = `export function encode(text, rails) {
  if (rails <= 1 || rails >= text.length) return text;
  const rows = Array.from({ length: rails }, () => "");
  let r = 0, dir = 1;
  for (const ch of text) {
    rows[r] += ch;
    if (r === 0) dir = 1;
    else if (r === rails - 1) dir = -1;
    r += dir;
  }
  return rows.join("");
}
export function decode(cipher, rails) {
  if (rails <= 1 || rails >= cipher.length) return cipher;
  const pattern = [];
  let r = 0, dir = 1;
  for (let i = 0; i < cipher.length; i++) {
    pattern.push(r);
    if (r === 0) dir = 1;
    else if (r === rails - 1) dir = -1;
    r += dir;
  }
  const counts = Array(rails).fill(0);
  for (const p of pattern) counts[p]++;
  const rows = [];
  let pos = 0;
  for (let i = 0; i < rails; i++) {
    rows.push(cipher.slice(pos, pos + counts[i]).split(""));
    pos += counts[i];
  }
  const idx = Array(rails).fill(0);
  return pattern.map((p) => rows[p][idx[p]++]).join("");
}`;

const BUSINESS_DAYS_JS = `export function countBusinessDays(startIso, endIso, holidays = []) {
  const hol = new Set(holidays);
  let cur = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  let count = 0;
  while (cur <= end) {
    const day = cur.getUTCDay();
    const iso = cur.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !hol.has(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}`;

const RATIONAL_EVAL_JS = `function gcd(a, b) {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b !== 0n) { const t = a % b; a = b; b = t; }
  return a;
}
function norm([n, d]) {
  if (d === 0n) throw new Error("div by zero");
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return [n / g, d / g];
}
export function evaluateRational(expr) {
  const tokens = expr.match(/\\d+|[+\\-*/^()]/g) || [];
  let i = 0;
  function parseAdd() {
    let v = parseMul();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++]; const r = parseMul();
      v = norm([op === "+" ? v[0] * r[1] + r[0] * v[1] : v[0] * r[1] - r[0] * v[1], v[1] * r[1]]);
    }
    return v;
  }
  function parseMul() {
    let v = parseUnary();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++]; const r = parseUnary();
      if (op === "/" && r[0] === 0n) throw new Error("Division by zero");
      v = norm(op === "*" ? [v[0] * r[0], v[1] * r[1]] : [v[0] * r[1], v[1] * r[0]]);
    }
    return v;
  }
  function parseUnary() {
    if (tokens[i] === "-") { i++; const v = parseUnary(); return [-v[0], v[1]]; }
    if (tokens[i] === "+") { i++; return parseUnary(); }
    return parsePow();
  }
  function parsePow() {
    let base = parsePrimary();
    if (tokens[i] === "^") {
      i++;
      const exp = parseUnary();
      if (exp[1] !== 1n) throw new Error("Non-integer exponent");
      let e = exp[0];
      if (e < 0n) {
        if (base[0] === 0n) throw new Error("Zero to negative power");
        base = norm([base[1], base[0]]);
        e = -e;
      }
      return norm([base[0] ** e, base[1] ** e]);
    }
    return base;
  }
  function parsePrimary() {
    if (tokens[i] === "(") { i++; const v = parseAdd(); i++; return v; }
    return [BigInt(tokens[i++]), 1n];
  }
  const [n, d] = parseAdd();
  return d === 1n ? String(n) : \`\${n}/\${d}\`;
}`;

const RATIONAL_BUGGY_UNARY_JS = RATIONAL_EVAL_JS.replace(
  "let ep = parseUnary();",
  "let ep = parseUnary();",
).replace(
  "function parseUnary() {\n    if (tokens[i] === \"-\") { i++; const v = parseUnary(); return [-v[0], v[1]]; }\n    if (tokens[i] === \"+\") { i++; return parseUnary(); }\n    return parsePow();\n  }",
  "function parseUnary() { return parsePow(); }",
).replace(
  "function parsePrimary() {",
  "function parsePrimary() {\n    if (tokens[i] === \"-\") { i++; const v = parsePrimary(); return [-v[0], v[1]]; }",
);

function textOfMessage(msg: TranscriptContext["messages"][number]): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .map((b) => ("text" in b ? b.text : "name" in b ? `${b.name}(${JSON.stringify(b.arguments)})` : ""))
    .join("\n");
}

function isTinyTier(modelId: string): boolean {
  return /e2b|nano-4b|3\.1-flash-lite/i.test(modelId);
}

function isMidLiteTier(modelId: string): boolean {
  return /3\.5-flash-lite|glm-5\.3-flash|minimax-m3\.1-flash|haiku-5-5|gpt-6-luna|gemma-4-26b/i.test(
    modelId,
  );
}

function buildMockReply(context: TranscriptContext, model: Model<string>): AssistantMessage {
  const ctxRec = context as unknown as {
    systemPrompt?: unknown;
    tools?: Array<{ name: string }>;
  };
  const sys = JSON.stringify(ctxRec.systemPrompt ?? "");
  const hasStructuredTool =
    Array.isArray(ctxRec.tools) &&
    ctxRec.tools.some((t) => t.name === "__structured_output");
  const last = context.messages[context.messages.length - 1];
  const firstUser = context.messages.find((m) => m.role === "user");
  const promptText = firstUser ? textOfMessage(firstUser) : "";
  const id = model.id;
  const tiny = isTinyTier(id);
  const midLite = isMidLiteTier(id);

  // ── 1. Judge & PairwiseRanker & Structured-Output Turns ───────────────────
  if (
    sys.includes("impartial evaluation judge") ||
    promptText.includes("Here is the model response to judge:")
  ) {
    const body = promptText;
    if (/car wash|save gas|one-minute stroll/i.test(body)) {
      const walked = /you should walk|save gas/i.test(body);
      return fauxAssistantMessage(
        JSON.stringify({
          recommendation: walked ? "walk" : "drive",
          recognizes_need_for_car: !walked,
          reasoning_quality: walked ? 1 : 5,
          explanation: walked
            ? "Recommends walking 50m and forgets the car itself needs to be washed."
            : "Immediately recommends driving because the car must physically be at the wash.",
        }),
      );
    }
    const incomplete = /narrow down the suspect coin/i.test(body);
    return fauxAssistantMessage(
      JSON.stringify({
        reasoning_quality: incomplete ? 3 : 5,
        explanation: incomplete
          ? "Identifies 4v4 initial split but hand-waves the tilted second-weighing rotation."
          : "Complete, verified reasoning across every branch.",
      }),
    );
  }

  if (promptText.includes("## Response A") && promptText.includes("## Response B")) {
    const aHasSteps = promptText.split("## Response B")[0].includes("Subtotal");
    return fauxAssistantMessage(
      JSON.stringify({
        winner: aHasSteps ? "A" : "tie",
        reason: "Accurate tool-verified $28.88 breakdown.",
        confidence: "high",
      }),
    );
  }

  if (hasStructuredTool || sys.includes("__structured_output")) {
    // Parse exact question key + kind from the JSON prompt constructed by createLlmJudgmentBackend
    const qMatch = promptText.match(/"questions"\s*:\s*\{\s*"([^"]+)"\s*:\s*\{\s*"kind"\s*:\s*"([^"]+)"/);
    const qKey = qMatch?.[1] ?? "intent";
    const qKind = qMatch?.[2] ?? "binary";
    if (qKind === "binary") {
      const pos = /refund|money back|duplicate charge|charged twice|reimburse/i.test(promptText);
      return fauxAssistantMessage(
        fauxToolCall("__structured_output", { answers: { [qKey]: pos ? 0.96 : 0.04 } }),
      );
    }
    if (qKind === "choice") {
      const optMatch = promptText.match(/"options"\s*:\s*\{([^}]+)\}/);
      const optKeys = optMatch
        ? [...optMatch[1].matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1])
        : ["supported", "contradicted", "unresolved"];
      const chosen = optKeys.find((k) => k === "unresolved") ?? optKeys[0];
      const probs: Record<string, number> = {};
      const rem = Number(((1 - 0.88) / Math.max(1, optKeys.length - 1)).toFixed(2));
      let sum = 0;
      optKeys.forEach((k, idx) => {
        if (idx === optKeys.length - 1) probs[k] = Number((1 - sum).toFixed(2));
        else {
          const v = k === chosen ? 0.88 : rem;
          probs[k] = v;
          sum += v;
        }
      });
      return fauxAssistantMessage(
        fauxToolCall("__structured_output", {
          answers: { [qKey]: { choice: chosen, probabilities: probs } },
        }),
      );
    }
    const lvlMatch = promptText.match(/"levels"\s*:\s*\[([\s\S]*?)\]/);
    const nLevels = lvlMatch ? (lvlMatch[1].match(/"/g)?.length ?? 6) / 2 : 3;
    const count = Math.max(2, Math.round(nLevels));
    const probs = Array.from({ length: count }, (_, i) => (i === count - 1 ? 0.84 : Number((0.16 / (count - 1)).toFixed(2))));
    const fixSum = probs.slice(0, -1).reduce((a, b) => a + b, 0);
    probs[count - 1] = Number((1 - fixSum).toFixed(2));
    return fauxAssistantMessage(
      fauxToolCall("__structured_output", {
        answers: { [qKey]: { level: count - 1, probabilities: probs } },
      }),
    );
  }

  // ── 2. Multi-Step Tool Chaining Turns (`calculator` & `statistics`) ───────
  if (promptText.includes("3 apples at $1.25")) {
    const toolResults = context.messages.filter((m) => m.role === "toolResult");
    if (toolResults.length === 0) {
      return fauxAssistantMessage([
        fauxToolCall("calculator", { expression: "3 * 1.25 + 2 * 3.50 + 4 * 0.75 + 12.99" }),
        fauxToolCall("calculator", { expression: "26.74 * 0.08" }),
        fauxToolCall("calculator", { expression: "26.74 + 2.1392" }),
      ]);
    }
    return fauxAssistantMessage(
      tiny
        ? "After using the calculator, the subtotal is $26.74 and total with tax is 28.88."
        : "Subtotal = $26.74 ($3.75 + $7.00 + $3.00 + $12.99), 8% tax = $2.14, total = 28.88",
    );
  }

  if (promptText.includes("[14.5, 22.0, 18.25, 31.75, 19.5]")) {
    const toolResults = context.messages.filter((m) => m.role === "toolResult");
    if (toolResults.length === 0) {
      return fauxAssistantMessage([
        fauxToolCall("statistics", { numbers: [14.5, 22.0, 18.25, 31.75, 19.5], metric: "mean" }),
      ]);
    }
    if (toolResults.length === 1) {
      return fauxAssistantMessage([
        fauxToolCall("calculator", { expression: "21.2 * 1.15" }),
      ]);
    }
    return fauxAssistantMessage("Mean is 21.2; with 15% markup the total is 24.38");
  }

  // ── 3. Reasoning Puzzles ──────────────────────────────────────────────────
  if (promptText.includes("car wash is 50 meters away")) {
    if (id === "gemma-4-e2b") {
      return fauxAssistantMessage(
        "50 meters is less than a one-minute stroll — you should walk and save gas.",
      );
    }
    return fauxAssistantMessage([
      fauxThinking("Wait: the goal is to wash the car, so the car has to arrive at the car wash."),
      {
        type: "text",
        text: "Drive. Even though 50 meters is short, the car itself must be at the car wash to get washed.",
      },
    ]);
  }

  if (promptText.includes("surgeon says")) {
    return fauxAssistantMessage("The surgeon is the boy's mother.");
  }

  if (promptText.includes("bat and a ball cost $1.10")) {
    return fauxAssistantMessage("The ball costs $0.05 (and the bat costs $1.05, totaling $1.10).");
  }

  if (promptText.includes("lily pads doubles")) {
    return fauxAssistantMessage("47 days — since the patch doubles daily, it is half-covered one day before day 48.");
  }

  if (promptText.includes("12 coins")) {
    if (tiny) {
      return fauxAssistantMessage(
        "Split into three groups of 4, weigh 4 vs 4, then narrow down the suspect coin in two more weighings.",
      );
    }
    return fauxAssistantMessage(
      "Divide into A(1-4), B(5-8), C(9-12). Weigh A vs B. If balanced, weigh C1,C2,C3 vs A1,A2,A3 to isolate C4 or tilt direction, then weigh C1 vs C2. If A > B, weigh A1,A2,B1 vs A3,B2,C1 (rotating suspect heavy/light coins); the three outcomes isolate <=3 candidates resolved in weighing 3.",
    );
  }

  // ── 4. Knowledge JSON Tasks ───────────────────────────────────────────────
  if (promptText.includes("strawberry_rs")) {
    return fauxAssistantMessage(
      JSON.stringify({ strawberry_rs: 3, is_91_prime: false, smallest_prime_factor_of_91: 7 }),
    );
  }
  if (promptText.includes("sheep_left")) {
    return fauxAssistantMessage(JSON.stringify({ sheep_left: 9, c14_half_life_years: 5730 }));
  }
  if (promptText.includes("transformer_base_d_model")) {
    return fauxAssistantMessage(
      JSON.stringify({ transformer_base_d_model: 512, transformer_base_heads: 8, https_default_port: 443 }),
    );
  }
  if (promptText.includes("kazakhstan_capital")) {
    return fauxAssistantMessage(
      JSON.stringify({ kazakhstan_capital: "Astana", max_signed_int32: 2147483647 }),
    );
  }

  // ── 5. Instruction Compliance Tasks ───────────────────────────────────────
  if (promptText.includes("EXACTLY 12 words")) {
    return fauxAssistantMessage(
      tiny || id.includes("gpt-oss-20b") || id === "gemma-4-26b"
        ? "Cold dark waves roll endlessly toward the quiet rocky shore at dawn today." // 13 words
        : "Deep blue waves crash softly against ancient weathered cliffs beneath silver clouds.", // 12 words
    );
  }
  if (promptText.includes('"skills": array of 3 strings')) {
    const raw = '{"name":"Ada","age":29,"skills":["rust","sql","math"],"active":true}';
    return fauxAssistantMessage(id === "nemotron-3-nano-4b" ? "```json\n" + raw + "\n```" : raw);
  }
  if (promptText.includes('Do NOT use: "beautiful"')) {
    return fauxAssistantMessage(
      "Crimson light fades slowly behind distant coastal ridges at dusk.\nWarm amber reflections shimmer across calm evening tides.",
    );
  }
  if (promptText.includes("Alice, 28, Engineer")) {
    return fauxAssistantMessage(
      "| Name | Age | Role |\n| --- | --- | --- |\n| Alice | 28 | Engineer |\n| Bob | 34 | Designer |\n| Charlie | 22 | Student |",
    );
  }
  if (promptText.includes("P-A-R-E-T")) {
    if (midLite) {
      // Slips 'zero' (contains 'z') on line 4
      return fauxAssistantMessage(
        [
          "Peers across clusters replicate state during network partitions.",
          "Atomic commits guard every shard against silent corruption.",
          "Raft leaders append log entries before quorum replies.",
          " Eventual consistency trades zero latency for stale reads.",
          "Timeouts trigger clean failover when primary nodes stall.",
        ].join("\n"),
      );
    }
    return fauxAssistantMessage(
      [
        "Peers across clusters replicate state during network partitions.",
        "Atomic commits guard every shard against silent corruption.",
        "Raft leaders append log entries before quorum replies.",
        "Eventual models trade strict order for rapid throughput.",
        "Timeouts trigger clean failover when primary nodes stall.",
      ].join("\n"),
    );
  }

  // ── 6. Node-Executed JS/ESM Coding Tasks ──────────────────────────────────
  if (promptText.includes("encode(text, rails)")) {
    return fauxAssistantMessage(RAIL_FENCE_JS);
  }
  if (promptText.includes("countBusinessDays")) {
    return fauxAssistantMessage(BUSINESS_DAYS_JS);
  }
  if (promptText.includes("evaluateRational")) {
    return fauxAssistantMessage(
      tiny ||
        model.provider === "llamaswap" ||
        id.includes("deepseek-v4.1-flash") ||
        id.includes("glm-5.3-flash")
        ? RATIONAL_BUGGY_UNARY_JS
        : RATIONAL_EVAL_JS,
    );
  }

  void last;
  return fauxAssistantMessage("READY");
}

let mockInstalled = false;

export function setupExampleRuntime(
  models: readonly ModelSpec[],
  opts: { fresh?: boolean } = {},
): { mode: "mock" | "live"; evalDir: string } {
  const isLive = process.argv.includes("--live");
  if (isLive) {
    const evalDir = path.join(process.cwd(), "output", "evaluations");
    process.env.UMWELTEN_EVAL_DIR = evalDir;
    console.log("⚡ Mode: LIVE (--live) — calling configured cloud & local providers");
    return { mode: "live", evalDir };
  }

  const evalDir = path.join(process.cwd(), "output", "mock-evaluations");
  process.env.UMWELTEN_EVAL_DIR = evalDir;
  if (opts.fresh) {
    fs.rmSync(evalDir, { recursive: true, force: true });
  }

  if (!mockInstalled) {
    mockInstalled = true;
    const allSpecs: ModelSpec[] = [
      ...FAST_MODEL_ROSTER,
      DEFAULT_FAST_JUDGE,
      { provider: "openrouter", name: "anthropic/claude-haiku-4.5", costs: { promptTokens: 1, completionTokens: 5 } },
      ...models,
    ];

    const byProvider = new Map<string, Map<string, ModelSpec>>();
    for (const spec of allSpecs) {
      const map = byProvider.get(spec.provider) ?? new Map<string, ModelSpec>();
      if (!map.has(spec.name)) map.set(spec.name, spec);
      byProvider.set(spec.provider, map);
    }

    for (const [providerId, specMap] of byProvider.entries()) {
      const handle = fauxProvider({
        provider: providerId,
        models: [...specMap.values()].map((s) => {
          const rosterMatch = FAST_MODEL_ROSTER.find(
            (r) => r.provider === s.provider && r.name === s.name,
          );
          const c = s.costs ?? rosterMatch?.costs ?? { promptTokens: 0.25, completionTokens: 1.0 };
          return {
            id: s.name,
            name: s.name,
            reasoning: true,
            cost: {
              input: c.promptTokens,
              output: c.completionTokens,
              cacheRead: c.promptTokens,
              cacheWrite: 0,
            },
          };
        }),
      });

      const step: FauxResponseStep = (ctx, _streamOpts, _state, reqModel) => {
        handle.appendResponses([step]);
        return buildMockReply(ctx, reqModel);
      };
      handle.setResponses([step]);
      registerPiProvider(handle.provider);
    }
  }

  console.log(
    "🧪 Mode: MOCK (@earendil-works/pi-ai fauxProvider) — pass --live to hit real APIs & local GPUs",
  );
  return { mode: "mock", evalDir };
}
