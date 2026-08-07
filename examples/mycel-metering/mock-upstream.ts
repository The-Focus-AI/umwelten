/**
 * A mock OpenAI-compatible upstream, for asking whether the exchange can bill
 * what it sold.
 *
 * Live providers are the wrong instrument for this question. The cases that
 * decide whether a ledger is sound are the awkward ones — a client that hangs
 * up mid-stream, an upstream that reports no usage at all — and those are hard
 * to provoke on demand against a real API and impossible to provoke
 * repeatably. So we serve them deliberately.
 *
 * Point `LLAMASWAP_HOST` at this server and the real runner, the real provider,
 * and the real usage-extraction cascade all run unmodified.
 */

import http from "node:http";

export type UpstreamMode =
  /** Well-behaved: streams tokens, reports usage in the final chunk. */
  | "usage-in-final-chunk"
  /** Streams tokens and never reports usage. Real providers do this. */
  | "no-usage"
  /** Streams slowly and forever, so the client has to hang up. */
  | "never-finishes";

export interface MockUpstream {
  baseUrl: string;
  /** Requests received, so a test can assert what actually went upstream. */
  requests: Record<string, unknown>[];
  close: () => Promise<void>;
}

const COMPLETION_WORDS = [
  "The", " quick", " brown", " fox", " jumps", " over", " the", " lazy", " dog",
  " and", " then", " keeps", " going", " for", " quite", " a", " while", " longer",
];

/** Token counts a real upstream would report for the stream below. */
export const MOCK_PROMPT_TOKENS = 137;
export const MOCK_COMPLETION_TOKENS = COMPLETION_WORDS.length;

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function deltaChunk(model: string, content: string) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

export async function startMockUpstream(mode: UpstreamMode): Promise<MockUpstream> {
  const requests: Record<string, unknown>[] = [];

  const server = http.createServer(async (req, res) => {
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      return;
    }

    const body = await new Promise<string>((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(raw));
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      /* leave empty */
    }
    requests.push(parsed);
    const model = String(parsed.model ?? "mock-model");

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    let aborted = false;
    req.on("close", () => {
      aborted = true;
    });

    for (const word of COMPLETION_WORDS) {
      if (aborted) return;
      res.write(sseChunk(deltaChunk(model, word)));
      await new Promise((r) => setTimeout(r, 40));
    }

    if (mode === "never-finishes") {
      // Keep dribbling so the caller must abort. This is the billing case that
      // matters: real tokens were produced and the stream has no final chunk.
      while (!aborted) {
        res.write(sseChunk(deltaChunk(model, " more")));
        await new Promise((r) => setTimeout(r, 40));
      }
      return;
    }

    res.write(
      sseChunk({
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        created: 1,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        ...(mode === "usage-in-final-chunk"
          ? {
              usage: {
                prompt_tokens: MOCK_PROMPT_TOKENS,
                completion_tokens: MOCK_COMPLETION_TOKENS,
                total_tokens: MOCK_PROMPT_TOKENS + MOCK_COMPLETION_TOKENS,
              },
            }
          : {}),
      }),
    );
    res.write("data: [DONE]\n\n");
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
