import { describe, expect, it } from "vitest";
import type { PreviewSupervisor } from "../preview/supervisor.js";
import { createPreviewTools } from "./preview-tools.js";

describe("preview_status", () => {
  it("only authorizes link handover for a serving preview", async () => {
    const supervisor = {
      status: () => ({
        worktreeId: "primary" as const,
        branch: "main",
        snapshot: {
          status: "serving" as const,
          addresses: ["https://preview.example"],
        },
        logs: "ready",
      }),
    } as PreviewSupervisor;
    const previewStatus = createPreviewTools(supervisor).preview_status as {
      execute: (input: object) => Promise<unknown>;
    };

    await expect(previewStatus.execute({})).resolves.toEqual({
      worktreeId: "primary",
      branch: "main",
      snapshot: {
        status: "serving",
        addresses: ["https://preview.example"],
      },
      logs: "ready",
      handover: {
        kind: "announce",
        addresses: ["https://preview.example"],
      },
    });
  });
});
