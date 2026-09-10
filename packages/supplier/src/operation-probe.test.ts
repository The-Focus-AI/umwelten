import { describe, expect, it } from "vitest";
import { probeOperationCapabilities } from "./operation-probe.js";

describe("operation capability probes", () => {
  it("advertises only contracts the runtime actually satisfies", async () => {
    const paths: string[] = [];
    const results = await probeOperationCapabilities({
      runtimeUrl: "http://runtime/v1",
      model: "multi",
      fetchImpl: async (input) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        if (path.endsWith("/embeddings")) {
          return Response.json({ data: [{ embedding: [1, 2] }] });
        }
        if (path.endsWith("/audio/transcriptions")) {
          return Response.json({ error: "not supported" }, { status: 404 });
        }
        return Response.json({ choices: [{ message: { content: "red" } }] });
      },
    });

    expect(results.map(({ name, supported }) => ({ name, supported }))).toEqual([
      { name: "image-input", supported: true },
      { name: "embeddings", supported: true },
      { name: "transcription", supported: false },
    ]);
    expect(paths).not.toContain("/v1/images/generations");
    expect(paths).not.toContain("/v1/videos/generations");
  });

  it("never probes billable generation without explicit permission", async () => {
    const paths: string[] = [];
    await probeOperationCapabilities({
      runtimeUrl: "http://runtime/v1",
      model: "multi",
      generativeMedia: true,
      fetchImpl: async (input) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        if (path.endsWith("/embeddings")) return Response.json({ data: [{ embedding: [] }] });
        if (path.endsWith("/audio/transcriptions")) {
          return Response.json({ text: "", usage: { seconds: 0.25 } });
        }
        if (path.endsWith("/chat/completions")) {
          return Response.json({ choices: [{ message: { content: "red" } }] });
        }
        return Response.json({ data: [{ b64_json: "eA==" }] });
      },
    });
    expect(paths.filter((path) => path.endsWith("/videos/generations"))).toHaveLength(2);
    expect(paths).toContain("/v1/images/generations");
  });
});
