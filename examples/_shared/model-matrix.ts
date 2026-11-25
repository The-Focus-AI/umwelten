import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  canonicalizeThinkingEffort,
  formatModelSpecString,
  getCatalogModelInfo,
  parseModelSpecString,
  type ModelSpec,
  type ThinkingEffort,
} from "@umwelten/pi";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MATRIX_PATH = path.resolve(
  HERE,
  "..",
  "model-watch",
  "models.json",
);

const ThinkingEffortSchema = z.enum([
  "off",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const ModelMatrixEntrySchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  weights: z.enum(["open", "closed"]),
  tier: z.enum(["cloud", "local"]),
  family: z
    .enum([
      "frontier-fable",
      "frontier-workhorse",
      "open-weight",
      "local",
      "gemini",
      "frontier-fast",
      "wafer-open",
    ])
    .optional(),
  enabled: z.boolean().optional().default(true),
  reasoningEffort: ThinkingEffortSchema.optional(),
  costs: z
    .object({
      promptTokens: z.number().nonnegative(),
      completionTokens: z.number().nonnegative(),
      cachedInputTokens: z.number().nonnegative().optional(),
      cacheWriteTokens: z.number().nonnegative().optional(),
    })
    .optional(),
  baseUrl: z.string().optional(),
  extraBody: z.record(z.string(), z.unknown()).optional(),
  tagline: z.string().optional(),
  laptopFit: z.enum(["yes", "no"]).optional(),
  params: z.string().optional(),
  footprint: z.string().optional(),
  canonicalId: z.string().optional(),
});

export const ModelMatrixGroupSchema = z.object({
  description: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  defaultEfforts: z.array(ThinkingEffortSchema).optional(),
  models: z.array(ModelMatrixEntrySchema),
});

export const ModelMatrixManifestSchema = z.object({
  version: z.number().int().positive().default(1),
  defaultJudge: z.string().min(1).default("google:gemini-4-hydrogen"),
  defaultGroups: z.array(z.string().min(1)).default([]),
  groups: z.record(z.string(), ModelMatrixGroupSchema),
});

export type ModelMatrixManifest = z.infer<typeof ModelMatrixManifestSchema>;
export type RawModelMatrixEntry = z.infer<typeof ModelMatrixEntrySchema>;

export interface MatrixModelEntry extends ModelSpec {
  weights: "open" | "closed";
  tier: "cloud" | "local";
  enabled: boolean;
  family?:
    | "frontier-fable"
    | "frontier-workhorse"
    | "open-weight"
    | "local"
    | "gemini"
    | "frontier-fast"
    | "wafer-open";
  tagline?: string;
  group?: string;
  supportedThinkingLevels?: string[];
  laptopFit?: "yes" | "no";
  params?: string;
  footprint?: string;
  canonicalId?: string;
}

const LOCAL_PROVIDER_PREFIXES = [
  "ollama",
  "llamaswap",
  "llamabarn",
  "lmstudio",
  "vllm",
  "mlx",
];

const CLOSED_NAME_PREFIXES = [
  "anthropic/",
  "claude-",
  "openai/gpt-5",
  "openai/gpt-6",
  "gpt-5",
  "gpt-6",
  "gpt-4",
  "x-ai/",
  "grok-",
  "gemini-",
  "google/gemini-",
  "minimax",
  "MiniMax",
  "inception/",
  "qwen/qwen4-max",
  "meta/muse-wonder",
  "meta/muse-ember",
  "meta/muse-spark-1.",
];

export function isLocalProviderName(provider: string): boolean {
  return LOCAL_PROVIDER_PREFIXES.some(
    (p) => provider === p || provider.startsWith(`${p}-`),
  );
}

export function inferModelWeights(
  name: string,
  provider: string,
): "open" | "closed" {
  if (isLocalProviderName(provider)) return "open";
  if (name.includes("gpt-oss")) return "open";
  return CLOSED_NAME_PREFIXES.some((p) => name.startsWith(p))
    ? "closed"
    : "open";
}

