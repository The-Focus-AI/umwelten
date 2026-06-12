/**
 * Shared color theme for the Ink TUIs (issue #110).
 *
 * The repo's de facto palette, made explicit so new components stop
 * drifting toward Ink defaults that are unreadable on common terminal
 * themes (`blue` for assistant text, `gray`/ANSI bright-black for
 * secondary text). Tokens map to the colors the TUIs already use, so
 * adopting them is visually neutral — except `gray` text, which should
 * become {@link secondary} (dimColor respects the user's theme; a
 * hard-coded gray does not — see PR #108).
 *
 * Use `color={theme.X}` / `borderColor={theme.borderX}` for the roles
 * below; spread {@link secondary} for secondary text.
 */

export const theme = {
	// ── Foreground roles ─────────────────────────────────────────────
	/** Headers, the selection marker, primary nouns. */
	accent: "cyan",
	/** User-typed values: search queries, filter text. */
	userValue: "magenta",
	/** In-progress states: scanning…, extracting…, queued; also counts that draw the eye. */
	pending: "yellow",
	/** Errors and destructive actions. */
	error: "red",
	/** Confirmations, success states. */
	success: "green",

	// ── Chat message roles ───────────────────────────────────────────
	/** User messages. */
	roleUser: "green",
	/** Assistant messages — never `blue`, it's nearly invisible on common dark themes. */
	roleAssistant: "cyan",
	/** Tool calls / results. */
	roleTool: "magenta",
	/** System messages: default foreground + dimColor (use {@link secondary}). */
	roleSystem: undefined,

	// ── Borders ──────────────────────────────────────────────────────
	/** Focused / primary panel borders. */
	borderAccent: "cyan",
	/** Chrome and inactive panel borders. */
	borderMuted: "gray",
	/** Attention-demanding overlays (confirmations with side effects). */
	borderPending: "yellow",
} as const;

/**
 * Secondary text: labels, separators, metadata, timestamps.
 *
 * Spread this (`<Text {...secondary}>`) instead of `color="gray"` —
 * gray picks ANSI 90 (bright black), which is unreadable on several
 * common terminal themes, while dimColor on the default foreground
 * adapts to whatever the user runs.
 */
export const secondary = { dimColor: true } as const;
