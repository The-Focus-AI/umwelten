/**
 * Public type shapes for Session Search.
 *
 * These types form the contract between the three deep modules:
 *
 *   RipgrepScanner.scan() → RawScanHit[]
 *   SessionHitParser.parseHit() → SessionHit | null
 *   SessionSearcher.search() → SessionHit[]
 *
 * Slice 1 (this slice) introduces the minimal shapes; later slices
 * extend SessionHit with snippet polish, full message content, etc.
 */

/**
 * A single match emitted by ripgrep, normalized for downstream use.
 *
 * One ripgrep `match` record produces one `RawScanHit`. The hit
 * captures the matching line's text (already in ripgrep's output —
 * no need to re-read the file) plus the submatch byte offsets so
 * callers can build context windows or highlight the match.
 */
export interface RawScanHit {
	/** Absolute path to the file the match came from. */
	filePath: string;
	/** 1-indexed line number within the file. */
	lineNumber: number;
	/** Full text of the matching line, with trailing newline preserved. */
	matchedLine: string;
	/**
	 * Byte offsets into `matchedLine` where the query matched. ripgrep
	 * can report multiple submatches for a single line (the same query
	 * matched twice on one line, for example).
	 */
	submatches: Array<{ start: number; end: number; text: string }>;
}

/**
 * A typed hit at the conversation-message level.
 *
 * A SessionHit represents one matching message in one Source Session.
 * It's the unit the search TUI renders and the JSON output prints.
 *
 * Slice 1 has only the minimal fields; slices 3-4 add `snippet` and
 * `fullMessageContent`.
 */
export interface SessionHit {
	/** Decoded absolute project path (the directory the user was in). */
	projectPath: string;
	/** Basename of `projectPath` for display. */
	projectName: string;
	/** Claude Code session ID (filename without `.jsonl`). */
	sessionId: string;
	/** Absolute path to the `.jsonl` file, for downstream readers. */
	filePath: string;
	/** ISO-8601 timestamp on the matching message. */
	messageTimestamp: string;
	/** Conversation role on the matching message. */
	role: "user" | "assistant" | "tool" | "system";
	/**
	 * The text content of the matching message (best-effort flattened
	 * if the message had array content blocks). Slice 1 uses this as
	 * the snippet too; slice 3 introduces a separate snippet field.
	 */
	matchedText: string;
}

/** Options controlling a single ripgrep scan invocation. */
export interface ScanOptions {
	/** Case-sensitive match. Default: false (case-insensitive). */
	caseSensitive?: boolean;
	/**
	 * Max matches per file. Default: 5. Prevents one session with
	 * 200 mentions from dominating results.
	 */
	maxCountPerFile?: number;
	/**
	 * Max filesize in megabytes. Files larger than this are skipped.
	 * Default: 50.
	 */
	maxFilesizeMB?: number;
	/**
	 * Directories to scan. Default: [~/.claude/projects].
	 */
	searchRoots?: string[];
}

/** Options controlling a search call (passed to SessionSearcher). */
export interface SearchOptions extends ScanOptions {}

/**
 * Error class for "ripgrep not on PATH". Thrown by RipgrepScanner.scan
 * when the `rg` binary cannot be spawned. The message includes
 * platform-specific install hints.
 */
export class RipgrepNotFoundError extends Error {
	constructor() {
		super(
			[
				"ripgrep (`rg`) is required but was not found on your PATH.",
				"",
				"Install it with one of:",
				"  macOS:   brew install ripgrep",
				"  Debian:  sudo apt install ripgrep",
				"  Fedora:  sudo dnf install ripgrep",
				"  Arch:    sudo pacman -S ripgrep",
				"  Windows: choco install ripgrep",
				"           winget install BurntSushi.ripgrep.MSVC",
				"           scoop install ripgrep",
				"",
				"More: https://github.com/BurntSushi/ripgrep#installation",
			].join("\n"),
		);
		this.name = "RipgrepNotFoundError";
	}
}
