#!/usr/bin/env node
/**
 * Instruction Following Eval — Deterministic scoring, no LLM judge needed.
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/evals/instruction.ts          # quick
 *   dotenvx run -- pnpm tsx examples/evals/instruction.ts --all    # full
 */

import '../../src/env/load.js';
import { EvalSuite } from '../../src/evaluation/suite.js';

const LOCAL = [
  { name: 'gemini-3-flash-preview', provider: 'google' },
  { name: 'openai/gpt-5.4-nano', provider: 'openrouter' },
  { name: 'qwen3:30b-a3b', provider: 'ollama' },
] as const;

const suite = new EvalSuite({
  name: 'instruction-eval',
  stimulus: {
    role: 'precise assistant that follows instructions exactly',
    objective: 'follow the given instructions with exact format compliance',
    instructions: ['Follow instructions EXACTLY', 'Output ONLY what is requested'],
    temperature: 0.0,
    maxTokens: 500,
  },
  models: [...LOCAL],
  tasks: [
    {
      id: 'word-count',
      name: 'Word Count',
      prompt: 'Write a sentence about the ocean that contains EXACTLY 12 words. Just the sentence, nothing else.',
      maxScore: 5,
      verify: (r) => {
        const words = r.trim().replace(/^["']|["']$/g, '').split(/\s+/).filter(Boolean);
        const diff = Math.abs(words.length - 12);
        if (diff === 0) return { score: 5, details: `${words.length} words ✓` };
        if (diff <= 1) return { score: 3, details: `${words.length} words (off by ${diff})` };
        return { score: 0, details: `${words.length} words (wanted 12)` };
      },
    },
    {
      id: 'json-output',
      name: 'JSON Output',
      prompt: 'Output a JSON object: {"name": string, "age": number 25-35, "skills": array of 3 strings, "active": true}. No markdown fences, no explanation.',
      maxScore: 5,
      verify: (r) => {
        let s = 0; const fails: string[] = [];
        const clean = r.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
        try {
          const obj = JSON.parse(clean);
          if (typeof obj.name === 'string' && obj.name.length > 0) s++; else fails.push('name');
          if (typeof obj.age === 'number' && obj.age >= 25 && obj.age <= 35) s++; else fails.push('age');
          if (Array.isArray(obj.skills) && obj.skills.length === 3) s++; else fails.push('skills');
          if (obj.active === true) s++; else fails.push('active');
          if (!r.includes('```')) s++; else fails.push('fences');
        } catch (e) { return { score: 0, details: `Invalid JSON` }; }
        return { score: s, details: fails.length ? `Failed: ${fails.join(', ')}` : 'Perfect' };
      },
    },
    {
      id: 'negative-constraints',
      name: 'Constraints',
      prompt: 'Write 2 sentences about a sunset, each on its own line. Do NOT use: "beautiful", "sky", "orange". No exclamation marks.',
      maxScore: 5,
      verify: (r) => {
        let s = 0; const fails: string[] = [];
        const lo = r.toLowerCase();
        if (!lo.includes('beautiful')) s++; else fails.push('"beautiful"');
        if (!lo.includes('sky')) s++; else fails.push('"sky"');
        if (!lo.includes('orange')) s++; else fails.push('"orange"');
        if (!r.includes('!')) s++; else fails.push('!');
        const lines = r.trim().split('\n').filter(l => l.trim());
        if (lines.length === 2) s++; else fails.push(`${lines.length} lines`);
        return { score: s, details: fails.length ? `Failed: ${fails.join(', ')}` : 'All constraints met' };
      },
    },
    {
      id: 'markdown-table',
      name: 'MD Table',
      prompt: 'Convert to a markdown table (Name, Age, Role columns):\nAlice, 28, Engineer\nBob, 34, Designer\nCharlie, 22, Student\nOutput ONLY the table.',
      maxScore: 5,
      verify: (r) => {
        const lines = r.trim().split('\n').filter(l => l.trim());
        let s = 0; const fails: string[] = [];
        if (lines.length >= 5) s++; else fails.push(`${lines.length} lines`);
        if (lines[0] && /Name/i.test(lines[0]) && /Age/i.test(lines[0])) s++; else fails.push('header');
        if (lines[1] && /[-|]+/.test(lines[1])) s++; else fails.push('separator');
        const hasData = lines.some(l => /Alice/i.test(l) && /28/.test(l)) &&
                        lines.some(l => /Bob/i.test(l) && /34/.test(l));
        if (hasData) s++; else fails.push('data');
        if (lines.every(l => l.includes('|'))) s++; else fails.push('pipes');
        return { score: s, details: fails.length ? `Failed: ${fails.join(', ')}` : 'Perfect table' };
      },
    },
  ],
});

suite.run().catch(err => { console.error('Fatal:', err); process.exit(1); });
