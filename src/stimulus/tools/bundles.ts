/**
 * Curated, drop-in tool bundles for stateless Vercel AI SDK tools.
 *
 * Each export is a `Record<string, Tool>` ready to spread into `Stimulus.tools`.
 * For sandboxed filesystem + bash + skills, see `createAgentKit` in agent-kit.ts.
 */

import type { Tool } from 'ai';
import { calculatorTool, randomNumberTool, statisticsTool } from './examples/math.js';
import { wgetTool, markifyTool, parseFeedTool } from './url-tools.js';

export const mathTools: Record<string, Tool> = {
  calculator: calculatorTool,
  random_number: randomNumberTool,
  statistics: statisticsTool,
};

export const webTools: Record<string, Tool> = {
  wget: wgetTool,
  markify: markifyTool,
  parse_feed: parseFeedTool,
};
