/**
 * Serving work that arrives down the Connection.
 *
 * The Exchange pushes a request; this forwards it to the local runtime and
 * streams the bytes back as they are produced. Nothing is buffered — the
 * Exchange counts completion tokens per chunk and enforces Balance during
 * generation (ADR 0017), and a machine that accumulated a whole response before
 * replying would defeat both.
 *
 * **Cancellation is not optional.** A buyer who hangs up, or runs out of
 * credit, produces a `cancel` frame; ignoring it means burning GPU seconds on
 * tokens nobody will receive and nobody will pay for. Each in-flight request
 * therefore owns an AbortController the cancel frame trips.
 *
 * The runtime is reached over plain HTTP on this machine — the same
 * OpenAI-shaped endpoint the supplier agent already probes through, so nothing
 * here knows whether that is llama.cpp, vLLM or anything else.
 */

/** Must match the Exchange's `WIRE_VERSION`. */
export interface ServeConnectionOptions {
  /** Where the local runtime listens, e.g. `http://localhost:4000/v1`. */
  runtimeUrl: string;
  /** Key the runtime expects, if it wants one. */
  runtimeCredential?: string;
  /** Push a frame back to the Exchange. */
  send: (frame: string) => void;
  fetchImpl?: typeof fetch;
  onEvent?: (event: ServeEvent) => void;
}

export type ServeEvent =
  | { type: "request-started"; id: string; model?: string }
  | { type: "request-finished"; id: string; bytes: number }
  | { type: "request-cancelled"; id: string }
  | { type: "request-failed"; id: string; message: string };

interface InFlight {
  abort: AbortController;
}

/**
 * Handle the work frames on one Connection.
 *
 * Returns a frame handler to install on the socket, plus a `stopAll` for when
 * the Connection ends — every request riding a dead socket is unfinishable, and
 * leaving them generating would keep the GPU busy for an Exchange that is no
 * longer listening.
 */
export function createConnectionServer(opts: ServeConnectionOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const onEvent = opts.onEvent ?? (() => {});
  const inFlight = new Map<string, InFlight>();

  const send = (frame: unknown) => opts.send(JSON.stringify(frame));

  async function serve(id: string, body: Record<string, unknown>): Promise<void> {
    const abort = new AbortController();
    inFlight.set(id, { abort });
    onEvent({ type: "request-started", id, model: typeof body.model === "string" ? body.model : undefined });

    let bytes = 0;
    try {
      const url = `${opts.runtimeUrl.replace(/\/$/, "")}/chat/completions`;
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.runtimeCredential
            ? { authorization: `Bearer ${opts.runtimeCredential}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });

      // Status first, and relayed as-is. A runtime answering 400 is the
      // runtime answering; that is a different thing from this agent being
      // unable to reach it, and the Exchange has to be able to tell them apart.
      send({
        type: "response-head",
        id,
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
      });

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (abort.signal.aborted) break;
          const data = decoder.decode(value, { stream: true });
          if (data) {
            bytes += data.length;
            send({ type: "chunk", id, data });
          }
        }
      }

      if (!abort.signal.aborted) {
        send({ type: "end", id });
        onEvent({ type: "request-finished", id, bytes });
      }
    } catch (error) {
      // An abort is a cancellation we caused, not a failure to report. The
      // Exchange already knows — it asked.
      if (abort.signal.aborted) {
        onEvent({ type: "request-cancelled", id });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      send({ type: "request-error", id, message });
      onEvent({ type: "request-failed", id, message });
    } finally {
      inFlight.delete(id);
    }
  }

  return {
    /** Returns true if it consumed the frame, so the dial loop can ignore it. */
    handleFrame(raw: string): boolean {
      let frame: { type?: string; id?: string; body?: Record<string, unknown> };
      try {
        frame = JSON.parse(raw) as typeof frame;
      } catch {
        return false;
      }
      if (!frame || typeof frame !== "object") return false;

      if (frame.type === "request" && frame.id && frame.body) {
        // Deliberately not awaited: one slow request must not block the frames
        // for the others sharing this Connection.
        void serve(frame.id, frame.body);
        return true;
      }
      if (frame.type === "cancel" && frame.id) {
        inFlight.get(frame.id)?.abort.abort();
        return true;
      }
      return false;
    },

    /** How many requests this machine is working on right now. */
    inFlightCount(): number {
      return inFlight.size;
    },

    /** The Connection ended. Nothing in flight can be delivered. */
    stopAll(): void {
      for (const entry of inFlight.values()) entry.abort.abort();
      inFlight.clear();
    },
  };
}
