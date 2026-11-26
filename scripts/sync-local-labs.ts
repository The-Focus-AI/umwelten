#!/usr/bin/env node
/**
 * Syncs live hardware benchmark snapshots and the reusable local-model-lab
 * workbench protocol from the three The-Focus-AI GitHub repositories:
 *   - The-Focus-AI/local-model-lab        (generic template / 5-stage suite)
 *   - The-Focus-AI/local-model-labs-m4-max (Apple M4 Max 64 GB)
 *   - The-Focus-AI/local-model-labs-thor   (NVIDIA Jetson AGX Thor 122.8 GB)
 *
 * Writes `reports/data/local-model-labs.json` so public CI builds of
 * `umwelten.thefocus.ai` never require private-repo access at build time.
 *
 * Usage:
 *   pnpm run site:sync-local-labs
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface LocalLabRecipeRow {
  slug: string;
  planPath: string;
  planUrl: string;
  engine: string;
  status: string;
  decodePrimary: number | null;
  decodeDisplay: string;
  prefill4k: number | null;
  prefill32k: number | null;
  prefillDisplay: string;
  longRetrieval: string;
  peakRamGib: number | null;
  peakRamDisplay: string;
  recipeSummary: string;
}

export interface LocalLabMachineSnapshot {
  id: "m4-max" | "thor";
  label: string;
  repo: string;
  url: string;
  isPrivate: boolean;
  pushedAt: string;
  description: string;
  specs: {
    gpu: string;
    cpu: string;
    ram: string;
    os: string;
    note?: string;
  };
  recipes: LocalLabRecipeRow[];
  footnotes: string[];
  keyFindings: string[];
}

export interface LocalLabTemplateMeta {
  repo: string;
  url: string;
  isPrivate: boolean;
  pushedAt: string;
  description: string;
  stages: string[];
  startCommands: string;
  upstreamProjects: Array<{ name: string; url: string; purpose: string }>;
}

export interface LocalModelLabsArtifact {
  syncedAt: string;
  template: LocalLabTemplateMeta;
  machines: LocalLabMachineSnapshot[];
}

interface RepoApiResponse {
  full_name: string;
  html_url: string;
  description: string | null;
  pushed_at: string;
  default_branch: string;
  private: boolean;
}

function ghJson<T>(endpoint: string): T {
  const out = execFileSync("gh", ["api", endpoint], { encoding: "utf8" });
  return JSON.parse(out) as T;
}

function fetchRepoAndReadme(ownerRepo: string): {
  meta: RepoApiResponse;
  readme: string;
} {
  const meta = ghJson<RepoApiResponse>(`repos/${ownerRepo}`);
  const readmeObj = ghJson<{ content: string; encoding: string }>(
    `repos/${ownerRepo}/readme`,
  );
  const readme = Buffer.from(readmeObj.content, "base64").toString("utf8");
  return { meta, readme };
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function extractSection(md: string, headingPrefix: string): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith(headingPrefix));
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("## ")) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

function parseMachineSpecs(md: string): LocalLabMachineSnapshot["specs"] {
  const match = md.match(/<!--\s*machine:start\s*-->([\s\S]*?)<!--\s*machine:end\s*-->/);
  const block = match ? match[1] : "";
  let gpu = "";
  let cpu = "";
  let ram = "";
  let os = "";
  const notes: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("## ") || line.startsWith("Detected by")) continue;
    if (line.startsWith("- **GPU:**")) {
      gpu = line.replace(/^-\s+\*\*GPU:\*\*\s*/, "").trim();
    } else if (line.startsWith("- **CPU:**")) {
      cpu = line.replace(/^-\s+\*\*CPU:\*\*\s*/, "").trim();
    } else if (line.startsWith("- **RAM:**")) {
      ram = line.replace(/^-\s+\*\*RAM:\*\*\s*/, "").trim();
    } else if (line.startsWith("- **OS:**")) {
      os = line.replace(/^-\s+\*\*OS:\*\*\s*/, "").trim();
    } else {
      notes.push(line);
    }
  }

  return {
    gpu,
    cpu,
    ram,
    os,
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

function cleanMarkdownText(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\\([*~`])/g, "$1")
    .trim();
}

function parseRecipeSummaries(md: string): Map<string, string> {
  const section = extractSection(md, "## What's in each recipe");
  const summaries = new Map<string, string>();
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || /^\|[\s:-]+\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 4 || cells[0].toLowerCase() === "recipe") continue;
    const slugMatch = cells[0].match(/\[`?([^`\]]+)`?\]/);
    if (!slugMatch) continue;
    summaries.set(slugMatch[1].trim(), cleanMarkdownText(cells[3]));
  }
  return summaries;
}

function parseMachineSnapshot(
  id: "m4-max" | "thor",
  label: string,
  ownerRepo: string,
): LocalLabMachineSnapshot {
  const { meta, readme } = fetchRepoAndReadme(ownerRepo);
  const specs = parseMachineSpecs(readme);
  const summaries = parseRecipeSummaries(readme);

  const currentSection = extractSection(readme, "## Current results");
  const lines = currentSection.split(/\r?\n/);
  const recipes: LocalLabRecipeRow[] = [];
  const footnotes: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("|")) {
      if (/^\|[\s:-]+\|/.test(line)) continue;
      const cells = splitRow(line);
      if (cells.length < 7 || cells[0].toLowerCase() === "model") continue;
      const linkMatch = cells[0].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const slug = (linkMatch ? linkMatch[1] : cells[0]).replace(/`/g, "").trim();
      const planPath = linkMatch ? linkMatch[2].trim() : `models/${slug}/PLAN.md`;
      const engine = cells[1].trim();
      const status = cells[2].trim();
      const decodeRaw = cells[3].trim();
      const boldNumMatch = decodeRaw.match(/\*\*([\d.]+)\*\*/);
      const firstNumMatch = decodeRaw.match(/([\d.]+)/);
      const decodePrimary = boldNumMatch
        ? Number(boldNumMatch[1])
        : firstNumMatch
          ? Number(firstNumMatch[1])
          : null;
      const decodeDisplay = decodeRaw.replace(/\*\*/g, "").trim();

      const prefillRaw = cells[4].trim();
      const prefillMatch = prefillRaw.match(/(\d+)\s*\/\s*(\d+)/);
      const prefill4k = prefillMatch ? Number(prefillMatch[1]) : null;
      const prefill32k = prefillMatch ? Number(prefillMatch[2]) : null;

      const longRetrieval = cells[5].replace(/`/g, "").trim();
      const peakRamDisplay = cells[6].trim();
      const ramMatch = peakRamDisplay.match(/([\d.]+)/);
      const peakRamGib = ramMatch ? Number(ramMatch[1]) : null;

      recipes.push({
        slug,
        planPath,
        planUrl: `${meta.html_url}/blob/${meta.default_branch}/${planPath}`,
        engine: cleanMarkdownText(engine),
        status,
        decodePrimary,
        decodeDisplay,
        prefill4k,
        prefill32k,
        prefillDisplay: prefillRaw,
        longRetrieval,
        peakRamGib,
        peakRamDisplay,
        recipeSummary: summaries.get(slug) ?? "",
      });
    } else if (/^(\\\*|[*†-])\s+/.test(line)) {
      footnotes.push(cleanMarkdownText(line.replace(/^-\s+/, "")));
    }
  }

  const findingsSection = extractSection(readme, "## Key findings");
  const keyFindings = findingsSection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s+/.test(l))
    .map((l) => cleanMarkdownText(l.replace(/^\d+\.\s+/, "")));

  return {
    id,
    label,
    repo: meta.full_name,
    url: meta.html_url,
    isPrivate: meta.private,
    pushedAt: meta.pushed_at,
    description: meta.description ?? "",
    specs,
    recipes,
    footnotes,
    keyFindings,
  };
}