export function loadModelMatrix(
  manifestPath: string = DEFAULT_MATRIX_PATH,
): ModelMatrixManifest {
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  return ModelMatrixManifestSchema.parse(raw);
}

export function saveModelMatrix(
  manifest: ModelMatrixManifest,
  manifestPath: string = DEFAULT_MATRIX_PATH,
): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

export function hydrateEntryWithCatalog(
  entry: Omit<MatrixModelEntry, "supportedThinkingLevels"> & {
    supportedThinkingLevels?: string[];
  },
): MatrixModelEntry {
  const info = getCatalogModelInfo(entry);
  const costs =
    entry.tier === "local"
      ? { promptTokens: 0, completionTokens: 0 }
      : entry.costs ??
        (info.cost
          ? {
              promptTokens: info.cost.promptTokens,
              completionTokens: info.cost.completionTokens,
              cachedInputTokens: info.cost.cachedInputTokens,
              cacheWriteTokens: info.cost.cacheWriteTokens,
            }
          : undefined);
  return {
    ...entry,
    ...(costs ? { costs } : {}),
    ...(info.contextWindow && !entry.contextLength
      ? { contextLength: info.contextWindow }
      : {}),
    supportedThinkingLevels: info.supportedThinkingLevels,
  };
}

function matrixDedupKey(m: Pick<ModelSpec, "provider" | "name" | "reasoningEffort" | "baseUrl">): string {
  const effort = canonicalizeThinkingEffort(m.reasoningEffort) ?? "";
  return `${m.provider}::${m.name}::${effort}::${m.baseUrl ?? ""}`;
}

