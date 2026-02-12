/**
 * Dagger run_bash tool. Factory export — needs habitat context.
 * Re-exports createRunBashTool from the jeeves-bot tools (canonical source
 * until we fully decouple the dagger dependency).
 *
 * The factory receives context with: workDir, getAgent(), getAllowedRoots().
 */

import { createRunBashTool, type DaggerToolContext } from '../../../examples/jeeves-bot/tools/dagger.js';
import type { Tool } from 'ai';

export default function (context: DaggerToolContext): Tool {
  return createRunBashTool(context);
}
