import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type Api as PiApi,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { GenerationTask, type HookApi } from "@earendil-works/pi-durable";
import type { Context as ChordContext } from "@earendil-works/chord/context";
import { loadCodingFixtures } from "../../../../examples/coding-bench/tasks.js";
import { createProviderPayloadExtension } from "./extensions.js";
import { runCodingTaskSession } from "./runner.js";
import { InteractiveCodingSession } from "./session.js";
import type { CodingSessionEvent } from "./types.js";
import { gradeIsolatedCheckout, prepareIsolatedGitCheckout } from "./workspace.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const FIXTURES_DIR = path.join(REPO_ROOT, "benchmarks", "coding-fixtures");

// Complete fixes for 01-ledger-rounding used inside mock coding sessions
const LEDGER_MONEY_FIX = `export interface Money {
  readonly minor: number;
  readonly currency: string;
}
const ZERO_DEC = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);
const THREE_DEC = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);
export function currencyDecimals(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DEC.has(c)) return 0;
  if (THREE_DEC.has(c)) return 3;
  return 2;
}
function nz(n: number): number { return n === 0 ? 0 : n; }
export function fromMajor(amount: number, currency: string): Money {
  const c = currency.toUpperCase();
  const s = 10 ** currencyDecimals(c);
  const abs = Math.round(Math.abs(amount) * s + 1e-9);
  return { minor: nz(amount < 0 ? -abs : abs), currency: c };
}
export function toMajor(m: Money): number {
  return nz(m.minor) / 10 ** currencyDecimals(m.currency);
}
export function formatMoney(m: Money): string {
  const c = m.currency.toUpperCase();
  const d = currencyDecimals(c);
  return \`\${c} \${(nz(m.minor) / 10 ** d).toFixed(d)}\`;
}
export function addMoney(a: Money, b: Money): Money {
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) {
    throw new Error(\`Currency mismatch: \${a.currency} vs \${b.currency}\`);
  }
  return { minor: nz(a.minor + b.minor), currency: a.currency.toUpperCase() };
}
`;

const LEDGER_TAX_FIX = `import type { Money } from "./money.ts";
export function calculateTax(amount: Money, taxBps: number): Money {
  const c = amount.currency.toUpperCase();
  if (amount.minor === 0 || taxBps === 0) return { minor: 0, currency: c };
  const sign = (amount.minor < 0 ? -1 : 1) * (taxBps < 0 ? -1 : 1);
  const abs = BigInt(Math.abs(amount.minor)) * BigInt(Math.abs(taxBps));
  const rounded = Number((abs + 5000n) / 10000n);
  return { minor: rounded === 0 ? 0 : sign * rounded, currency: c };
}
export function addTax(amount: Money, taxBps: number): Money {
  const t = calculateTax(amount, taxBps);
  const sum = amount.minor + t.minor;
  return { minor: sum === 0 ? 0 : sum, currency: amount.currency.toUpperCase() };
}
`;

const LEDGER_SPLIT_FIX = `import type { Money } from "./money.ts";
export function splitByWeights(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new Error("weights empty");
  const sum = weights.reduce((a, b) => a + b, 0);
  const c = total.currency.toUpperCase();
  const sign = total.minor < 0 ? -1 : 1;
  const absTotal = Math.abs(total.minor);
  const scaled = weights.map((w, idx) => {
    const exact = (absTotal * w) / sum;
    const base = Math.floor(exact + 1e-12);
    return { idx, base, rem: exact - base };
  });
  const rem = absTotal - scaled.reduce((s, x) => s + x.base, 0);
  const order = [...scaled].sort((a, b) => b.rem - a.rem || a.idx - b.idx);
  for (let i = 0; i < rem; i++) order[i % order.length].base += 1;
  return scaled.map((x) => ({ minor: x.base === 0 ? 0 : sign * x.base, currency: c }));
}
`;

