/** Complete user turns, including every tool round-trip, are indivisible. */
import type { ModelMessage } from "ai";
import type { CompactionSegment } from "./types.js";

export interface GetCompactionSegmentOptions {
  fromCheckpoint?: boolean;
  /** A lower bound; a checkpoint inside a turn advances to the next turn. */
  checkpointIndex?: number;
}

export function getCompleteTurns(
  messages: ModelMessage[],
): CompactionSegment[] {
  const turns: CompactionSegment[] = [];
  let start = -1;
  let valid = true;
  let hasResponse = false;
  const pending = new Set<string>();
  const finish = (end: number) => {
    const last = messages[end];
    const endsWithCall =
      last?.role === "assistant" &&
      Array.isArray(last.content) &&
      last.content.some((part) => part.type === "tool-call");
    if (
      start >= 0 &&
      valid &&
      pending.size === 0 &&
      last?.role === "assistant" &&
      !endsWithCall
    ) {
      turns.push({ start, end });
    }
  };
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (
      (message.role === "user" && (start < 0 || hasResponse)) ||
      message.role === "system"
    ) {
      finish(i - 1);
      start = message.role === "user" ? i : -1;
      pending.clear();
      valid = true;
      hasResponse = false;
    }
    if (message.role === "assistant" || message.role === "tool")
      hasResponse = true;
    if (start < 0 || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-call") {
        if (pending.has(part.toolCallId)) valid = false;
        pending.add(part.toolCallId);
      } else if (part.type === "tool-result") {
        if (!pending.delete(part.toolCallId)) valid = false;
      }
    }
  }
  finish(messages.length - 1);
  return turns;
}

/** Select a contiguous run of complete turns, preserving any unfinished tail. */
export function getCompactionSegment(
  messages: ModelMessage[],
  options: GetCompactionSegmentOptions = {},
): CompactionSegment | null {
  const lower = options.fromCheckpoint ? (options.checkpointIndex ?? 0) : 0;
  const turns = getCompleteTurns(messages).filter(
    (turn) => turn.start >= lower,
  );
  if (!turns.length) return null;
  const segment = { ...turns[0] };
  for (const turn of turns.slice(1)) {
    if (turn.start !== segment.end + 1) break;
    segment.end = turn.end;
  }
  return segment;
}

/** Direct strategy callers must also supply complete, contiguous turn bounds. */
export function requireCompleteTurns(
  messages: ModelMessage[],
  start: number,
  end: number,
): CompactionSegment[] {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end >= messages.length ||
    end < start
  ) {
    throw new Error("Invalid compaction segment bounds");
  }
  const turns = getCompleteTurns(messages).filter(
    (turn) => turn.start >= start && turn.end <= end,
  );
  if (
    !turns.length ||
    turns[0].start !== start ||
    turns.at(-1)!.end !== end ||
    turns.some((turn, i) => i > 0 && turn.start !== turns[i - 1].end + 1)
  ) {
    throw new Error(
      "Compaction segment must contain complete contiguous user turns",
    );
  }
  return turns;
}
