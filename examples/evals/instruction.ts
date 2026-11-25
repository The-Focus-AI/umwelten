#!/usr/bin/env node
/**
 * Instruction Following Eval — Deterministic scoring, zero LLM judge calls.
 *
 * Usage:
 *   pnpm tsx examples/evals/instruction.ts              # instant deterministic mock
 *   pnpm tsx examples/evals/instruction.ts --live       # live cloud + local models
 */

import "@umwelten/pi";
import { EvalSuite } from "@umwelten/evaluation";
import { FAST_MODEL_ROSTER, QUICK_FAST_MODELS } from "../_shared/fast-models.js";
import { setupExampleRuntime } from "../_shared/mock-runtime.js";

const MODELS = [
  ...QUICK_FAST_MODELS,
  FAST_MODEL_ROSTER.find((m) => m.name === "inkling-2-mini:latest"),
].filter((m): m is NonNullable<typeof m> => Boolean(m));

setupExampleRuntime(FAST_MODEL_ROSTER);

const suite = new EvalSuite({
  name: "instruction-eval",
  systemPrompt:
    "Follow the given instructions with exact format compliance. Output ONLY what is requested — no extra prose or markdown fences.",
  temperature: 0.0,
  models: MODELS,
  allModels: FAST_MODEL_ROSTER,
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
      name: "Raw JSON",
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
      name: "Constraints",
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
        return { score: s, details: fails.length ? `Failed: ${fails.join(", ")}` : "All constraints met" };
      },
    },
    {
      id: "markdown-table",
      name: "MD Table",
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
        if (lines.length >= 5) s++;
        else fails.push(`${lines.length} lines`);
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
  ],
});

await suite.run();