const LEDGER_INVOICE_FIX = `import { fromMajor, type Money } from "./money.ts";
import { calculateTax } from "./tax.ts";
export interface InvoiceLine { description: string; quantity: number; unitPriceMajor: number; }
export interface InvoiceOptions { currency: string; discountBps?: number; taxBps?: number; }
export interface InvoiceSummary { currency: string; subtotal: Money; discount: Money; taxableSubtotal: Money; tax: Money; total: Money; }
export function calculateInvoiceSummary(lines: readonly InvoiceLine[], options: InvoiceOptions): InvoiceSummary {
  const currency = options.currency.toUpperCase();
  let sub = 0;
  for (const line of lines) {
    sub += Math.round(line.quantity * fromMajor(line.unitPriceMajor, currency).minor);
  }
  const subtotal: Money = { minor: sub === 0 ? 0 : sub, currency };
  const discount = calculateTax(subtotal, options.discountBps ?? 0);
  const taxSub = subtotal.minor - discount.minor;
  const taxableSubtotal: Money = { minor: taxSub === 0 ? 0 : taxSub, currency };
  const tax = calculateTax(taxableSubtotal, options.taxBps ?? 0);
  const tot = taxableSubtotal.minor + tax.minor;
  return { currency, subtotal, discount, taxableSubtotal, tax, total: { minor: tot === 0 ? 0 : tot, currency } };
}
`;

