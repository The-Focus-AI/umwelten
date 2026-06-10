/**
 * Plain-text row formatting for `umwelten search --no-tui` (slice 9, #91).
 *
 * One hit → one line, `grep`/`less`-friendly:
 *
 *   2026-06-10T13:31:00.000Z · umwelten · user · …the matching snippet…
 *
 * This is the human-readable sibling of `--json`: same hits, presentation
 * instead of structure. Programmatic consumers should use `--json`, which
 * prints the full SessionHit[] shape.
 */
import type { SessionHit } from "@umwelten/core/interaction/search/index.js";

const SEPARATOR = " · ";

/** Collapse any whitespace runs (incl. newlines/tabs) so a row is one line. */
function oneLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Format a single hit as `timestamp · project · role · snippet`. */
export function formatHitRow(hit: SessionHit): string {
	return [
		hit.messageTimestamp,
		hit.projectName,
		hit.role,
		oneLine(hit.snippet),
	].join(SEPARATOR);
}

/**
 * Format all hits, one row per line, with a trailing newline when there
 * are any rows. Zero hits → empty string (nothing lands on stdout).
 */
export function formatHitRows(hits: SessionHit[]): string {
	if (hits.length === 0) return "";
	return hits.map(formatHitRow).join("\n") + "\n";
}
