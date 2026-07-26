/**
 * Pairing model names across runtimes.
 *
 * The Q11 experiment — does adapt-mode give capabilities stable enough to
 * resell? — only works if we can tell that Ollama's `gemma4:26b` and
 * llama-swap's `ggml-org/gemma-4-26B-A4B-it-GGUF:Q4_K_M` are the same weights.
 * Nothing in either name makes that obvious, so we normalize both to a
 * (family, size) identity and compare that.
 *
 * This is a heuristic and it will be wrong sometimes. That is why the probe
 * prints the full matrix rather than only the rows it managed to pair — a
 * missed pair should cost you a squint, not the finding.
 */

/** Publishers that prefix a repo name without being part of the model family. */
const VENDOR_PREFIXES = new Set([
  "nvidia",
  "meta",
  "google",
  "microsoft",
  "mistralai",
  "ggml",
  "ggmlorg",
  "ggml-org",
  "unsloth",
  "bartowski",
  "thebloke",
  "lmstudio",
]);

/** Quantization, format, and tuning tokens that say nothing about identity. */
const NOISE = /^(gguf|it|instruct|chat|latest|q\d\w*|k|m|s|mxfp\d+|bf16|f16|fp\d+)$/;

/** A size token: 4b, 26b, 1.5b, e2b (Gemma's efficiency variants). */
const SIZE = /^e?\d+(\.\d+)?b$/;

export interface ModelIdentity {
  /** Best guess at the model family, e.g. "gemma4", "gptoss", "nemotron3nano". */
  family: string;
  /** Parameter size token if one is present, e.g. "26b". */
  size?: string;
  /** family plus size when both are known — the strict pairing key. */
  key: string;
}

/**
 * Reduce a runtime-specific model name to a comparable identity.
 *
 * Deliberately does not split on `.` — `qwen3.6` is a family name, not a
 * family and a minor version.
 */
export function modelIdentity(model: string): ModelIdentity {
  const withoutOrg = model.toLowerCase().split("/").pop() ?? model.toLowerCase();
  const tokens = withoutOrg.split(/[-_:\s]+/).filter(Boolean);

  const familyParts: string[] = [];
  let size: string | undefined;

  for (const [i, token] of tokens.entries()) {
    if (SIZE.test(token)) {
      // The first size token wins. Gemma MoE names carry a second one (the
      // active-parameter count, e.g. "a4b"), which we ignore.
      size ??= token;
      continue;
    }
    if (NOISE.test(token)) continue;
    // A vendor prefix only counts as noise in leading position.
    if (i === 0 && VENDOR_PREFIXES.has(token) && tokens.length > 1) continue;
    // Once we have a size, later alphabetic tokens are quant/tuning detail.
    if (size) continue;
    familyParts.push(token);
  }

  const family = familyParts.join("");
  return { family, size, key: size ? `${family}:${size}` : family };
}

/**
 * Group probed models so the same weights sit adjacent regardless of runtime.
 * Groups on family, not on the strict key, because a runtime that reports
 * `gpt-oss:latest` has no size to pair on and would otherwise be orphaned.
 */
export function groupByFamily<T extends { model: string }>(
  items: T[],
): Map<string, (T & { identity: ModelIdentity })[]> {
  const groups = new Map<string, (T & { identity: ModelIdentity })[]>();
  for (const item of items) {
    const identity = modelIdentity(item.model);
    const existing = groups.get(identity.family) ?? [];
    existing.push({ ...item, identity });
    groups.set(identity.family, existing);
  }
  return groups;
}