function buildMockTarget(provider: string, modelId: string, handler: (ctx: TranscriptContext) => ReturnType<typeof fauxAssistantMessage>) {
  const faux = fauxProvider({
    provider,
    models: [
      {
        id: modelId,
        name: modelId,
        reasoning: true,
        cost: { input: 1, output: 5, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 32768,
      },
    ],
  });
  const step = (ctx: TranscriptContext) => {
    faux.appendResponses([step]);
    return handler(ctx);
  };
  faux.setResponses(Array.from({ length: 16 }, () => step));
  const models = createModels();
  models.setProvider(faux.provider);
  const piModel = models.getModel(provider, modelId)!;
  return { models, piModel };
}

describe("Coding-Session Benchmark Engine (pi-durable)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "umwelten-coding-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("all 6 coding fixtures initialize cleanly in git, pass visible tests, and fail held-out tests at baseline", async () => {
    const tasks = loadCodingFixtures(FIXTURES_DIR);
    expect(tasks).toHaveLength(6);

    for (const task of tasks) {
      const checkout = await prepareIsolatedGitCheckout(task.repoDir);
      try {
        expect(checkout.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
        const grade = await gradeIsolatedCheckout(checkout.dir, task);
        expect(grade.visibleTests.exitCode, `${task.id} visible exitCode`).toBe(0);
        expect(grade.visibleTests.failed, `${task.id} visible failed`).toBe(0);
        expect(grade.passed, `${task.id} baseline should not pass hidden tests`).toBe(false);
        expect(grade.hiddenTests.failed, `${task.id} baseline hidden failures`).toBeGreaterThan(0);
      } finally {
        await checkout.cleanup();
      }
    }
  }, 30_000);

  it("runs a real Pi Durable CodingTools session end-to-end and caches clean passes", async () => {
    const [task] = loadCodingFixtures(FIXTURES_DIR).filter((t) => t.id === "01-ledger-rounding");
    const target = buildMockTarget("mock-provider", "fable-test", (ctx) => {
      const turns = ctx.messages.filter((m) => m.role === "assistant").length;
      if (turns === 0) {
        return fauxAssistantMessage([fauxToolCall("read", { path: "src/money.ts" }, { id: "r1" })], {
          stopReason: "toolUse",
        });
      }
      if (turns === 1) {
        return fauxAssistantMessage(
          [
            fauxToolCall("write", { path: "src/money.ts", content: LEDGER_MONEY_FIX }, { id: "w1" }),
            fauxToolCall("write", { path: "src/tax.ts", content: LEDGER_TAX_FIX }, { id: "w2" }),
            fauxToolCall("write", { path: "src/split.ts", content: LEDGER_SPLIT_FIX }, { id: "w3" }),
            fauxToolCall("write", { path: "src/invoice.ts", content: LEDGER_INVOICE_FIX }, { id: "w4" }),
          ],
          { stopReason: "toolUse" },
        );
      }
      if (turns === 2) {
        return fauxAssistantMessage(
          [fauxToolCall("bash", { command: "node --test test/public.test.ts" }, { id: "b1" })],
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage([fauxText("Fixed all four modules.")], { stopReason: "stop" });
    });

    const outDir = path.join(tmpRoot, "eval-out");
    const rec = await runCodingTaskSession({
      task,
      spec: { provider: "mock-provider", name: "fable-test", reasoningEffort: "high" },
      outputDir: outDir,
      overrideTarget: target,
      fresh: true,
    });

    expect(rec.passed).toBe(true);
    expect(rec.score).toBe(10);
    expect(rec.cached).toBe(false);
    expect(rec.turns).toBe(4);
    expect(rec.toolCallsByName).toEqual({ read: 1, write: 4, bash: 1 });
    expect(rec.toolErrors).toBe(0);
    expect(rec.hiddenTests.failed).toBe(0);
    expect(rec.hiddenTests.total).toBeGreaterThan(0);

    // Second call with fresh=false hits cache
    const cachedRec = await runCodingTaskSession({
      task,
      spec: { provider: "mock-provider", name: "fable-test", reasoningEffort: "high" },
      outputDir: outDir,
      overrideTarget: target,
      fresh: false,
    });
    expect(cachedRec.cached).toBe(true);
    expect(cachedRec.score).toBe(10);
  });

  it("enforces out-of-repo scope and forces score=0 on protected test tampering", async () => {
    const [task] = loadCodingFixtures(FIXTURES_DIR).filter((t) => t.id === "01-ledger-rounding");
    const outsideSecret = path.join(tmpRoot, "outside-secret.txt");
    await fs.writeFile(outsideSecret, "TOP_SECRET");

    const target = buildMockTarget("mock-provider", "tamper-test", (ctx) => {
      const turns = ctx.messages.filter((m) => m.role === "assistant").length;
      if (turns === 0) {
        return fauxAssistantMessage(
          [fauxToolCall("read", { path: outsideSecret }, { id: "outside-1" })],
          { stopReason: "toolUse" },
        );
      }
      if (turns === 1) {
        // Attempt to tamper protected test/public.test.ts AND apply real src fixes
        return fauxAssistantMessage(
          [
            fauxToolCall("write", { path: "test/public.test.ts", content: "import test from 'node:test'; test('noop', () => {});" }, { id: "tamp-1" }),
            fauxToolCall("write", { path: "src/money.ts", content: LEDGER_MONEY_FIX }, { id: "w1" }),
            fauxToolCall("write", { path: "src/tax.ts", content: LEDGER_TAX_FIX }, { id: "w2" }),
            fauxToolCall("write", { path: "src/split.ts", content: LEDGER_SPLIT_FIX }, { id: "w3" }),
            fauxToolCall("write", { path: "src/invoice.ts", content: LEDGER_INVOICE_FIX }, { id: "w4" }),
          ],
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage("Done.", { stopReason: "stop" });
    });

    const rec = await runCodingTaskSession({
      task,
      spec: { provider: "mock-provider", name: "tamper-test" },
      outputDir: path.join(tmpRoot, "eval-tamper"),
      overrideTarget: target,
      fresh: true,
    });

    expect(rec.toolErrors).toBeGreaterThanOrEqual(1);
    expect(rec.cheatedProtectedFiles).toBe(true);
    expect(rec.passed).toBe(false);
    expect(rec.score).toBe(0);
  });

  it("supports pluggable search-tools, verify-on-yield nudging, and dynamic custom extension modules", async () => {
    const [task] = loadCodingFixtures(FIXTURES_DIR).filter((t) => t.id === "01-ledger-rounding");
    const customExtPath = path.join(tmpRoot, "custom-note-ext.mjs");
    await fs.writeFile(
      customExtPath,
      `export function createExtension() { return { name: "test.custom-note", sections: [] }; }\n`,
      "utf8",
    );

    const target = buildMockTarget("mock-provider", "ext-test", (ctx) => {
      const turns = ctx.messages.filter((m) => m.role === "assistant").length;
      if (turns === 0) {
        return fauxAssistantMessage(
          [
            fauxToolCall("find_files", { pattern: "*.ts" }, { id: "ff-1" }),
            fauxToolCall("grep_files", { query: "currencyDecimals" }, { id: "gf-1" }),
          ],
          { stopReason: "toolUse" },
        );
      }
      if (turns === 1) {
        // Introduce broken code into public test scope so verify-on-yield rejects initial stop!
        return fauxAssistantMessage(
          [fauxToolCall("write", { path: "src/split.ts", content: "export function splitByWeights() { throw new Error('broken on purpose'); }\n" }, { id: "brk-1" })],
          { stopReason: "toolUse" },
        );
      }
      if (turns === 2) {
        // Try yielding while visible tests fail -> verify-on-yield MUST nudge with continuing prompt
        return fauxAssistantMessage("All done prematurely!", { stopReason: "stop" });
      }
      if (turns === 3) {
        // After nudge, apply real fixes
        return fauxAssistantMessage(
          [
            fauxToolCall("write", { path: "src/money.ts", content: LEDGER_MONEY_FIX }, { id: "w1" }),
            fauxToolCall("write", { path: "src/tax.ts", content: LEDGER_TAX_FIX }, { id: "w2" }),
            fauxToolCall("write", { path: "src/split.ts", content: LEDGER_SPLIT_FIX }, { id: "w3" }),
            fauxToolCall("write", { path: "src/invoice.ts", content: LEDGER_INVOICE_FIX }, { id: "w4" }),
          ],
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage("Fixed after verification nudge.", { stopReason: "stop" });
    });

    const rec = await runCodingTaskSession({
      task,
      spec: { provider: "mock-provider", name: "ext-test" },
      extensionNames: ["search-tools", "verify-on-yield"],
      customExtensionPaths: [customExtPath],
      outputDir: path.join(tmpRoot, "eval-ext"),
      overrideTarget: target,
      fresh: true,
    });

    expect(rec.extensionProfile).toBe("pi-default+search-tools+verify-on-yield+custom-note-ext");
    expect(rec.toolCallsByName.find_files).toBe(1);
    expect(rec.toolCallsByName.grep_files).toBe(1);
    expect(rec.turns).toBe(5); // Proves verify-on-yield triggered continuation after turn 3!
    expect(rec.passed).toBe(true);
    expect(rec.score).toBe(10);
  });

  it("createProviderPayloadExtension injects ollama@off, mlx@high, and google@off without stripping max_tokens", async () => {
    async function invokeBeforeProviderRequest(
      provider: string,
      api: PiApi,
      modelId: string,
      effort: "off" | "high",
      baseUrl?: string,
      extraBody?: Record<string, unknown>,
    ) {
      const ext = createProviderPayloadExtension(
        { provider, name: modelId, reasoningEffort: effort },
        {
          models: createModels(),
          piModel: {
            id: modelId,
            name: modelId,
            api,
            provider,
            baseUrl: baseUrl ?? "https://example.invalid",
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            reasoning: true,
            contextWindow: 131072,
            maxTokens: 32768,
          },
          ...(extraBody ? { extraBody } : {}),
        },
      );
      const genHook = ext.hooks?.find((h) => h.task === GenerationTask.definition.name) as
        | {
            handlers?: {
              beforeProviderRequest?: (
                req: { model: { id: string; api: PiApi; provider: string }; payload: unknown },
                api: HookApi,
                ctx: ChordContext,
              ) => Promise<{ payload: unknown } | undefined> | { payload: unknown } | undefined;
            };
          }
        | undefined;
      const handler = genHook?.handlers?.beforeProviderRequest;
      expect(handler).toBeTypeOf("function");
      const res = await handler!(
        {
          model: { id: modelId, api, provider },
          payload: { max_tokens: 4096, messages: [] },
        },
        {} as unknown as HookApi,
        {} as unknown as ChordContext,
      );
      return res?.payload as Record<string, unknown>;
    }

    const ollamaOff = await invokeBeforeProviderRequest(
      "ollama",
      "openai-completions",
      "inkling-2-mini:latest",
      "off",
      "http://localhost:11434/v1",
    );
    expect(ollamaOff.think).toBe(false);
    expect(ollamaOff.reasoning_effort).toBe("none");
    expect(ollamaOff.max_tokens).toBe(4096);

    const mlxHigh = await invokeBeforeProviderRequest(
      "mlx",
      "openai-completions",
      "inkling-2-mini-mlx-nvfp4",
      "high",
      "http://127.0.0.1:8000/v1",
    );
    expect(mlxHigh.enable_thinking).toBe(true);
    expect(mlxHigh.reasoning_effort).toBe("high");
    expect(mlxHigh.max_tokens).toBe(4096);

    const googleOff = await invokeBeforeProviderRequest(
      "google",
      "google-generative-ai",
      "gemini-4-hydrogen",
      "off",
    );
    const genConfig = googleOff.generationConfig as {
      thinkingConfig?: { thinkingBudget?: number };
    };
    expect(genConfig?.thinkingConfig?.thinkingBudget).toBe(0);
    expect(googleOff.max_tokens).toBe(4096);
  });

  it("streams InteractiveCodingSession events, supports follow-up chat & re-grading, and keeps initial autonomous score immutable", async () => {
    const [task] = loadCodingFixtures(FIXTURES_DIR).filter(
      (t) => t.id === "01-ledger-rounding",
    );

    const target = buildMockTarget("mock-provider", "interactive-test", (ctx) => {
      const assistantTurns = ctx.messages.filter((m) => m.role === "assistant").length;
      if (assistantTurns === 0) {
        return fauxAssistantMessage(
          [
            fauxThinking("Inspecting src/money.ts first."),
            fauxToolCall("read", { path: "src/money.ts" }, { id: "i-r1" }),
          ],
          { stopReason: "toolUse" },
        );
      }
      if (assistantTurns === 1) {
        return fauxAssistantMessage(
          [
            fauxToolCall("write", { path: "src/money.ts", content: LEDGER_MONEY_FIX }, { id: "i-w1" }),
            fauxToolCall("write", { path: "src/tax.ts", content: LEDGER_TAX_FIX }, { id: "i-w2" }),
            fauxToolCall("write", { path: "src/split.ts", content: LEDGER_SPLIT_FIX }, { id: "i-w3" }),
            fauxToolCall("write", { path: "src/invoice.ts", content: LEDGER_INVOICE_FIX }, { id: "i-w4" }),
          ],
          { stopReason: "toolUse" },
        );
      }
      if (assistantTurns === 2) {
        return fauxAssistantMessage(
          [fauxToolCall("bash", { command: "node --test test/public.test.ts" }, { id: "i-b1" })],
          { stopReason: "toolUse" },
        );
      }
      if (assistantTurns === 3) {
        return fauxAssistantMessage(
          [fauxThinking("Public tests passed."), fauxText("Initial fixes applied.")],
          { stopReason: "stop" },
        );
      }
      if (assistantTurns === 4) {
        return fauxAssistantMessage(
          [
            fauxToolCall(
              "write",
              { path: "src/money.ts", content: `// interactive follow-up comment\n${LEDGER_MONEY_FIX}` },
              { id: "i-w5" },
            ),
          ],
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage(
        [fauxText("Added the requested header comment to src/money.ts.")],
        { stopReason: "stop" },
      );
    });

    const events: CodingSessionEvent[] = [];
    const session = await InteractiveCodingSession.start({
      task,
      spec: { provider: "mock-provider", name: "interactive-test", reasoningEffort: "high" },
      outputDir: path.join(tmpRoot, "interactive-out"),
      overrideTarget: target,
      onEvent: (ev) => {
        events.push(ev);
      },
    });

    const workspaceDir = session.workspaceDir;
    try {
      const initial = await session.runInitialEval();
      expect(initial.passed).toBe(true);
      expect(initial.score).toBe(10);
      expect(session.status).toBe("ready");
      expect(session.initialRecord).toBe(initial);

      // Held-out hidden tests must never be copied into the interactive checkout
      const hiddenInCheckout = await fs
        .access(path.join(workspaceDir, "test", "hidden.test.ts"))
        .then(() => true)
        .catch(() => false);
      expect(hiddenInCheckout).toBe(false);

      const seenTypes = new Set(events.map((e) => e.type));
      expect(seenTypes.has("session_started")).toBe(true);
      expect(seenTypes.has("turn_start")).toBe(true);
      expect(seenTypes.has("assistant_turn")).toBe(true);
      expect(seenTypes.has("tool_start")).toBe(true);
      expect(seenTypes.has("tool_end")).toBe(true);
      expect(
        events.some((e) => e.type === "graded" && e.isInitialEval === true),
      ).toBe(true);

      const followUp = await session.sendFollowUp(
        "Add a top-of-file header comment to src/money.ts",
      );
      expect(followUp.replyText).toContain("header comment");
      expect(session.status).toBe("ready");

      const regraded = await session.grade();
      expect(regraded.passed).toBe(true);
      expect(session.latestRecord).toBe(regraded);
      expect(session.initialRecord).toBe(initial);
      expect(session.initialRecord).not.toBe(session.latestRecord);
      expect(session.initialRecord?.turns).toBe(4);

      const diff = await session.getDiff();
      expect(diff.changedFiles).toContain("src/money.ts");
      expect(diff.gitDiff).toContain("interactive follow-up comment");
    } finally {
      await session.close();
    }

    const existsAfterClose = await fs
      .access(workspaceDir)
      .then(() => true)
      .catch(() => false);
    expect(existsAfterClose).toBe(false);
  });
});
