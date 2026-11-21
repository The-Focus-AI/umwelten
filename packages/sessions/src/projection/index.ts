/**
 * Session projection — bridge between adapters and Explorations.
 *
 * Discovers Source Sessions from all registered adapters and projects
 * them into default Explorations.
 */
export {
	projectSessions,
	projectSessionEntry,
	toSourceSession,
	toSourceSessionFull,
} from "./projector.js";
export type {
	ProjectionResult,
	ProjectionSourceResult,
	ProjectionOptions,
} from "./projector.js";
