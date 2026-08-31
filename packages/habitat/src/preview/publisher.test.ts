import { describe, expect, it, vi } from "vitest";
import { createPreviewPublisher } from "./publisher.js";

describe("createPreviewPublisher", () => {
  it("replaces Gaia's cached set using only the Habitat credential", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const publish = createPreviewPublisher({
      gaiaUrl: "http://gaia:7420/",
      habitatId: "demo",
      apiKey: "child-only",
      fetch,
    });
    const previews = [
      {
        worktreeId: "primary",
        branch: "main",
        port: 4173,
        ordinal: 1,
        status: "serving" as const,
      },
    ];

    await publish(previews);

    expect(fetch).toHaveBeenCalledWith(
      "http://gaia:7420/internal/previews/demo",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ authorization: "Bearer child-only" }),
        body: JSON.stringify({ previews }),
      }),
    );
  });

  it("surfaces a rejected publication for diagnostics", async () => {
    const publish = createPreviewPublisher({
      gaiaUrl: "http://gaia:7420",
      habitatId: "demo",
      apiKey: "bad",
      fetch: async () => new Response(null, { status: 401 }),
    });
    await expect(publish([])).rejects.toThrow("Gaia rejected preview publication (401)");
  });
});
