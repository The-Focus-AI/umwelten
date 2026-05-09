/**
 * llama-swap config generator
 *
 * Discovers GGUF model files in common local caches (LM Studio, LlamaBarn,
 * `llama-cli -hf` downloads, Ollama when using the `ollama-hf` integration)
 * and emits a `llama-swap` YAML config that launches `llama-server` on
 * demand per model alias.
 *
 * Pure functions are separated from filesystem I/O so callers can either
 * let this module scan the standard paths or hand in an explicit list.
 */

import fs from 'node:fs';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GgufModel {
  /** Absolute path to the .gguf file */
  path: string;
  /** Normalized, filesystem/URL-safe alias (e.g. "gemma-4-26b-a4b") */
  alias: string;
  /** Raw filename (without .gguf) — useful for debugging */
  baseName: string;
  /** File size in bytes */
  sizeBytes?: number;
}

export interface BuildConfigOptions {
  /** Context window to request. 0 = model maximum. Default: 0 */
  ctxSize?: number;
  /** Idle-unload TTL in seconds. Default: 300 */
  ttlSeconds?: number;
  /** Path to the llama-server binary. Default: 'llama-server' (on PATH) */
  llamaServerPath?: string;
  /** Extra args appended to every cmd (e.g. ['--flash-attn']) */
  extraArgs?: string[];
  /** Include a leading comment block. Default: true */
  includeHeader?: boolean;
  /**
   * When multiple GGUF files map to the same alias, which one to keep.
   * 'largest' (default) picks the highest-quality quant (usually Q8 / BF16).
   * 'smallest' picks the smallest file that's still a chat model (usually
   * Q4_K_M) — useful when benchmarking against Ollama, which defaults to Q4.
   */
  preferQuant?: "largest" | "smallest";
}

export interface ScanOptions {
  /** Additional cache roots to search */
  extraCachePaths?: string[];
  /** Replace the default path list instead of extending it */
  cachePaths?: string[];
  /** Maximum directory depth to walk */
  maxDepth?: number;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_CACHE_PATHS = [
  path.join(process.env.HOME ?? '', '.cache/lm-studio/models'),
  path.join(process.env.HOME ?? '', '.lmstudio/models'),
  path.join(process.env.HOME ?? '', 'Library/Application Support/LlamaBarn/models'),
  path.join(process.env.HOME ?? '', '.cache/llama.cpp'),
  // LlamaBarn + `llama-cli -hf ...` downloads land in the HF hub cache
  path.join(process.env.HOME ?? '', '.cache/huggingface/hub'),
];

const DEFAULT_MAX_DEPTH = 6;

// Files to exclude even if they end in .gguf — these aren't chat models.
const EXCLUDE_PATTERNS = [
  /^mmproj/i, // multimodal projector sidecars
  /nomic-embed/i,
  /-embed-text/i,
  /bge-.*-en/i, // BGE embedding models
];

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Collapse a GGUF filename or HF model ID to a stable alias.
 *
 *   "unsloth/gemma-4-26B-A4B-it-GGUF"       → "gemma-4-26b-a4b"
 *   "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf"     → "gemma-4-26b-a4b"
 *   "NVIDIA-Nemotron-3-Nano-4B-Q8_0.gguf"   → "nvidia-nemotron-3-nano-4b"
 */
export function normalizeModelName(name: string): string {
  let s = name.toLowerCase();
  s = s.replace(/\.gguf$/i, '');
  // strip publisher prefix: "unsloth/foo" → "foo"
  s = s.replace(/^[^/]+\//, '');
  // strip quantization markers (with optional separators)
  s = s.replace(/[-._]?(ud-)?(q\d(_k_[ms])?|q\d_\d|bf16|f16|fp16|f32|mxfp4|iq\d(_[a-z]+)?)\b.*$/gi, '');
  // strip format suffix markers
  s = s.replace(/[-._]?gguf\b/gi, '');
  // strip instruction-tuning markers (same weights line)
  s = s.replace(/[-._]?(it|instruct|chat)\b/gi, '');
  // collapse separators
  s = s.replace(/[._]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s;
}

// ── Filesystem scanning ──────────────────────────────────────────────────────

/**
 * Walk a directory tree and return all .gguf files (excluding known
 * non-chat-model patterns like mmproj sidecars and embedding models).
 */
export function scanDirectory(root: string, maxDepth = DEFAULT_MAX_DEPTH): GgufModel[] {
  const out: GgufModel[] = [];
  if (!fs.existsSync(root)) return out;
  walk(root, out, 0, maxDepth);
  return out;
}

function walk(dir: string, out: GgufModel[], depth: number, maxDepth: number) {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // Resolve symlinks — Hugging Face cache stores snapshots as symlinks to blobs.
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const st = fs.statSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch { continue; }
    }
    if (isDir) {
      walk(full, out, depth + 1, maxDepth);
    } else if (isFile && /\.gguf$/i.test(e.name)) {
      if (EXCLUDE_PATTERNS.some(re => re.test(e.name))) continue;
      let sizeBytes: number | undefined;
      try { sizeBytes = fs.statSync(full).size; } catch {}
      const baseName = e.name.replace(/\.gguf$/i, '');
      out.push({ path: full, baseName, alias: normalizeModelName(e.name), sizeBytes });
    }
  }
}

/**
 * Scan all known cache locations for GGUF files.
 */
export function findLlamaSwapModels(opts: ScanOptions = {}): GgufModel[] {
  const paths = opts.cachePaths ?? [...DEFAULT_CACHE_PATHS, ...(opts.extraCachePaths ?? [])];
  const out: GgufModel[] = [];
  for (const p of paths) {
    out.push(...scanDirectory(p, opts.maxDepth ?? DEFAULT_MAX_DEPTH));
  }
  return out;
}

/**
 * Collapse multiple files that normalize to the same alias, keeping either
 * the largest (higher-quality quant, default) or smallest (lower-quality
 * but faster / smaller memory footprint) per alias.
 */
export function dedupeByAlias(
  models: GgufModel[],
  prefer: "largest" | "smallest" = "largest",
): GgufModel[] {
  const byAlias = new Map<string, GgufModel>();
  for (const m of models) {
    const existing = byAlias.get(m.alias);
    if (!existing) {
      byAlias.set(m.alias, m);
      continue;
    }
    const a = existing.sizeBytes ?? 0;
    const b = m.sizeBytes ?? 0;
    if (prefer === "largest" ? b > a : b > 0 && b < a) {
      byAlias.set(m.alias, m);
    }
  }
  return [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias));
}

