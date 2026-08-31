import { tool, type Tool } from "ai";
import { z } from "zod";
import type { PreviewSupervisor } from "../preview/supervisor.js";
import { decidePreviewHandover } from "../preview/supervisor-state.js";

export function createPreviewTools(
  supervisor: PreviewSupervisor,
): Record<string, Tool> {
  return {
    preview_status: tool({
      description:
        "Inspect the project dev server. Only hand preview links to the user when handover.kind is 'announce'; otherwise diagnose or keep fixing it.",
      inputSchema: z.object({}),
      execute: async () => {
        const status = supervisor.status();
        return {
          ...status,
          handover: decidePreviewHandover(status.snapshot),
        };
      },
    }),
  };
}
