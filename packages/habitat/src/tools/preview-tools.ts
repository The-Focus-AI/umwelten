import { tool, type Tool } from "ai";
import { z } from "zod";
import type { PreviewStatus } from "../preview/supervisor.js";
import { decidePreviewHandover } from "../preview/supervisor-state.js";

export interface PreviewToolsContext {
  statuses(): Promise<PreviewStatus[]>;
  ensure(branch: string): Promise<PreviewStatus>;
}

export function createPreviewTools(
  previews: PreviewToolsContext,
): Record<string, Tool> {
  return {
    preview_status: tool({
      description:
        "Inspect the project dev server. Only hand preview links to the user when handover.kind is 'announce'; otherwise diagnose or keep fixing it.",
      inputSchema: z.object({}),
      execute: async () => {
        const statuses = await previews.statuses();
        return statuses.map((status) => ({
          ...status,
          handover: decidePreviewHandover(status.snapshot),
        }));
      },
    }),
    preview_branch: tool({
      description:
        "Create or restart an independent preview for a valid Git branch. Returns its current state; announce links only when handover.kind is 'announce'.",
      inputSchema: z.object({
        branch: z.string().min(1).describe("Existing Git branch to preview"),
      }),
      execute: async ({ branch }) => {
        const status = await previews.ensure(branch);
        return {
          ...status,
          handover: decidePreviewHandover(status.snapshot),
        };
      },
    }),
  };
}
