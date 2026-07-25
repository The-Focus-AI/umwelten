/**
 * Detector registry. Same shape as core's compaction-strategy registry so both
 * pluggable axes of the experiment feel identical from the CLI and the UI.
 */

import type { FissionDetector } from "./types.js";
import { neverDetector } from "./never.js";
import { lexicalDriftDetector } from "./lexical-drift.js";
import { llmJudgeDetector } from "./llm-judge.js";
import { hybridDetector } from "./hybrid.js";

const detectors = new Map<string, FissionDetector>();

export function registerDetector(detector: FissionDetector): void {
  detectors.set(detector.id, detector);
}

export function getDetector(id: string): FissionDetector | undefined {
  ensureBuiltins();
  return detectors.get(id);
}

export function listDetectors(): FissionDetector[] {
  ensureBuiltins();
  return Array.from(detectors.values());
}

let builtinsRegistered = false;
function ensureBuiltins(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  for (const detector of [
    hybridDetector,
    lexicalDriftDetector,
    llmJudgeDetector,
    neverDetector,
  ]) {
    registerDetector(detector);
  }
}
