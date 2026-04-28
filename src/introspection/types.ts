import { z } from 'zod';

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const WorkflowRuleSchema = z.object({
  rule: z.string().describe('Short imperative rule, e.g. "Always use pnpm, never npm"'),
  why: z.string().describe('One-sentence reason (often a past mistake or explicit user instruction)'),
  evidence: z.array(z.string()).describe('Quoted user lines or short paraphrases that triggered this rule'),
  confidence: ConfidenceSchema,
});
export type WorkflowRule = z.infer<typeof WorkflowRuleSchema>;

export const ArchitectureFactSchema = z.object({
  fact: z.string().describe('Short factual statement about the codebase'),
  why: z.string().describe('How knowing this saves future agent turns'),
  evidence: z.array(z.string()),
  confidence: ConfidenceSchema,
});
export type ArchitectureFact = z.infer<typeof ArchitectureFactSchema>;

export const GotchaSchema = z.object({
  issue: z.string().describe('The surprising thing or failure mode'),
  workaround: z.string().describe('What to do about it'),
  evidence: z.array(z.string()),
  confidence: ConfidenceSchema,
});
export type Gotcha = z.infer<typeof GotchaSchema>;

export const IntrospectionResultSchema = z.object({
  workflowRules: z.array(WorkflowRuleSchema).default([]),
  architectureFacts: z.array(ArchitectureFactSchema).default([]),
  gotchas: z.array(GotchaSchema).default([]),
  summary: z.string().default('').describe('2-3 sentences describing the arc of the reviewed sessions'),
});
export type IntrospectionResult = z.infer<typeof IntrospectionResultSchema>;

export interface SessionInput {
  id: string;
  source: 'claude-code' | 'habitat' | 'cursor';
  modified: string;
  firstPrompt: string;
  transcriptText: string;
  tokenCount: number;
}

export interface IntrospectionState {
  lastRunAt: string | null;
}

/** A persisted run: what was proposed + which sessions were reviewed. */
export interface IntrospectionRun {
  runId: string; // ISO timestamp, also the filename
  createdAt: string;
  projectPath: string;
  sessionsDir?: string;
  model: { provider: string; name: string };
  sinceISO: string | null; // null = --all
  result: IntrospectionResult;
  sessions: Array<{
    id: string;
    source: 'claude-code' | 'habitat' | 'cursor';
    modified: string;
    firstPrompt: string;
  }>;
}

/** One decision row in introspect-log.jsonl. */
export type DecisionKind = 'workflowRule' | 'architectureFact' | 'gotcha';
export type DecisionVerdict = 'accepted' | 'skipped';
export interface DecisionLogEntry {
  runId: string;
  proposalIndex: number;
  kind: DecisionKind;
  key: string; // normalized rule/fact/issue text, used for dedup
  verdict: DecisionVerdict;
  target?: string; // file path written to on accept
  decidedAt: string;
}
