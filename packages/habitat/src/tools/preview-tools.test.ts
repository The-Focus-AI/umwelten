import { describe, expect, it } from "vitest";
import { createPreviewTools } from "./preview-tools.js";

describe("preview_status", () => {
  it("only authorizes link handover for a serving preview", async () => {
    const previews = {
      statuses: async () => [
        {
          worktreeId: "primary" as const,
          branch: "main",
          snapshot: {
            status: "serving" as const,
            addresses: ["https://preview.example"],
          },
          logs: "ready",
        },
      ],
      ensure: async () => {
        throw new Error("not used");
      },
    };
    const previewStatus = createPreviewTools(previews).preview_status as {
      execute: (input: object) => Promise<unknown>;
    };

    await expect(previewStatus.execute({})).resolves.toEqual([
      {
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
      },
    ]);
  });
});
