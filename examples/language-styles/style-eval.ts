#!/usr/bin/env node
/**
 * Language Styles Eval — the same four briefs rendered in five registers,
 * scored by an LLM judge on style fidelity + content fidelity.
 *
 * The registers are authored as skills (skills/<id>/SKILL.md); each skill body
 * is injected into the stimulus unconditionally and quoted verbatim to the
 * judge, so what we author, ask for, and score against cannot drift.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/language-styles/style-eval.ts            # quick roster
 *   dotenvx run -- pnpm tsx examples/language-styles/style-eval.ts --all      # full roster
 *   dotenvx run -- pnpm tsx examples/language-styles/style-eval.ts --new      # fresh run
 *   dotenvx run -- pnpm tsx examples/language-styles/style-eval.ts \
 *     --style strunk-white,victorian-english --brief scene                    # subset (smoke)
 */

import '@umwelten/core/env/load.js';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { EvalSuite, type EvalTask } from '@umwelten/evaluation/evaluation/suite.js';
import { loadStyles, type StyleDef } from './load-styles.js';
import { BRIEFS, type Brief } from './briefs.js';

export const EVAL_NAME = 'language-styles';

// Everything runs on GitHub Models (models.github.ai) — one GITHUB_TOKEN, no
// other keys. Note the free tier has per-minute and per-day request caps that
// vary by model tier; concurrency is kept low below to stay under them.
const LOCAL = [
  { name: 'openai/gpt-5-mini', provider: 'github-models' },
  { name: 'meta/llama-3.3-70b-instruct', provider: 'github-models' },
  { name: 'mistral-ai/mistral-small-2503', provider: 'github-models' },
] as const;

const ALL = [
  ...LOCAL,
  { name: 'openai/gpt-5', provider: 'github-models' },
  { name: 'openai/gpt-4.1', provider: 'github-models' },
  { name: 'deepseek/deepseek-v3-0324', provider: 'github-models' },
  { name: 'meta/llama-4-maverick-17b-128e-instruct-fp8', provider: 'github-models' },
  { name: 'cohere/cohere-command-a', provider: 'github-models' },
  { name: 'microsoft/phi-4', provider: 'github-models' },
] as const;

/** Strong instruction-follower for the JSON rubric; the suite default judge is
 *  an Anthropic model via openrouter, which GitHub Models does not carry. */
const JUDGE = { name: 'openai/gpt-4.1', provider: 'github-models' };

export const judgeSchema = z.object({
  style_fidelity: z.coerce.number().min(0).max(10)
    .describe('0=no trace of the register, 10=fully inhabits it per the rules'),
  content_fidelity: z.coerce.number().min(0).max(10)
    .describe('0=required content missing or wrong, 10=all required content present'),
  fluency: z.coerce.number().min(0).max(10)
    .describe('grammatical, coherent writing, judged independently of the register'),
  rule_violations: z.string()
    .describe('comma-separated register rules that were broken, or "none"'),
  explanation: z.string().describe('one or two sentences'),
});

export function extractStyleScore(j: { style_fidelity?: number; content_fidelity?: number }): number {
  return 0.6 * (j.style_fidelity ?? 0) + 0.4 * (j.content_fidelity ?? 0);
}

function buildTask(style: StyleDef, brief: Brief): EvalTask {
  return {
    id: `${style.id}--${brief.id}`,
    name: `${style.label} — ${brief.name}`,
    prompt: brief.prompt,
    maxScore: 10,
    section: style.id,
    judge: {
      schema: judgeSchema,
      instructions: [
        `The response was asked to write in the register "${style.label}", following these rules:`,
        style.rules,
        `The brief required this content to survive the register: ${brief.contentChecklist.join('; ')}.`,
        'Score style_fidelity strictly against the rules above — reserve 9-10 for responses a human editor would accept as the genuine register.',
        'Score content_fidelity against the required content list; fluency independently of the register.',
      ],
      extractScore: extractStyleScore,
    },
  };
}

/** Repeatable/comma-separated value(s) for a flag, e.g. --style a,b --style c. */
function flagValues(flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === flag) values.push(...process.argv[i + 1].split(','));
  }
  return values.map((v) => v.trim()).filter(Boolean);
}

async function main() {
  const styles = await loadStyles();

  const onlyStyles = flagValues('--style');
  const onlyBriefs = flagValues('--brief');
  for (const id of onlyStyles) {
    if (!styles.some((s) => s.id === id)) {
      throw new Error(`Unknown style "${id}" — have: ${styles.map((s) => s.id).join(', ')}`);
    }
  }
  for (const id of onlyBriefs) {
    if (!BRIEFS.some((b) => b.id === id)) {
      throw new Error(`Unknown brief "${id}" — have: ${BRIEFS.map((b) => b.id).join(', ')}`);
    }
  }

  const activeStyles = styles.filter((s) => onlyStyles.length === 0 || onlyStyles.includes(s.id));
  const activeBriefs = BRIEFS.filter((b) => onlyBriefs.length === 0 || onlyBriefs.includes(b.id));
  const styleById = new Map(styles.map((s) => [s.id, s]));

  const suite = new EvalSuite({
    name: EVAL_NAME,
    stimulus: (task) => {
      const style = styleById.get(task.section ?? '');
      if (!style) throw new Error(`Task ${task.id} has no style section`);
      return {
        id: `style-${style.id}`,
        role: style.role,
        objective: `write entirely in the ${style.label} register`,
        instructions: [
          'Follow the register rules below without exception.',
          'Deliver only the piece itself — no preamble, no commentary, no title unless asked.',
        ],
        systemContext: style.rules,
        temperature: style.temperature,
      };
    },
    models: [...LOCAL],
    allModels: [...ALL],
    judgeModel: JUDGE,
    concurrency: 2,
    tasks: activeStyles.flatMap((style) => activeBriefs.map((brief) => buildTask(style, brief))),
  });

  await suite.run();
}

// Entry-point guard: stylometrics.ts and generate-report.ts import EVAL_NAME
// from this module; importing must not launch the eval.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}