export function loadLabDirModels(labDir: string): MatrixModelEntry[] {
  const resolvedRoot = path.resolve(labDir);
  const modelsDir = path.join(resolvedRoot, "models");
  if (!fs.existsSync(modelsDir)) {
    throw new Error(`Lab models directory not found: ${modelsDir}`);
  }

  const dirs = fs
    .readdirSync(modelsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const out: MatrixModelEntry[] = [];
  for (const dirName of dirs) {
    const dirPath = path.join(modelsDir, dirName);
    const bestPath = path.join(dirPath, "best-config.json");
    const basePath = path.join(dirPath, "configs", "base.json");
    const cfgPath = fs.existsSync(bestPath)
      ? bestPath
      : fs.existsSync(basePath)
        ? basePath
        : null;
    if (!cfgPath) continue;

    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as {
      name?: string;
      base_url?: string;
      model?: string;
      extra_body?: Record<string, unknown>;
    };
    if (!cfg.model || !cfg.base_url) continue;

    const isOllama =
      dirName.includes("ollama") ||
      cfg.base_url.includes(":11434") ||
      cfg.base_url.includes(":11435") ||
      cfg.model.includes(":");
    const provider = isOllama ? "ollama" : "mlx";
    const sourceTag = path.basename(cfgPath) === "best-config.json" ? "best" : (cfg.name ?? "base");

    out.push(
      hydrateEntryWithCatalog({
        provider,
        name: cfg.model,
        weights: "open",
        tier: "local",
        family: "local",
        enabled: true,
        baseUrl: cfg.base_url.replace(/\/$/, ""),
        ...(cfg.extra_body ? { extraBody: cfg.extra_body } : {}),
        tagline: `${dirName} (${sourceTag}) via ${cfg.base_url}`,
        group: "local-lab",
      }),
    );
  }
  return out;
}

export async function discoverLocalOllamaModels(
  host: string = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434",
): Promise<MatrixModelEntry[]> {
  const base = host.replace(/\/$/, "");
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama /api/tags failed (${res.status} ${res.statusText})`);
  }
  const body = (await res.json()) as {
    models?: Array<{
      name?: string;
      digest?: string;
      size?: number;
      remote_host?: string;
      details?: { parameter_size?: string; quantization_level?: string };
    }>;
  };

  // Deduplicate identical digests (e.g. gemma4:e4b vs gemma4:latest) preferring explicit tags
  const byDigest = new Map<string, NonNullable<typeof body.models>[number]>();
  const unkeyed: NonNullable<typeof body.models>[number][] = [];

  for (const m of body.models ?? []) {
    if (!m.name) continue;
    if (m.remote_host || /:cloud$/i.test(m.name)) continue;
    if (/embed/i.test(m.name)) continue;
    if (!m.digest) {
      unkeyed.push(m);
      continue;
    }
    const prev = byDigest.get(m.digest);
    if (!prev || (prev.name?.endsWith(":latest") && !m.name.endsWith(":latest"))) {
      byDigest.set(m.digest, m);
    }
  }

  const unique = [...byDigest.values(), ...unkeyed];
  return unique.map((m) => {
    const sizeGb = m.size ? `${(m.size / 1e9).toFixed(1)} GB` : undefined;
    const quant = m.details?.quantization_level;
    const meta = [m.details?.parameter_size, quant, sizeGb]
      .filter(Boolean)
      .join(", ");
    return hydrateEntryWithCatalog({
      provider: "ollama",
      name: m.name!,
      weights: "open",
      tier: "local",
      family: "local",
      enabled: true,
      tagline: meta ? `Local Ollama (${meta})` : "Local Ollama chat model",
      group: "local-ollama",
    });
  });
}

export interface SelectMatrixOptions {
  groups?: string[];
  models?: string[];
  add?: string[];
  exclude?: string[];
  efforts?: ThinkingEffort[];
  useGroupEfforts?: boolean;
  labDir?: string;
  includeDisabledEntries?: boolean;
}

function findManifestEntry(
  manifest: ModelMatrixManifest,
  provider: string,
  name: string,
): { entry: RawModelMatrixEntry; group: string } | undefined {
  for (const [groupName, grp] of Object.entries(manifest.groups)) {
    const match = grp.models.find(
      (m) => m.provider === provider && m.name === name,
    );
    if (match) return { entry: match, group: groupName };
  }
  return undefined;
}

function specToMatrixEntry(
  manifest: ModelMatrixManifest,
  rawSpec: string,
): MatrixModelEntry {
  const parsed = parseModelSpecString(rawSpec);
  const existing = findManifestEntry(manifest, parsed.provider, parsed.name);
  if (existing) {
    return hydrateEntryWithCatalog({
      ...existing.entry,
      enabled: true,
      group: existing.group,
      ...(parsed.reasoningEffort
        ? { reasoningEffort: parsed.reasoningEffort }
        : {}),
    });
  }
  const tier: "cloud" | "local" = isLocalProviderName(parsed.provider)
    ? "local"
    : "cloud";
  return hydrateEntryWithCatalog({
    provider: parsed.provider,
    name: parsed.name,
    weights: inferModelWeights(parsed.name, parsed.provider),
    tier,
    enabled: true,
    ...(tier === "local" ? { family: "local" as const } : {}),
    ...(parsed.reasoningEffort
      ? { reasoningEffort: parsed.reasoningEffort }
      : {}),
  });
}

function matchesExcludeToken(entry: MatrixModelEntry, token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (t.endsWith(":*")) {
    return entry.provider === t.slice(0, -2);
  }
  if (t === entry.name) return true;
  if (t === formatModelSpecString(entry)) return true;
  if (!t.includes("@") && t === `${entry.provider}:${entry.name}`) return true;
  return false;
}

export function selectMatrixModels(
  manifest: ModelMatrixManifest,
  opts: SelectMatrixOptions = {},
): MatrixModelEntry[] {
  let selected: MatrixModelEntry[] = [];

  if (opts.models && opts.models.length > 0) {
    selected = opts.models.map((raw) => specToMatrixEntry(manifest, raw));
  } else {
    const groupNames =
      opts.groups && opts.groups.length > 0
        ? opts.groups
        : manifest.defaultGroups;
    for (const groupName of groupNames) {
      const grp = manifest.groups[groupName];
      if (!grp) {
        throw new Error(
          `Unknown model matrix group "${groupName}". Available groups: ${Object.keys(manifest.groups).join(", ")}`,
        );
      }
      for (const item of grp.models) {
        if (!opts.includeDisabledEntries && item.enabled === false) continue;
        selected.push(
          hydrateEntryWithCatalog({
            ...item,
            enabled: item.enabled ?? true,
            group: groupName,
          }),
        );
      }
    }
  }

  if (opts.labDir) {
    selected.push(...loadLabDirModels(opts.labDir));
  }

  if (opts.add && opts.add.length > 0) {
    for (const raw of opts.add) {
      selected.push(specToMatrixEntry(manifest, raw));
    }
  }

  if (opts.exclude && opts.exclude.length > 0) {
    selected = selected.filter(
      (entry) => !opts.exclude!.some((tok) => matchesExcludeToken(entry, tok)),
    );
  }

  if (opts.efforts && opts.efforts.length > 0) {
    const expanded: MatrixModelEntry[] = [];
    for (const entry of selected) {
      for (const eff of opts.efforts) {
        const norm = canonicalizeThinkingEffort(eff);
        expanded.push({
          ...entry,
          ...(norm ? { reasoningEffort: norm } : {}),
        });
      }
    }
    selected = expanded;
  } else if (opts.useGroupEfforts) {
    const expanded: MatrixModelEntry[] = [];
    for (const entry of selected) {
      if (entry.reasoningEffort) {
        expanded.push(entry);
        continue;
      }
      const groupEfforts = entry.group
        ? manifest.groups[entry.group]?.defaultEfforts
        : undefined;
      if (groupEfforts && groupEfforts.length > 0) {
        for (const eff of groupEfforts) {
          const norm = canonicalizeThinkingEffort(eff);
          expanded.push({
            ...entry,
            ...(norm ? { reasoningEffort: norm } : {}),
          });
        }
      } else {
        expanded.push(entry);
      }
    }
    selected = expanded;
  }

  const deduped: MatrixModelEntry[] = [];
  const seen = new Set<string>();
  for (const item of selected) {
    const k = matrixDedupKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(item);
  }
  return deduped;
}

export function defaultGroupForSpec(
  spec: ModelSpec,
  weights: "open" | "closed",
  hasBaseUrl?: boolean,
): string {
  if (spec.provider.startsWith("mlx") || hasBaseUrl) return "local-lab";
  if (isLocalProviderName(spec.provider)) return "local-ollama";
  if (weights === "open") return "open-weight-cloud";
  if (/fable|astra|carbon|neon|wonder|qwen4-max|grok-4\.7/i.test(spec.name)) {
    return "frontier-fable";
  }
  return "frontier-workhorse";
}

export function addMatrixModel(
  manifest: ModelMatrixManifest,
  rawSpec: string,
  opts: {
    group?: string;
    weights?: "open" | "closed";
    tier?: "cloud" | "local";
    baseUrl?: string;
    extraBody?: Record<string, unknown>;
    tagline?: string;
  } = {},
): { manifest: ModelMatrixManifest; group: string; entry: RawModelMatrixEntry; replaced: boolean } {
  const parsed = parseModelSpecString(rawSpec);
  const weights =
    opts.weights ?? inferModelWeights(parsed.name, parsed.provider);
  const tier =
    opts.tier ?? (isLocalProviderName(parsed.provider) ? "local" : "cloud");
  const group =
    opts.group ?? defaultGroupForSpec(parsed, weights, Boolean(opts.baseUrl));

  const next: ModelMatrixManifest = structuredClone(manifest);
  if (!next.groups[group]) {
    next.groups[group] = {
      description: `Custom group (${group})`,
      enabled: true,
      models: [],
    };
  }

  const entry: RawModelMatrixEntry = {
    provider: parsed.provider,
    name: parsed.name,
    weights,
    tier,
    enabled: true,
    ...(tier === "local" ? { family: "local" as const } : {}),
    ...(parsed.reasoningEffort
      ? { reasoningEffort: parsed.reasoningEffort }
      : {}),
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl.replace(/\/$/, "") } : {}),
    ...(opts.extraBody ? { extraBody: opts.extraBody } : {}),
    ...(opts.tagline ? { tagline: opts.tagline } : {}),
  };

  const models = next.groups[group].models;
  const idx = models.findIndex(
    (m) => matrixDedupKey(m) === matrixDedupKey(entry),
  );
  const replaced = idx !== -1;
  if (replaced) {
    models[idx] = entry;
  } else {
    models.push(entry);
  }
  return { manifest: next, group, entry, replaced };
}

export function removeMatrixModel(
  manifest: ModelMatrixManifest,
  rawSpec: string,
  groupName?: string,
): { manifest: ModelMatrixManifest; removedCount: number } {
  const trimmed = rawSpec.trim();
  const parsed = trimmed.includes(":") ? parseModelSpecString(trimmed) : null;
  const next: ModelMatrixManifest = structuredClone(manifest);
  let removedCount = 0;

  for (const [gName, grp] of Object.entries(next.groups)) {
    if (groupName && gName !== groupName) continue;
    const before = grp.models.length;
    grp.models = grp.models.filter((m) => {
      if (!parsed) return m.name !== trimmed;
      if (m.provider !== parsed.provider || m.name !== parsed.name) return true;
      if (parsed.reasoningEffort) {
        return (
          canonicalizeThinkingEffort(m.reasoningEffort) !==
          parsed.reasoningEffort
        );
      }
      return false;
    });
    removedCount += before - grp.models.length;
  }

  return { manifest: next, removedCount };
}

export function setMatrixModelEnabled(
  manifest: ModelMatrixManifest,
  rawSpec: string,
  enabled: boolean,
  groupName?: string,
): { manifest: ModelMatrixManifest; updatedCount: number } {
  const trimmed = rawSpec.trim();
  const parsed = trimmed.includes(":") ? parseModelSpecString(trimmed) : null;
  const next: ModelMatrixManifest = structuredClone(manifest);
  let updatedCount = 0;

  for (const [gName, grp] of Object.entries(next.groups)) {
    if (groupName && gName !== groupName) continue;
    for (const m of grp.models) {
      const match = parsed
        ? m.provider === parsed.provider &&
          m.name === parsed.name &&
          (!parsed.reasoningEffort ||
            canonicalizeThinkingEffort(m.reasoningEffort) ===
              parsed.reasoningEffort)
        : m.name === trimmed;
      if (match) {
        m.enabled = enabled;
        updatedCount++;
      }
    }
  }

  return { manifest: next, updatedCount };
}

export function syncGroupEntries(
  manifest: ModelMatrixManifest,
  groupName: string,
  entries: MatrixModelEntry[],
  description?: string,
): ModelMatrixManifest {
  const next: ModelMatrixManifest = structuredClone(manifest);
  const prevModels = next.groups[groupName]?.models ?? [];
  const prevEnabled = new Map(
    prevModels.map((m) => [matrixDedupKey(m), m.enabled]),
  );

  const prevDefaultEfforts = next.groups[groupName]?.defaultEfforts;
  next.groups[groupName] = {
    description:
      description ??
      next.groups[groupName]?.description ??
      `Imported group (${groupName})`,
    enabled: next.groups[groupName]?.enabled ?? false,
    ...(prevDefaultEfforts ? { defaultEfforts: prevDefaultEfforts } : {}),
    models: entries.map((e) => ({
      provider: e.provider,
      name: e.name,
      weights: e.weights,
      tier: e.tier,
      family: e.family,
      enabled: prevEnabled.get(matrixDedupKey(e)) ?? e.enabled ?? true,
      ...(e.reasoningEffort ? { reasoningEffort: e.reasoningEffort } : {}),
      ...(e.costs ? { costs: e.costs } : {}),
      ...(e.baseUrl ? { baseUrl: e.baseUrl } : {}),
      ...(e.extraBody ? { extraBody: e.extraBody } : {}),
      ...(e.tagline ? { tagline: e.tagline } : {}),
      ...(e.laptopFit ? { laptopFit: e.laptopFit } : {}),
      ...(e.params ? { params: e.params } : {}),
      ...(e.footprint ? { footprint: e.footprint } : {}),
      ...(e.canonicalId ? { canonicalId: e.canonicalId } : {}),
    })),
  };

  return next;
}
