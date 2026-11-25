/**
 * Dynamic Model Matrix Loader for Umwelten examples and Model Watch.
 *
 * Replaces static cloud price tables with the declarative manifest in
 * `examples/model-watch/models.json`, hydrated with live pricing and thinking
 * metadata from `@earendil-works/pi-ai` (`builtinModels()`).
 */

import { parseModelSpecString, type ModelSpec } from "@umwelten/pi";
import {
  loadModelMatrix,
  selectMatrixModels,
  type MatrixModelEntry,
} from "./model-matrix.js";

export type FastModelEntry = MatrixModelEntry;

export const FAST_MODEL_MANIFEST = loadModelMatrix();

export const FAST_MODEL_ROSTER: FastModelEntry[] = selectMatrixModels(
  FAST_MODEL_MANIFEST,
  {
    groups: FAST_MODEL_MANIFEST.defaultGroups,
  },
);

function requireRosterModel(
  predicate: (entry: FastModelEntry) => boolean,
  label: string,
): FastModelEntry {
  const match = FAST_MODEL_ROSTER.find(predicate);
  if (!match) {
    throw new Error(
      `Required quick-slice model "${label}" not found in active FAST_MODEL_ROSTER (${FAST_MODEL_ROSTER.length} entries). Check examples/model-watch/models.json.`,
    );
  }
  return match;
}

/** Concise 5-model fast slice used by quick standalone example scripts. */
export const QUICK_FAST_MODELS: FastModelEntry[] = [
  requireRosterModel((m) => m.name === "gemini-4-hydrogen", "gemini-4-hydrogen"),
  requireRosterModel((m) => m.name === "claude-haiku-5-5", "claude-haiku-5-5"),
  requireRosterModel((m) => m.name === "openai/gpt-6-luna", "openai/gpt-6-luna"),
  requireRosterModel((m) => m.name === "z-ai/glm-5.3-flash", "z-ai/glm-5.3-flash"),
  requireRosterModel(
    (m) => m.provider === "ollama" && m.name === "gemma4:26b",
    "ollama:gemma4:26b",
  ),
];

export const DEFAULT_FAST_JUDGE: ModelSpec = parseModelSpecString(
  FAST_MODEL_MANIFEST.defaultJudge,
);
