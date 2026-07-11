/**
 * room_history — pull the SaaS room's recent discussion on demand (#102 v2).
 *
 * A habitat agent's session only contains its own runs; the room's wider
 * discussion (humans talking, other agents) lives SaaS-side. This tool
 * presents the CURRENT SPEAKER's verified grant back to its issuer (the
 * habitats SaaS), which authorizes the read as that user and returns the
 * room's recent main-timeline messages as text.
 *
 * Only works on per-user (JWT) runs — the shared operator key carries no
 * grant and no room scope, and dev/open runs have no issuer to call.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { getSpeaker } from "../identity/agent-speaker-context.js";

const FETCH_TIMEOUT_MS = 10_000;

export type FetchLike = typeof fetch;

export function createRoomHistoryTools(options?: {
  fetchImpl?: FetchLike;
}): Record<string, Tool> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  return {
    room_history: tool({
      description:
        "Fetch the recent discussion from this room (the habitats app room " +
        "this conversation lives in) — messages from all participants, not " +
        "just ones addressed to you. Use when asked to summarize or refer " +
        "to the recent discussion.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many recent messages to fetch (default 30)."),
      }),
      async execute({ limit }) {
        const speaker = getSpeaker();
        if (!speaker?.grant || !speaker.issuer) {
          return {
            error:
              "Room history is only available when a signed-in habitats user " +
              "invokes me (per-user grant); this request has no room scope.",
            kind: "no_room_scope",
          };
        }
        try {
          const res = await fetchImpl(
            `${speaker.issuer}/api/agent/room-history`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${speaker.grant}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ limit: limit ?? 30 }),
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            },
          );
          if (!res.ok) {
            const detail = (await res.text().catch(() => "")).slice(0, 300);
            return {
              error: `room-history fetch failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
            };
          }
          return (await res.json()) as unknown;
        } catch (err) {
          return {
            error: `room-history fetch threw: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    }),
  };
}
