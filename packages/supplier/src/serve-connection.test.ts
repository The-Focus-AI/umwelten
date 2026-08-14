/**
 * The machine end of serving over a Connection.
 *
 * `fetch` is faked, so these run without a GPU or a runtime. What matters is
 * that the machine streams rather than accumulates, and that it actually stops
 * when told — a cancel it ignores is GPU time spent on tokens nobody receives
 * and nobody pays for.
 */

import { describe, it, expect } from "vitest";
import { createConnectionServer } from "./serve-connection.js";

/** A runtime whose response body the test feeds by hand. */
function fakeRuntime() {
  let push: (chunk: string) => void = () => {};
  let finish: () => void = () => {};
  let seen: { url: string; init: RequestInit } | undefined;
  let aborted = false;

  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    init.signal?.addEventListener("abort", () => {
      aborted = true;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(new TextEncoder().encode(chunk));
        finish = () => controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    push: (chunk: string) => push(chunk),
    finish: () => finish(),
    get request() {
      return seen;
    },
    get aborted() {
      return aborted;
    },
  };
}

function harness(fetchImpl: typeof fetch) {
  const sent: Record<string, unknown>[] = [];
  const server = createConnectionServer({
    runtimeUrl: "http://localhost:4000/v1",
    runtimeCredential: "vllm-key",
    fetchImpl,
    send: (frame) => sent.push(JSON.parse(frame) as Record<string, unknown>),
  });
  return { server, sent, of: (type: string) => sent.filter((f) => f.type === type) };
}

const request = (id: string, body: Record<string, unknown> = { model: "thor-gemma" }) =>
  JSON.stringify({ type: "request", id, body });

describe("serving pushed work", () => {
  it("forwards the buyer's body to the local runtime unmodified", async () => {
    const runtime = fakeRuntime();
    const { server } = harness(runtime.fetchImpl);
    const body = { model: "thor-gemma", messages: [{ role: "user", content: "hi" }] };

    server.handleFrame(request("r1", body));
    await new Promise((r) => setTimeout(r, 5));

    expect(runtime.request?.url).toBe("http://localhost:4000/v1/chat/completions");
    expect(JSON.parse(String(runtime.request?.init.body))).toEqual(body);
  });

  it("presents the runtime's key, which the Exchange never sees", async () => {
    const runtime = fakeRuntime();
    const { server } = harness(runtime.fetchImpl);

    server.handleFrame(request("r1"));
    await new Promise((r) => setTimeout(r, 5));

    const headers = runtime.request?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer vllm-key");
  });

  it("reports the status before any tokens, so a 4xx relays as itself", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 429 })) as unknown as typeof fetch;
    const { server, of } = harness(fetchImpl);

    server.handleFrame(request("r1"));
    await new Promise((r) => setTimeout(r, 5));

    expect(of("response-head")[0]).toMatchObject({ id: "r1", status: 429 });
  });

  it("sends each chunk as it is produced rather than accumulating", async () => {
    const runtime = fakeRuntime();
    const { server, of } = harness(runtime.fetchImpl);

    server.handleFrame(request("r1"));
    await new Promise((r) => setTimeout(r, 5));

    runtime.push("one");
    await new Promise((r) => setTimeout(r, 5));
    // Already on the wire before the response finished. The Exchange enforces
    // Balance during generation and cannot do that against a machine that
    // replies once at the end.
    expect(of("chunk")).toEqual([{ type: "chunk", id: "r1", data: "one" }]);

    runtime.push("two");
    runtime.finish();
    await new Promise((r) => setTimeout(r, 5));

    expect(of("chunk").map((f) => f.data)).toEqual(["one", "two"]);
    expect(of("end")).toEqual([{ type: "end", id: "r1" }]);
  });

  it("stops generating when the Exchange cancels", async () => {
    const runtime = fakeRuntime();
    const { server, of } = harness(runtime.fetchImpl);

    server.handleFrame(request("r1"));
    await new Promise((r) => setTimeout(r, 5));
    runtime.push("partial");
    await new Promise((r) => setTimeout(r, 5));

    server.handleFrame(JSON.stringify({ type: "cancel", id: "r1" }));
    await new Promise((r) => setTimeout(r, 5));

    // The GPU stops. This is the whole reason the cancel frame exists.
    expect(runtime.aborted).toBe(true);
    // And nothing further is claimed about a request that was cut short.
    expect(of("end")).toEqual([]);
    expect(of("request-error")).toEqual([]);
  });

  it("reports a runtime it cannot reach at all", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED localhost:4000");
    }) as unknown as typeof fetch;
    const { server, of } = harness(fetchImpl);

    server.handleFrame(request("r1"));
    await new Promise((r) => setTimeout(r, 5));

    // Distinct from the runtime answering badly: this machine could not get an
    // answer, which the Exchange records as a supply failure it bears.
    expect(of("request-error")[0]).toMatchObject({ id: "r1", message: /ECONNREFUSED/ });
  });

  it("serves several requests at once without one blocking the others", async () => {
    const runtimes = [fakeRuntime(), fakeRuntime()];
    let next = 0;
    const fetchImpl = ((url: string, init: RequestInit) =>
      runtimes[next++].fetchImpl(url, init)) as unknown as typeof fetch;
    const { server, of } = harness(fetchImpl);

    server.handleFrame(request("r1"));
    server.handleFrame(request("r2"));
    await new Promise((r) => setTimeout(r, 5));

    expect(server.inFlightCount()).toBe(2);

    // The second answers first, which is the normal case and must not wait on
    // the first.
    runtimes[1].push("second");
    runtimes[1].finish();
    await new Promise((r) => setTimeout(r, 5));

    expect(of("end")).toEqual([{ type: "end", id: "r2" }]);
    expect(server.inFlightCount()).toBe(1);
  });

  it("stops everything when the Connection ends", async () => {
    const runtime = fakeRuntime();
    const { server } = harness(runtime.fetchImpl);

    server.handleFrame(request("r1"));
    await new Promise((r) => setTimeout(r, 5));

    server.stopAll();

    // Nothing in flight can be delivered to an Exchange that is not listening,
    // so holding the GPU for it is pure waste.
    expect(runtime.aborted).toBe(true);
    expect(server.inFlightCount()).toBe(0);
  });

  it("ignores frames that are not work", async () => {
    const { server } = harness(fakeRuntime().fetchImpl);

    expect(server.handleFrame("not json")).toBe(false);
    expect(server.handleFrame(JSON.stringify({ type: "welcome" }))).toBe(false);
  });
});
