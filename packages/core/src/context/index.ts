/**
 * Context module: size estimation and compaction strategies.
 * Built-in strategies are registered lazily on first getCompactionStrategy or listCompactionStrategies call.
 */

export type { CompactionInput, CompactionResult, CompactionStrategy, ContextSizeEstimate, CompactionSegment } from "./types.js";
export { estimateContextSize } from "./estimate-size.js";
export { getCompactionSegment } from "./segment.js";
export type { GetCompactionSegmentOptions } from "./segment.js";
export { registerCompactionStrategy, getCompactionStrategy, listCompactionStrategies } from "./registry.js";
export { serializeSegment } from "./serialize-messages.js";
