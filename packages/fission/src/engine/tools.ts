/**
 * Tools for the fission chat.
 *
 * Beyond the usual web/math lookup, the chat gets one tool the tree makes
 * possible: `recall_thread`. Splitting a conversation into threads only helps
 * if the threads can still see each other — otherwise fission is just amnesia
 * with extra steps. recall_thread lets the model search every *other* node's
 * summaries and facts and pull back what it needs, which is the whole argument
 * for a tree over a single growing context.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { mathTools, webTools } from "@umwelten/core/stimulus/tools/index.js";
import type { FissionTree } from "../tree/tree.js";
import { tokenize } from "../tree/signature.js";

export interface RecallHit {
  nodeId: string;
  nodeTitle: string;
  score: number;
  summary: string;
  facts: string[];
}

/** Search the tree's turns for content matching a query, excluding one node. */
export function searchTree(
  tree: FissionTree,
  query: string,
  options: { excludeNodeId?: string; limit?: number } = {},
): RecallHit[] {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) return [];
  const limit = options.limit ?? 5;

  const hits: RecallHit[] = [];
  for (const node of Object.values(tree.data.nodes)) {
    if (node.id === options.excludeNodeId) continue;
    const turns = tree.nodeTurns(node.id);
    if (turns.length === 0) continue;

    const summaries: string[] = [];
    const facts: string[] = [];
    let score = 0;
    for (const turn of turns) {
      const haystack = [
        turn.userText,
        turn.analysis?.summary ?? "",
        turn.analysis?.topics.join(" ") ?? "",
        turn.analysis?.facts.join(" ") ?? "",
      ].join(" ");
      const terms = tokenize(haystack);
      let turnScore = 0;
      for (const term of terms) {
        if (queryTerms.has(term)) turnScore++;
      }
      if (turnScore > 0) {
        score += turnScore;
        if (turn.analysis?.summary) summaries.push(turn.analysis.summary);
        if (turn.analysis?.facts.length) facts.push(...turn.analysis.facts);
      }
    }

    if (score > 0) {
      hits.push({
        nodeId: node.id,
        nodeTitle: node.title,
        // Normalize by turn count so a long thread doesn't always win.
        score: Number((score / Math.sqrt(turns.length)).toFixed(2)),
        summary: summaries.slice(0, 4).join(" "),
        facts: Array.from(new Set(facts)).slice(0, 8),
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function createRecallTool(
  tree: FissionTree,
  getCurrentNodeId: () => string,
): Tool {
  return tool({
    description:
      "Search the other threads of this conversation tree for something discussed elsewhere. Use when the user refers to an earlier topic that isn't in the current thread's context.",
    inputSchema: z.object({
      query: z.string().describe("What to look for — keywords or a short phrase."),
    }),
    execute: async ({ query }: { query: string }) => {
      const hits = searchTree(tree, query, { excludeNodeId: getCurrentNodeId() });
      if (hits.length === 0) {
        return { found: false, message: "No other thread in this tree mentions that." };
      }
      return {
        found: true,
        threads: hits.map((hit) => ({
          thread: hit.nodeTitle,
          relevance: hit.score,
          summary: hit.summary,
          facts: hit.facts,
        })),
      };
    },
  });
}

export interface BuildToolsOptions {
  tree: FissionTree;
  getCurrentNodeId: () => string;
  /** Include core's wget/markify/parse_feed. Default true. */
  web?: boolean;
  /** Include core's calculator/random/statistics. Default true. */
  math?: boolean;
  /** Include cross-thread recall. Default true. */
  recall?: boolean;
  extra?: Record<string, Tool>;
}

export function buildFissionTools(options: BuildToolsOptions): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  if (options.web !== false) Object.assign(tools, webTools);
  if (options.math !== false) Object.assign(tools, mathTools);
  if (options.recall !== false) {
    tools.recall_thread = createRecallTool(options.tree, options.getCurrentNodeId);
  }
  if (options.extra) Object.assign(tools, options.extra);
  return tools;
}
