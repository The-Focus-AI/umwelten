/**
 * `umwelten sessions` Commander tree — composed from per-domain
 * registrars. Each `registerXxxCommands(parent)` mutates the shared
 * parent `Command` (Commander's `.command(...)` chained API).
 *
 * The order of registration determines the order of `--help` output,
 * so it's preserved exactly as the pre-split file had it.
 *
 * Public surface (preserved from the pre-split sessions.ts):
 * - `sessionsCommand` — the top-level Command consumers register.
 *
 * Also see `packages/habitat/src/sessions-habitat.ts` which adds the
 * `sessions habitat` subtree at CLI orchestration time (kept outside
 * this package so @umwelten/sessions doesn't depend on
 * @umwelten/habitat).
 */

import { Command } from "commander";
import { registerInspectCommands } from "./inspect.js";
import { registerFormatCommand } from "./format.js";
import { registerTuiCommands } from "./tui.js";
import { registerBulkCommands } from "./bulk.js";
import { registerLearningsCommands } from "./learnings.js";
import { registerTranscriptCommands } from "./transcript.js";
import { registerDigestCommands } from "./digest.js";

export const sessionsCommand = new Command("sessions").description(
	"View and analyze sessions (Claude Code, Cursor) and native Habitat transcripts",
);

registerInspectCommands(sessionsCommand);
registerFormatCommand(sessionsCommand);
registerTuiCommands(sessionsCommand);
registerBulkCommands(sessionsCommand);
registerLearningsCommands(sessionsCommand);
registerTranscriptCommands(sessionsCommand);
registerDigestCommands(sessionsCommand);
