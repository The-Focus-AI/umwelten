import { summarize } from "./summarize.js";
import type { CompactionStrategy } from "../types.js";

/** maxSummaryTokens defaults to 2048. See summarize.ts for enforcement/estimate. */
export const taskHandoffStrategy: CompactionStrategy = {
  id: "task-handoff",
  name: "Task handoff",
  description:
    "Preserve task state, constraints, evidence, uncertainty, failed attempts and pending work.",
  compact: (input) =>
    summarize(
      input,
      `Produce a concise task handoff for an agent continuing this work.
Use these sections, marking unknown or absent information explicitly:
- Task: current goal, requested outcome and acceptance criteria.
- Constraints: user requirements, scope boundaries, decisions and their reasons.
- Evidence references: verified results with exact file paths, URLs, artifact IDs, tool-call IDs and other useful source references. Distinguish observations from claims; do not invent references.
- Uncertainty: unresolved questions, assumptions, risks and unverified claims.
- Failed attempts: approaches tried, actual errors or negative results, and why they failed.
- Pending work: remaining steps, blockers and checks still needed; distinguish completed from planned work.
Preserve consequential details in every section before spending space on narrative.
Write in the same language as the conversation.`,
      2048,
    ),
};
