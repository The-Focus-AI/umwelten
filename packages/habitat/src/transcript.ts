/**
 * Re-exports from session-record/transcript-write.ts.
 *
 * The implementation was moved to session-record/ to break the circular
 * dependency between habitat (Layer 6) and ui (Layer 8). Existing imports
 * from habitat/transcript.ts continue to work.
 */
export { coreMessagesToJSONL, writeSessionTranscript } from '@umwelten/core/session-record/transcript-write.js';
