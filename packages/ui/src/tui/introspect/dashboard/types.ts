/**
 * Internal types for the Exploration Browser dashboard TUI.
 *
 * Kept separate from DashboardApp.tsx so tests and the implementation can
 * share the type definitions without circular import worries.
 */

import type { ExplorationBrowserEntry } from "@umwelten/core/interaction/types/domain-types.js";

/**
 * Status of an exploration in the dashboard table.
 *
 * - `new`       — no digest exists yet
 * - `queued`    — engine has accepted the work; awaiting its turn
 * - `digesting` — extraction is actively running for this row
 * - `digested`  — digest is present and up-to-date
 * - `failed`    — last extraction attempt errored
 * - `stale`     — digest exists but the source session has changed since
 */
export type DashboardStatus =
	| "new"
	| "queued"
	| "digesting"
	| "digested"
	| "failed"
	| "stale";

/**
 * Intent returned from the dashboard when the user picks an action.
 * The CLI loop acts on this after the TUI exits.
 *
 * - `none`   — quit; the host should exit the browse loop entirely.
 * - `return` — hand control back to the caller that launched the dashboard
 *   (slice 7, #89: `q` in a dashboard launched from the search TUI bounces
 *   back to the search results instead of exiting the process). Only emitted
 *   when the host sets `returnToCaller` on DashboardApp.
 */
export type DashboardIntent =
	| { kind: "none" }
	| { kind: "return" }
	| { kind: "detail"; entry: ExplorationBrowserEntry }
	| { kind: "transcript"; entry: ExplorationBrowserEntry }
	| { kind: "digest"; entry: ExplorationBrowserEntry }
	| { kind: "beats"; entry: ExplorationBrowserEntry }
	| { kind: "reflect"; entry: ExplorationBrowserEntry }
	| { kind: "promote"; entry: ExplorationBrowserEntry };

/**
 * Progress event emitted by the extraction workflow engine to the dashboard.
 *
 * The dashboard subscribes to a stream of these events and patches the
 * corresponding row's status in place. Matches the shape produced by
 * `ExtractionEngine.run`'s onProgress callback (extraction-engine.ts).
 */
export interface DashboardProgressEvent {
	explorationId: string;
	sessionId: string;
	phase: "pending" | "digesting" | "digested" | "failed";
	detail?: string;
}

/**
 * Function shape passed in by the host so the dashboard can subscribe to a
 * live stream of extraction progress events. Returns an unsubscribe handle.
 */
export type ExtractionEventSubscriber = (
	listener: (event: DashboardProgressEvent) => void,
) => () => void;
