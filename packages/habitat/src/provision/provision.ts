/**
 * CLI: decide what provisioning this habitat needs, then do it
 * (umwelten #269, #276).
 *
 * `entrypoint.sh` invokes this once, replacing the provisioning it used to
 * inline. The shell keeps what only the shell can do — resolving the GitHub
 * token and exporting the `insteadOf` git config — and this process inherits
 * that environment, so authenticated clones work exactly as before.
 *
 *   pnpm exec tsx packages/habitat/src/provision/provision.ts [--refresh] [--dry-run]
 *
 * Default intent is `start`: on a warm volume that is deliberately no work at
 * all, which is what keeps wake latency flat as Mounted repos are added.
 * `--refresh` is the explicit "bring it up to date" operation Gaia invokes
 * over `docker exec`. A volume carrying the stale mark Gaia left while the
 * habitat was Dormant promotes its own start to a refresh and clears the mark.
 *
 * `--dry-run` prints the plan and exits without touching the volume; it is
 * the "reports what it intends to do" half of #269, useful for debugging a
 * boot without paying for it.
 *
 * Exits non-zero when a step whose failure policy is `abort` fails — the
 * `set -e` semantics the shell had for the Owned repo clone and its mise
 * install.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { executeProvisionPlan, nodeExecutorDeps } from "./execute.js";
import { describePlan, planProvision } from "./plan.js";
import { readVolumeState } from "./volume-state.js";

const workDir = process.env.HABITAT_WORK_DIR || "/data";
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--plan-only");
const intent = process.argv.includes("--refresh") ? "refresh" : "start";

/** Secret lookup, mirroring the entrypoint's `secret_value`: vault, then env. */
async function loadSecrets(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(workDir, "secrets.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)]),
    );
  } catch {
    return {};
  }
}

const config = await loadConfig(join(workDir, "config.json"));
const volume = await readVolumeState({ workDir, config });
const plan = planProvision({ workDir, config, volume, intent });

for (const line of describePlan(plan)) console.log(line);

if (!dryRun && plan.steps.length > 0) {
  const vault = await loadSecrets();
  const result = await executeProvisionPlan(
    plan,
    nodeExecutorDeps((name) => vault[name] ?? process.env[name]),
  );
  if (result.aborted) {
    console.error(`[entrypoint] Provisioning aborted at ${result.aborted.kind}.`);
    process.exit(1);
  }
}