function parseTemplateRepo(ownerRepo: string): LocalLabTemplateMeta {
  const { meta, readme } = fetchRepoAndReadme(ownerRepo);
  const stagesSection = extractSection(readme, "## How the tests work");
  const stages = stagesSection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s+/.test(l))
    .map((l) => cleanMarkdownText(l.replace(/^\d+\.\s+/, "")));

  const startSection = extractSection(readme, "## Start");
  const fenceMatch = startSection.match(/```bash\n([\s\S]*?)```/);
  const startCommands = fenceMatch ? fenceMatch[1].trim() : "";

  const upstreamSection = extractSection(readme, "## Upstream projects");
  const upstreamProjects: Array<{ name: string; url: string; purpose: string }> = [];
  for (const rawLine of upstreamSection.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || /^\|[\s:-]+\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 2 || cells[0].toLowerCase() === "project") continue;
    const m = cells[0].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!m) continue;
    upstreamProjects.push({
      name: m[1].trim(),
      url: m[2].trim(),
      purpose: cleanMarkdownText(cells[1]),
    });
  }

  return {
    repo: meta.full_name,
    url: meta.html_url,
    isPrivate: meta.private,
    pushedAt: meta.pushed_at,
    description: meta.description ?? "",
    stages,
    startCommands,
    upstreamProjects,
  };
}

function main(): void {
  const template = parseTemplateRepo("The-Focus-AI/local-model-lab");
  const m4Max = parseMachineSnapshot(
    "m4-max",
    "Apple M4 Max (64 GB Unified)",
    "The-Focus-AI/local-model-labs-m4-max",
  );
  const thor = parseMachineSnapshot(
    "thor",
    "NVIDIA Jetson AGX Thor (122.8 GB Unified)",
    "The-Focus-AI/local-model-labs-thor",
  );

  const artifact: LocalModelLabsArtifact = {
    syncedAt: new Date().toISOString(),
    template,
    machines: [m4Max, thor],
  };

  const outPath = path.join(process.cwd(), "reports", "data", "local-model-labs.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(
    `Synced ${m4Max.recipes.length} M4 Max recipes + ${thor.recipes.length} Jetson AGX Thor recipes + template (${template.stages.length} stages) -> ${outPath}`,
  );
}

main();
