/**
 * Stage 2 of the supplier agent: discover.
 *
 * Stage 1 (estimate) is `whichllm` or equivalent — it reads your hardware and
 * predicts which models *should* fit, from VRAM math plus published
 * leaderboards. It never executes a model, so it cannot tell you what this box
 * actually does. That is stage 3's job (`probe.ts`).
 *
 * This stage sits between them and answers a narrower question: which local
 * runtimes are up right now, and what do they say they are serving? We ask the
 * runtimes rather than the disk, because in adapt-mode the box's existing
 * Ollama/LM Studio config is the thing we are reselling.
 *
 * `findLlamaSwapModels()` in core scans GGUF caches on disk instead — use that
 * when the agent owns the serving layer and needs to generate a llama-swap
 * config, rather than adapting to what is already running.
 */

import { createOllamaProvider } from "@umwelten/core/providers/ollama.js";
import { createLMStudioProvider } from "@umwelten/core/providers/lmstudio.js";
import { createLlamaBarnProvider } from "@umwelten/core/providers/llamabarn.js";
import { createLlamaSwapProvider } from "@umwelten/core/providers/llamaswap.js";
import type { BaseProvider } from "@umwelten/core/providers/base.js";
import type { MachineState } from "./types.js";

const RUNTIMES: { provider: string; create: () => BaseProvider }[] = [
  { provider: "ollama", create: () => createOllamaProvider() },
  { provider: "lmstudio", create: () => createLMStudioProvider() },
  { provider: "llamabarn", create: () => createLlamaBarnProvider() },
  { provider: "llamaswap", create: () => createLlamaSwapProvider() },
];

/**
 * Knock on every local runtime we know about. Unreachable runtimes are
 * reported rather than thrown — a box running only Ollama is the normal case,
 * not an error.
 */
export async function discoverRuntimes(
  only?: string[],
): Promise<MachineState["runtimes"][number][]> {
  const wanted = only?.length
    ? RUNTIMES.filter((r) => only.includes(r.provider))
    : RUNTIMES;

  return Promise.all(
    wanted.map(async ({ provider, create }): Promise<MachineState["runtimes"][number]> => {
      try {
        const models = await create().listModels();
        return {
          provider,
          reachable: true,
          models: models.map((m) => m.name).sort(),
        };
      } catch (error) {
        return {
          provider,
          reachable: false,
          models: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

/** Flatten discovery into the (provider, model) pairs a probe run iterates. */
export function toProbeTargets(
  runtimes: MachineState["runtimes"][number][],
  modelFilter?: string,
): { provider: string; model: string }[] {
  return runtimes
    .filter((r) => r.reachable)
    .flatMap((r) => r.models.map((model) => ({ provider: r.provider, model })))
    .filter((t) => !modelFilter || t.model.includes(modelFilter));
}
