/**
 * Segment selection for compaction: which slice of messages to condense.
 * Convention: index 0 is system; segment is [start, end] inclusive of conversation messages only.
 */

import type { CoreMessage } from "ai";
import type { CompactionSegment } from "./types.js";

export interface GetCompactionSegmentOptions {
  /** If true, start segment at checkpointIndex (when set). */
  fromCheckpoint?: boolean;
  /** Message index after which the "current thread" starts (1 = first message after system). */
  checkpointIndex?: number;
}

/**
 * Get the segment to condense: from start (checkpoint or 1) through end of last complete flow.
 * End = index of the last assistant message so we don't cut in the middle of a user turn.
 * Returns null if there is no assistant message in range or segment is invalid.
 */
export function getCompactionSegment(
  messages: CoreMessage[],
  options: GetCompactionSegmentOptions = {}
): CompactionSegment | null {
  const { fromCheckpoint = false, checkpointIndex } = options;
  if (messages.length <= 1) return null;

  const start = fromCheckpoint && checkpointIndex != null && checkpointIndex >= 1
    ? checkpointIndex
    : 1;

  if (start >= messages.length) return null;

  // Find last assistant message in [start, length-1]
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= start; i--) {
    const role = (messages[i] as { role?: string }).role;
    if (role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  if (lastAssistantIndex < start) return null;

  return { start, end: lastAssistantIndex };
}
