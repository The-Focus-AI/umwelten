/**
 * The Q11 output.
 *
 * Prints every probed offer grouped so the same weights sit together across
 * runtimes, then calls out rows that disagree. The full matrix prints
 * unconditionally — the name-pairing heuristic in `pairing.ts` will sometimes
 * miss, and a missed pair should cost a squint, not the finding.
 */

import { groupByFamily } from "./pairing.js";
import type { CapabilityName, ProbedOffer } from "./types.js";

const CAPS: CapabilityName[] = [
  "chat",
  "streaming",
  "tool-calling",
  "structured-output",
  "reasoning",
];

const RUNTIME_W = 11;
const MODEL_W = 46;
const CAP_W = 7;

export interface MatrixReport {
  lines: string[];
  /** Pairing keys where two runtimes serving the same weights disagreed. */
  disagreements: string[];
}

export function buildCapabilityMatrix(results: ProbedOffer[]): MatrixReport {
  const groups = groupByFamily(results);
  const lines: string[] = [];
  const disagreements: string[] = [];

  const header =
    "runtime".padEnd(RUNTIME_W) +
    "model".padEnd(MODEL_W) +
    CAPS.map((c) => c.slice(0, CAP_W - 1).padEnd(CAP_W)).join("");
  lines.push(header);

  for (const [, rows] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push("-".repeat(header.length));

    // Sort by pairing key first so the same weights land on adjacent lines —
    // the comparison is the whole point of the table.
    const ordered = [...rows].sort(
      (a, b) =>
        a.identity.key.localeCompare(b.identity.key) || a.provider.localeCompare(b.provider),
    );

    for (const row of ordered) {
      const cells = CAPS.map((cap) => {
        const probe = row.capabilities.find((c) => c.name === cap);
        if (row.failed) return "?".padEnd(CAP_W);
        return (probe?.supported ? "yes" : "·").padEnd(CAP_W);
      }).join("");
      lines.push(
        row.provider.padEnd(RUNTIME_W) + row.model.slice(0, MODEL_W - 1).padEnd(MODEL_W) + cells,
      );
    }

    // Strict comparison: same family *and* same size means same weights. Rows
    // with no size token (Ollama's ":latest") can't be compared this way, and
    // are left for the reader.
    const byKey = new Map<string, typeof rows>();
    for (const row of rows) {
      if (row.failed) continue;
      byKey.set(row.identity.key, [...(byKey.get(row.identity.key) ?? []), row]);
    }
    for (const [key, sameWeights] of byKey) {
      if (sameWeights.length < 2) continue;
      const signatures = new Set(
        sameWeights.map((r) =>
          r.capabilities
            .filter((c) => c.supported)
            .map((c) => c.name)
            .sort()
            .join(","),
        ),
      );
      if (signatures.size > 1) disagreements.push(key);
    }
  }

  return { lines, disagreements };
}

export function printCapabilityMatrix(results: ProbedOffer[]): void {
  const { lines, disagreements } = buildCapabilityMatrix(results);

  console.log("\nCapabilities by family (· = unsupported, ? = probe failed):\n");
  for (const line of lines) console.log(`  ${line}`);

  if (disagreements.length) {
    console.log(
      `\n⚠  Same weights, different capabilities: ${disagreements.join(", ")}\n` +
        `   Adapt-mode cannot guarantee what it resells — serve-mode is required.`,
    );
  } else {
    console.log(
      `\n✓  No capability disagreements among paired models.\n` +
        `   Adapt-mode is safe for the models probed here.`,
    );
  }
}
