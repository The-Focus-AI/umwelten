/**
 * A mock OpenAI-compatible Supplier, for driving the buyer surface without a
 * network or a GPU.
 *
 * Live providers are the wrong instrument for the cases that decide whether
 * the Exchange behaves: an upstream that errors on demand, one that never
 * finishes so the caller has to hang up, one that reports no usage at all.
 * None of those can be provoked repeatably against a real API, so we serve
 * them deliberately.
 */

import http from "node:http";

export type UpstreamMode =
  /** Streams tokens, then usage in the final chunk. The happy path. */
  | "ok"
  /** Streams tokens and never reports usage. Real providers do this. */
  | "no-usage"
  /** Streams slowly and forever, so the caller must abort. */
  | "never-finishes"
  /** Refuses with a 500 and an error body. */
  | "error";

export interface MockUpstream {
  baseUrl: string;
  /** Requests received, so a test can assert what actually went upstream. */
  requests: { path: string; auth?: string; body: Record<string, unknown> }[];
  /** Resolves once a request has been aborted by the caller. */
  sawAbort: () => boolean;
  close: () => Promise<void>;
}

const WORDS = ["The", " quick", " brown", " fox", " jumps", " over", " the", " lazy", " dog"];

export const MOCK_PROMPT_TOKENS = 137;
export const MOCK_COMPLETION_TOKENS = WORDS.length;

function chunk(model: string, content: string) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

export async function startMockUpstream(mode: UpstreamMode = "ok"): Promise<MockUpstream> {
  const requests: MockUpstream["requests"] = [];
  let aborted = false;

  const server = http.createServer(async (req, res) => {
    const raw = await new Promise<string>((resolve) => {
      let acc = "";
      req.on("data", (c) => (acc += c));
      req.on("end", () => resolve(acc));
    });

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      /* leave empty */
    }
    requests.push({ path: req.url ?? "", auth: req.headers.authorization, body });

    if (mode === "error") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream exploded", type: "server_error" } }));
      return;
    }

    const model = String(body.model ?? "mock-model");
    const streaming = body.stream === true;

    if (!streaming) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          created: 1,
          model,
          choices: [
            { index: 0, message: { role: "assistant", content: WORDS.join("") }, finish_reason: "stop" },
          ],
          ...(mode === "no-usage"
            ? {}
            : {
                usage: {
                  prompt_tokens: MOCK_PROMPT_TOKENS,
                  completion_tokens: MOCK_COMPLETION_TOKENS,
                  total_tokens: MOCK_PROMPT_TOKENS + MOCK_COMPLETION_TOKENS,
                },
              }),
        }),
      );
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // Detect a disconnect on both streams. A server notices a caller leaving
    // when the socket dies, which surfaces on `res` — `req` may already have
    // completed normally and stay quiet.
    let closed = false;
    const disconnected = () => {
      closed = true;
      if (mode === "never-finishes") aborted = true;
    };
    req.on("close", disconnected);
    res.on("close", disconnected);
    res.on("error", disconnected);

    for (const word of WORDS) {
      if (closed) return;
      res.write(`data: ${JSON.stringify(chunk(model, word))}\n\n`);
      await new Promise((r) => setTimeout(r, 15));
    }

    if (mode === "never-finishes") {
      while (!closed) {
        res.write(`data: ${JSON.stringify(chunk(model, " more"))}\n\n`);
        await new Promise((r) => setTimeout(r, 15));
      }
      return;
    }

    res.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        created: 1,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        ...(mode === "no-usage"
          ? {}
          : {
              usage: {
                prompt_tokens: MOCK_PROMPT_TOKENS,
                completion_tokens: MOCK_COMPLETION_TOKENS,
                total_tokens: MOCK_PROMPT_TOKENS + MOCK_COMPLETION_TOKENS,
              },
            }),
      })}\n\n`,
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
    sawAbort: () => aborted,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
