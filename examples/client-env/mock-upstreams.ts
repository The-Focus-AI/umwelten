/**
 * Mock External Upstreams for the Client Environment Demo:
 *   1. Mock QuickBooks Online REST API (requires an Intuit secret token; supports
 *      A/R aging reads, destructive DELETE endpoint, and an adversarial auth-echo
 *      probe that triggers the perimeter's secret scrubber).
 *   2. Mock OpenAI-compatible Tool Supplier registered into the client-local
 *      Mycel Exchange so multi-turn streaming tool calls flow through Mycel.
 */

import http from "node:http";

export interface MockQuickBooksServer {
  baseUrl: string;
  requests: Array<{ method: string; url: string; auth?: string }>;
  close: () => Promise<void>;
}

export async function startMockQuickBooksApi(
  expectedSecretToken: string,
): Promise<MockQuickBooksServer> {
  const requests: MockQuickBooksServer["requests"] = [];

  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const auth = req.headers.authorization;
    requests.push({ method, url, auth });

    if (auth !== `Bearer ${expectedSecretToken}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          fault: { error: [{ message: "AuthenticationFailed" }] },
        }),
      );
      return;
    }

    if (url.startsWith("/v3/company/acme/echo-auth")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          diagnostic: "upstream-debug-echo",
          receivedAuthorization: auth,
          note: `Token starts with ${expectedSecretToken}`,
        }),
      );
      return;
    }

    if (url.startsWith("/v3/company/acme/reports/AgedReceivables")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          Header: {
            ReportName: "AgedReceivables",
            Currency: "USD",
            DateMacro: "Today",
          },
          Rows: [
            { customer: "Acme Holdings LLC", current: 18500, overdue30: 12400, overdue60: 4200 },
            { customer: "Northwind Co", current: 9200, overdue30: 0, overdue60: 7850 },
          ],
          totals: {
            currentTotal: 27700,
            overdueTotal: 24450,
            grandTotal: 52150,
          },
        }),
      );
      return;
    }

    if (method === "DELETE" && url.startsWith("/v3/company/acme/invoice/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ deleted: true, url }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found in Mock QuickBooks API" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export interface MockToolSupplier {
  baseUrl: string;
  requests: Array<{
    model: string;
    messageCount: number;
    hasToolResult: boolean;
  }>;
  close: () => Promise<void>;
}

interface ChatMessageShape {
  role?: string;
  content?: unknown;
}

function readMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const out: string[] = [];
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        out.push((part as { text: string }).text);
      }
    }
    return out.join("\n");
  }
  return "";
}

/**
 * OpenAI-compatible mock Supplier plugged into Client-Local Mycel.
 *
 * Turn 1 (no `role: "tool"` message yet): invokes `qb_ar_aging`.
 * Turn 2 (`role: "tool"` present): summarizes overdue receivables from tool output.
 */
export async function startMockToolSupplier(): Promise<MockToolSupplier> {
  const requests: MockToolSupplier["requests"] = [];

  const server = http.createServer(async (req, res) => {
    const raw = await new Promise<string>((resolve) => {
      let acc = "";
      req.on("data", (c) => {
        acc += String(c);
      });
      req.on("end", () => resolve(acc));
    });

    let body: {
      model?: string;
      stream?: boolean;
      messages?: ChatMessageShape[];
      tools?: unknown[];
    } = {};
    try {
      body = JSON.parse(raw || "{}") as typeof body;
    } catch {
      body = {};
    }

    const model = String(body.model ?? "gemma-4-26b");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastTool = [...messages].reverse().find((m) => m.role === "tool");
    const hasToolResult = Boolean(lastTool);
    const streaming = body.stream === true;

    requests.push({
      model,
      messageCount: messages.length,
      hasToolResult,
    });

    const toolCallMode =
      !hasToolResult && Array.isArray(body.tools) && body.tools.length > 0;

    if (!toolCallMode) {
      let overdueNote = "Total overdue A/R across accounts retrieved cleanly.";
      if (lastTool) {
        const text = readMessageText(lastTool.content);
        const match = text.match(/"overdueTotal":\s*(\d+)/);
        if (match) {
          overdueNote = `QuickBooks Aged Receivables shows $${Number(match[1]).toLocaleString("en-US")} overdue across Acme Holdings LLC ($16,600) and Northwind Co ($7,850), with $27,700 current ($52,150 total A/R).`;
        }
      }

      if (!streaming) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-ce-2",
            object: "chat.completion",
            created: 1,
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: overdueNote },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 210, completion_tokens: 34, total_tokens: 244 },
          }),
        );
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const words = overdueNote.split(/(\s+)/);
      for (const piece of words) {
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-ce-2",
            object: "chat.completion.chunk",
            created: 1,
            model,
            choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
          })}\n\n`,
        );
      }
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-ce-2",
          object: "chat.completion.chunk",
          created: 1,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 210, completion_tokens: 34, total_tokens: 244 },
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const argsJson = '{"asOf":"2026-11-24"}';
    if (!streaming) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-ce-1",
          object: "chat.completion",
          created: 1,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_qb_1",
                    type: "function",
                    function: { name: "qb_ar_aging", arguments: argsJson },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 140, completion_tokens: 16, total_tokens: 156 },
        }),
      );
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-ce-1",
        object: "chat.completion.chunk",
        created: 1,
        model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_qb_1",
                  type: "function",
                  function: { name: "qb_ar_aging", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-ce-1",
        object: "chat.completion.chunk",
        created: 1,
        model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: argsJson } },
              ],
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({
        id: "chatcmpl-ce-1",
        object: "chat.completion.chunk",
        created: 1,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 140, completion_tokens: 16, total_tokens: 156 },
      })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

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
