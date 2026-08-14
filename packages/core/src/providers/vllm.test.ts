/**
 * The vLLM provider.
 *
 * `fetch` is stubbed, so these need no GPU and no server. What they pin down is
 * the one thing that makes vLLM different from every other local runtime: it
 * can require a key, and a refused key must never look like an absent server.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { VllmProvider, VllmAuthError } from "./vllm.js";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
  vi.unstubAllEnvs();
});

/** Answer one /models call however the test wants. */
function serve(status: number, body: unknown = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

const catalogue = {
  data: [
    { id: "nvidia/Qwen3.6-35B-A3B-NVFP4", max_model_len: 131072, owned_by: "vllm" },
    { id: "meta/Llama-4-8B", max_model_len: 8192, owned_by: "vllm" },
  ],
};

describe("the vLLM provider", () => {
  it("lists what the server says it is serving", async () => {
    serve(200, catalogue);
    const models = await new VllmProvider().listModels();

    expect(models.map((m) => m.name)).toEqual([
      "nvidia/Qwen3.6-35B-A3B-NVFP4",
      "meta/Llama-4-8B",
    ]);
  });

  it("takes the context the server was actually started with", async () => {
    // `max_model_len` reflects this server's flags, not the weights'
    // theoretical maximum — which is the number an Offer should commit to.
    serve(200, catalogue);
    const [first] = await new VllmProvider().listModels();

    expect(first.contextLength).toBe(131072);
  });

  it("costs nothing per token, because the operator owns the box", async () => {
    serve(200, catalogue);
    const [first] = await new VllmProvider().listModels();

    expect(first.costs).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("presents the key when it has one", async () => {
    const calls = serve(200, catalogue);
    await new VllmProvider(undefined, { apiKey: "sk-vllm-secret" }).listModels();

    expect(calls[0].headers.authorization).toBe("Bearer sk-vllm-secret");
  });

  it("sends no authorization header when there is no key", async () => {
    // A box on a private network legitimately runs without one, and sending an
    // empty bearer would be refused by a server that accepts anonymous calls.
    const calls = serve(200, catalogue);
    await new VllmProvider().listModels();

    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it("reads VLLM_API_KEY when nothing was passed", async () => {
    vi.stubEnv("VLLM_API_KEY", "sk-from-env");
    const calls = serve(200, catalogue);
    await new VllmProvider().listModels();

    expect(calls[0].headers.authorization).toBe("Bearer sk-from-env");
  });

  it("defaults to vLLM's own port, not umwelten's block", async () => {
    // 8000 is vLLM's default. This is somebody else's server we are pointing
    // at, so the 74xx convention does not apply.
    const calls = serve(200, catalogue);
    await new VllmProvider().listModels();

    expect(calls[0].url).toBe("http://localhost:8000/v1/models");
  });

  it("does not double the slash when the base URL has a trailing one", async () => {
    const calls = serve(200, catalogue);
    await new VllmProvider("http://thor:8000/v1/").listModels();

    expect(calls[0].url).toBe("http://thor:8000/v1/models");
  });

  describe("a refused key is not an absent server", () => {
    it("throws an auth error the caller can recognise, on 401", async () => {
      // The load-bearing one. Discovery treats unreachable as "not running,
      // carry on" — so a box with a typo'd key would silently vanish from the
      // catalogue while running perfectly.
      serve(401);
      await expect(
        new VllmProvider(undefined, { apiKey: "wrong" }).listModels(),
      ).rejects.toBeInstanceOf(VllmAuthError);
    });

    it("does the same on 403", async () => {
      serve(403);
      await expect(new VllmProvider().listModels()).rejects.toBeInstanceOf(VllmAuthError);
    });

    it("says which problem it is — a wrong key, or none at all", async () => {
      serve(401);
      await expect(
        new VllmProvider(undefined, { apiKey: "wrong" }).listModels(),
      ).rejects.toThrow(/rejected the API key/);

      serve(401);
      await expect(new VllmProvider().listModels()).rejects.toThrow(/requires an API key/);
    });

    it("treats a connection failure as unreachable rather than as auth", async () => {
      globalThis.fetch = (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;

      const failure = new VllmProvider().listModels();
      await expect(failure).rejects.toThrow(/not reachable/);
      await expect(failure).rejects.not.toBeInstanceOf(VllmAuthError);
    });
  });

  it("returns nothing for a server with an empty catalogue", async () => {
    serve(200, { data: [] });
    expect(await new VllmProvider().listModels()).toEqual([]);
  });
});
