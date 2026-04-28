/**
 * Fetch wrappers for local-provider HTTP calls.
 *
 * Problem: Node's global fetch (undici) has a default `headersTimeout` of
 * 300s. When a slow local llama.cpp server is still doing prompt eval after
 * 5 minutes (happens on M-series under memory pressure with 26B models),
 * the client aborts with "Cannot connect to API: Headers Timeout Error"
 * before the server ever sends response headers. The retry loop then
 * hammers the same stuck server.
 *
 * Fix: for local providers (llamabarn, llamaswap, ollama, lmstudio — all
 * trusted loopback endpoints), disable the headers timeout and body
 * timeout. The runner's own retry logic + user cancellation (SIGINT) are
 * the real gates; undici's timeouts only mask slow inference as fake
 * "connection" failures.
 */

import { Agent, setGlobalDispatcher } from "undici";

let installed = false;

/**
 * Install a process-wide undici dispatcher that disables headersTimeout
 * and bodyTimeout for all fetches. Safe for this project because the only
 * thing we call over HTTP-without-auth is local llama.cpp/ollama backends;
 * remote API calls (OpenRouter, Anthropic, etc.) are short enough that
 * default timeouts never tripped, and their own SDKs set AbortSignal
 * timeouts on top if needed.
 *
 * Idempotent — safe to call multiple times. First call wins.
 */
export function installLocalFetchDispatcher(): void {
  if (installed) return;
  installed = true;
  // 0 = unlimited per undici docs. connectTimeout stays at default (10s)
  // so we still fail fast if the local server isn't listening at all.
  setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));
}
