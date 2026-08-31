import type { GaiaPublishedPreview } from "../tools/gaia/types.js";

export interface PreviewPublisherOptions {
  gaiaUrl: string;
  habitatId: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

/** Publish the supervisor's complete set; Gaia treats each report as authoritative. */
export function createPreviewPublisher(options: PreviewPublisherOptions) {
  const fetch = options.fetch ?? globalThis.fetch;
  return async (previews: GaiaPublishedPreview[]): Promise<void> => {
    const response = await fetch(
      `${options.gaiaUrl.replace(/\/$/, "")}/internal/previews/${encodeURIComponent(options.habitatId)}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ previews }),
      },
    );
    if (!response.ok) {
      throw new Error(`Gaia rejected preview publication (${response.status})`);
    }
  };
}
