/**
 * Replay — reconstruct an Interaction from a saved task transcript.
 *
 * Given the transcript sidecar file written by EvalSuite (see
 * `<runDir>/<taskId>/<modelKey>.transcript.json`), build a fresh
 * Interaction with the same Stimulus + message history. The interaction
 * is ready for `chat()` / `streamText()` — multi-turn follow-up evals
 * (2-pass coding, agent loops, etc.) just append a new user message and
 * call the model.
 *
 * Tools are NOT round-tripped through the snapshot (function references
 * aren't serializable). Callers that need tool support pass them via
 * `opts.tools`, matching the original task's tool set.
 */

import fs from 'fs';
import type { ModelMessage } from 'ai';
import { Stimulus, type StimulusOptions } from '@umwelten/core/stimulus/stimulus.js';
import { Interaction } from '@umwelten/core/interaction/core/interaction.js';
import type { ModelDetails } from '@umwelten/core/cognition/types.js';

export interface TranscriptFile {
  taskId: string;
  model: string;
  provider: string;
  prompt: string;
  stimulusOptions: Omit<StimulusOptions, 'tools' | 'runnerType'>;
  messages: ModelMessage[];
}

export interface ReplayOptions {
  /** Re-attach tools that were stripped from the snapshot. */
  tools?: StimulusOptions['tools'];
  /** Override the model used for follow-up turns (default: same model
   *  the original transcript was produced with). Useful when comparing
   *  "small model writes, big model judges" patterns. */
  model?: ModelDetails;
}

export function loadTranscript(filePath: string): TranscriptFile {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as TranscriptFile;
  if (!Array.isArray(data.messages) || data.messages.length === 0) {
    throw new Error(`Transcript ${filePath} has no messages`);
  }
  return data;
}

/**
 * Rebuild an Interaction from a saved transcript. The returned object
 * has its full message history populated; call `interaction.addMessage(...)`
 * + `interaction.streamText()` (or `chat()`) to continue the conversation.
 */
export function replayInteraction(
  transcript: TranscriptFile,
  opts: ReplayOptions = {},
): Interaction {
  const stimulus = new Stimulus({
    ...transcript.stimulusOptions,
    ...(opts.tools ? { tools: opts.tools } : {}),
    runnerType: 'base',
  });
  const model: ModelDetails =
    opts.model ?? { name: transcript.model, provider: transcript.provider };
  const interaction = new Interaction(model, stimulus);
  // Replace the freshly-built [system] message array with the saved
  // transcript. Interaction's constructor seeds `messages[0]` as the
  // system prompt; the saved transcript already includes it (or a
  // closer-to-actual variant), so trust the saved version.
  interaction.messages = transcript.messages.slice();
  return interaction;
}

/**
 * Convenience: load + replay in one call.
 */
export function replayFromFile(
  filePath: string,
  opts: ReplayOptions = {},
): { transcript: TranscriptFile; interaction: Interaction } {
  const transcript = loadTranscript(filePath);
  const interaction = replayInteraction(transcript, opts);
  return { transcript, interaction };
}
