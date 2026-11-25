#!/usr/bin/env node
/**
 * Manage the declarative benchmark model matrix (`examples/model-watch/models.json`).
 *
 * Subcommands:
 *   list [--group <g>] [--all]
 *   add <provider:model[@effort]> [--group <g>] [--weights open|closed] [--tier cloud|local] [--base-url <url>] [--tagline <text>]
 *   remove <provider:model[@effort]> [--group <g>]
 *   enable <provider:model[@effort]> [--group <g>]
 *   disable <provider:model[@effort]> [--group <g>]
 *   import-ollama [--group local-ollama] [--host <url>]
 *   import-lab [../local-model-labs-m4-max] [--group local-lab]
 */

import path from "node:path";
import { parseArgs } from "node:util";
import { formatModelSpecString, getCatalogModelInfo } from "@umwelten/pi";
import {
  addMatrixModel,
  DEFAULT_MATRIX_PATH,
  discoverLocalOllamaModels,
  hydrateEntryWithCatalog,
  loadLabDirModels,
  loadModelMatrix,
  removeMatrixModel,
  saveModelMatrix,
  setMatrixModelEnabled,
  syncGroupEntries,
} from "../examples/_shared/model-matrix.js";

function usage(): void {
  console.log(`Usage: pnpm run bench:models <subcommand> [options]

Subcommands:
  list [--group <g>] [--all]
  add <provider:model[@effort]> [--group <g>] [--weights open|closed] [--tier cloud|local] [--base-url <url>] [--tagline <text>]
  remove <provider:model[@effort]> [--group <g>]
  enable <provider:model[@effort]> [--group <g>]
  disable <provider:model[@effort]> [--group <g>]
  import-ollama [--group local-ollama] [--host <url>]
  import-lab [../local-model-labs-m4-max] [--group local-lab]
`);
}