// ── YAML generation ──────────────────────────────────────────────────────────

const DEFAULT_LLAMA_SERVER = 'llama-server';

/**
 * Build a llama-swap YAML config from a list of GGUF models.
 * Pure function — does no I/O.
 */
export function buildLlamaSwapConfig(models: GgufModel[], opts: BuildConfigOptions = {}): string {
  const ctxSize = opts.ctxSize ?? 0;
  const ttl = opts.ttlSeconds ?? 300;
  const binary = opts.llamaServerPath ?? DEFAULT_LLAMA_SERVER;
  const extra = opts.extraArgs ?? [];
  const includeHeader = opts.includeHeader ?? true;

  const deduped = dedupeByAlias(models, opts.preferQuant ?? "largest");

  const lines: string[] = [];
  if (includeHeader) {
    lines.push('# llama-swap config — generated by umwelten');
    lines.push('#');
    lines.push('# Start the proxy:');
    lines.push('#   llama-swap --config <this file> --listen :8090');
    lines.push('#');
    lines.push(`# ${deduped.length} model${deduped.length === 1 ? '' : 's'} discovered, ttl=${ttl}s, ctx-size=${ctxSize}`);
    lines.push('');
  }
  lines.push('models:');

  for (const m of deduped) {
    const cmdParts = [
      quoteIfNeeded(binary),
      '-m',
      quoteIfNeeded(m.path),
      '--port ${PORT}',
      `--ctx-size ${ctxSize}`,
      '--jinja',
      ...extra,
    ];
    lines.push(`  "${m.alias}":`);
    lines.push(`    cmd: ${cmdParts.join(' ')}`);
    lines.push(`    ttl: ${ttl}`);
    lines.push('');
  }

  return lines.join('\n');
}

function quoteIfNeeded(s: string): string {
  return /[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

// ── Convenience: full pipeline ───────────────────────────────────────────────

/**
 * Scan default + extra cache paths and return the generated YAML directly.
 */
export function generateLlamaSwapConfig(
  opts: BuildConfigOptions & ScanOptions = {}
): { yaml: string; models: GgufModel[] } {
  const models = findLlamaSwapModels(opts);
  const deduped = dedupeByAlias(models, opts.preferQuant ?? "largest");
  const yaml = buildLlamaSwapConfig(deduped, opts);
  return { yaml, models: deduped };
}
