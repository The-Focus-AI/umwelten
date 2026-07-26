/**
 * Refresh as an operation separate from starting (umwelten #276).
 *
 * Starting a habitat now does the minimum needed to serve requests — a warm
 * volume already holds the clones, the dependencies and the skills — so
 * bringing a checkout up to date has to be asked for. This is the ask.
 *
 * Two paths, and which one runs is decided by Docker, not by the caller:
 *
 *  - **Awake** → invoke the habitat's own provisioner with `--refresh` over
 *    `docker exec`. The decision about what actually needs updating stays
 *    inside the habitat, where the volume is; Gaia only says "now".
 *  - **Dormant** → leave a stale mark on the volume and return. Waking a
 *    habitat in order to refresh it would defeat the point of it sleeping,
 *    and per ADR 0008 Gaia is the lifecycle owner, not something that starts
 *    containers as a side effect of an unrelated request.
 *
 * The mark lives on the volume, not on the registry entry, so the habitat is
 * the thing that clears it — after the refresh has actually run, rather than
 * when Gaia decided to ask for one.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import { STALE_MARKER_FILE } from "../../../provision/stale.js";
import type { GaiaToolsContext } from "./context.js";
import type { ContainerStatus } from "../types.js";

/** What the habitat runs when Gaia asks it to refresh. */
export const REFRESH_COMMAND =
  "cd /habitat && pnpm exec tsx packages/habitat/src/provision/provision.ts --refresh";

export type RefreshAction = "refreshed" | "marked-stale" | "not-found";

export interface RefreshOutcome {
  id: string;
  action: RefreshAction;
  detail: string;
}

/** The subset of the Gaia context a refresh needs — the seam the tests inject. */
export interface RefreshContext {
  registry: Pick<GaiaToolsContext["registry"], "get">;
  docker: Pick<GaiaToolsContext["docker"], "getStatus" | "execInContainer" | "writeVolumeFile">;
  /** Injected for deterministic mark timestamps. */
  now?: () => Date;
}

async function markStale(
  ctx: RefreshContext,
  id: string,
  reason: string,
): Promise<RefreshOutcome> {
  const at = (ctx.now?.() ?? new Date()).toISOString();
  await ctx.docker.writeVolumeFile(id, STALE_MARKER_FILE, `${at}\n`);
  return {
    id,
    action: "marked-stale",
    detail: `${reason} Marked stale at ${at}; it will refresh on its next wake.`,
  };
}

export async function refreshHabitat(
  ctx: RefreshContext,
  id: string,
): Promise<RefreshOutcome> {
  if (!ctx.registry.get(id)) {
    return { id, action: "not-found", detail: `Habitat "${id}" not found` };
  }

  const status: ContainerStatus = await ctx.docker.getStatus(id);
  if (status !== "running") {
    return markStale(ctx, id, `Habitat "${id}" is dormant (${status}).`);
  }

  const result = await ctx.docker.execInContainer(id, REFRESH_COMMAND);
  if (!result.ok) {
    // A refresh that could not run is not a refresh. Leaving the mark means
    // the next wake retries it rather than the request being lost.
    return markStale(
      ctx,
      id,
      `Refresh failed on running habitat "${id}": ${result.output}`,
    );
  }
  return {
    id,
    action: "refreshed",
    detail: result.output || `Refreshed habitat "${id}".`,
  };
}

export function createRefreshTools(ctx: GaiaToolsContext): Record<string, Tool> {
  return {
    refresh_habitat: tool({
      description:
        "Bring a habitat's checkout up to date: pull its Owned repo and every Mounted repo, reinstall dependencies, re-restore skills. Starting a habitat deliberately does none of this, so use this after a push. A running habitat refreshes immediately; a dormant one is marked stale and refreshes on its next wake rather than being woken. Safe to call repeatedly — with no upstream change it is a no-op.",
      inputSchema: z.object({
        id: z.string().describe("Habitat ID to refresh"),
      }),
      execute: async ({ id }) => {
        const outcome = await refreshHabitat(ctx, id);
        return outcome.detail;
      },
    }),
  };
}