function fmtPrice(spec: {
  provider: string;
  name: string;
  tier: "cloud" | "local";
  costs?: { promptTokens: number; completionTokens: number };
}): string {
  if (spec.tier === "local") return "$0 / $0 (local)";
  const info = getCatalogModelInfo(spec);
  if (info.found && info.cost) {
    return `$${info.cost.promptTokens}/$${info.cost.completionTokens}`;
  }
  if (spec.costs) {
    return `$${spec.costs.promptTokens}/$${spec.costs.completionTokens}`;
  }
  return "unlisted";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const sub = argv[0];
  if (!sub || sub === "-h" || sub === "--help") {
    usage();
    return;
  }

  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    allowPositionals: true,
    options: {
      group: { type: "string" },
      all: { type: "boolean", default: false },
      weights: { type: "string" },
      tier: { type: "string" },
      "base-url": { type: "string" },
      tagline: { type: "string" },
      host: { type: "string" },
      file: { type: "string" },
    },
  });

  const manifestPath = values.file
    ? path.resolve(values.file)
    : DEFAULT_MATRIX_PATH;
  const manifest = loadModelMatrix(manifestPath);

  if (sub === "list") {
    const groupEntries = Object.entries(manifest.groups).filter(
      ([gName]) => !values.group || gName === values.group,
    );
    if (groupEntries.length === 0) {
      throw new Error(`No matching group "${values.group}" in ${manifestPath}`);
    }

    console.log(`Matrix: ${manifestPath}`);
    console.log(`Default judge: ${manifest.defaultJudge}`);
    console.log(`Default groups: ${manifest.defaultGroups.join(", ")}\n`);

    for (const [gName, grp] of groupEntries) {
      const isDefault = manifest.defaultGroups.includes(gName);
      const visible = grp.models.filter((m) => values.all || m.enabled !== false);
      if (visible.length === 0 && !values.all) continue;

      const groupTag = isDefault
        ? "default"
        : grp.enabled === false
          ? "opt-in"
          : "enabled";
      const effortsTag =
        grp.defaultEfforts && grp.defaultEfforts.length > 0
          ? `, efforts:[${grp.defaultEfforts.join(",")}]`
          : "";
      console.log(
        `[${gName}] (${groupTag}, ${visible.length}/${grp.models.length}${effortsTag}) — ${grp.description ?? ""}`,
      );
      for (const raw of visible) {
        const m = hydrateEntryWithCatalog({
          ...raw,
          enabled: raw.enabled ?? true,
          group: gName,
        });
        const status = m.enabled ? "on " : "off";
        const spec = formatModelSpecString(m);
        const price = fmtPrice(m);
        const levels =
          m.supportedThinkingLevels && m.supportedThinkingLevels.length > 0
            ? m.supportedThinkingLevels.join(",")
            : m.tier === "local"
              ? "local-runtime"
              : "—";
        const extra = m.baseUrl ? ` (${m.baseUrl})` : "";
        console.log(
          `  ${status} | ${spec.padEnd(40)} | ${m.weights.padEnd(6)} | ${m.tier.padEnd(5)} | ${price.padEnd(16)} | thinking:[${levels}]${extra}`,
        );
      }
      console.log("");
    }
    return;
  }

  if (sub === "add") {
    const spec = positionals[0];
    if (!spec) throw new Error("Missing <provider:model[@effort]> argument.");
    const weights = values.weights as "open" | "closed" | undefined;
    if (weights && weights !== "open" && weights !== "closed") {
      throw new Error(`Invalid --weights "${weights}". Use open or closed.`);
    }
    const tier = values.tier as "cloud" | "local" | undefined;
    if (tier && tier !== "cloud" && tier !== "local") {
      throw new Error(`Invalid --tier "${tier}". Use cloud or local.`);
    }
    const res = addMatrixModel(manifest, spec, {
      group: values.group,
      weights,
      tier,
      baseUrl: values["base-url"],
      tagline: values.tagline,
    });
    saveModelMatrix(res.manifest, manifestPath);
    console.log(
      `${res.replaced ? "Updated" : "Added"} ${formatModelSpecString(res.entry)} in group "${res.group}" -> ${manifestPath}`,
    );
    return;
  }

  if (sub === "remove") {
    const spec = positionals[0];
    if (!spec) throw new Error("Missing <provider:model[@effort]> argument.");
    const res = removeMatrixModel(manifest, spec, values.group);
    if (res.removedCount === 0) {
      throw new Error(`No entries matching "${spec}" found.`);
    }
    saveModelMatrix(res.manifest, manifestPath);
    console.log(`Removed ${res.removedCount} entry/entries matching "${spec}".`);
    return;
  }

  if (sub === "enable" || sub === "disable") {
    const spec = positionals[0];
    if (!spec) throw new Error(`Missing <provider:model[@effort]> argument.`);
    const enabled = sub === "enable";
    const res = setMatrixModelEnabled(manifest, spec, enabled, values.group);
    if (res.updatedCount === 0) {
      throw new Error(`No entries matching "${spec}" found.`);
    }
    saveModelMatrix(res.manifest, manifestPath);
    console.log(
      `${enabled ? "Enabled" : "Disabled"} ${res.updatedCount} entry/entries matching "${spec}".`,
    );
    return;
  }

  if (sub === "import-ollama") {
    const groupName = values.group ?? "local-ollama";
    const entries = await discoverLocalOllamaModels(values.host);
    const updated = syncGroupEntries(
      manifest,
      groupName,
      entries,
      "Local Ollama chat models (opt-in via --group local-ollama or --discover-local)",
    );
    saveModelMatrix(updated, manifestPath);
    console.log(
      `Imported ${entries.length} local Ollama chat model(s) into "${groupName}" -> ${manifestPath}`,
    );
    for (const e of entries) {
      console.log(`  + ${formatModelSpecString(e)} (${e.tagline ?? ""})`);
    }
    return;
  }

  if (sub === "import-lab") {
    const labDir = positionals[0] ?? "../local-model-labs-m4-max";
    const groupName = values.group ?? "local-lab";
    const entries = loadLabDirModels(labDir);
    const updated = syncGroupEntries(
      manifest,
      groupName,
      entries,
      `Tuned local lab endpoints imported from ${labDir}`,
    );
    saveModelMatrix(updated, manifestPath);
    console.log(
      `Imported ${entries.length} local lab config(s) from ${labDir} into "${groupName}" -> ${manifestPath}`,
    );
    for (const e of entries) {
      console.log(`  + ${formatModelSpecString(e)} @ ${e.baseUrl ?? "default"}`);
    }
    return;
  }

  usage();
  throw new Error(`Unknown subcommand "${sub}".`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
