import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  CollaborationRun,
  collaborationModelSchema,
  limitsSchema,
} from "../../collaboration/runtime.js";
import type { AgentRunnerToolsContext } from "./context.js";

// One collection per host, even when the host rebuilds its tool registry.
const hosts = new WeakMap<
  AgentRunnerToolsContext,
  Map<string, CollaborationRun>
>();
const runIdSchema = z.string().uuid();

/** Host management tools. Experiment participants receive only toolsFor(id). */
export function createCollaborationRunTools(
  ctx: AgentRunnerToolsContext,
): Record<string, Tool> {
  let runs = hosts.get(ctx);
  if (!runs) {
    runs = new Map();
    hosts.set(ctx, runs);
  }
  const get = (runId: string) => {
    const run = runs.get(runId);
    if (!run)
      throw new Error(
        "Unknown run; use collaboration_resume after a host restart",
      );
    return run;
  };
  return {
    collaboration_start: tool({
      description:
        "Start a bounded asynchronous collaboration experiment. Participants have only collaboration tools, not unrestricted Habitat tools. Returns immediately; inspect with collaboration_inspect.",
      inputSchema: z.object({
        agents: z
          .array(
            z.object({
              task: z.string().min(1).max(100_000),
              model: collaborationModelSchema.optional(),
              instructions: z.string().max(100_000).optional(),
            }),
          )
          .min(1)
          .max(16),
        templateAgentId: z
          .string()
          .describe(
            "Managed agent supplying the default model; its tools/history are not inherited",
          ),
        limits: limitsSchema.optional(),
      }),
      execute: async ({ agents, templateAgentId, limits }) => {
        if (!ctx.getAgent(templateAgentId))
          throw new Error("Unknown template agent");
        const base = (
          await ctx.getOrCreateHabitatAgent(templateAgentId)
        ).getInteraction();
        const key = randomUUID();
        const directory = join(ctx.getWorkDir(), "collaborations", key);
        const run = new CollaborationRun(directory, { id: key, limits });
        try {
          for (const seed of agents)
            run.addAgent({ ...seed, model: seed.model ?? base.modelDetails });
          runs.set(key, run);
          run.start();
          return { runId: key, directory, ...run.status() };
        } catch (error) {
          await run.close();
          throw error;
        }
      },
    }),
    collaboration_resume: tool({
      description:
        "Explicitly resume a persisted experiment after host restart. Interrupted decisions fail rather than replaying side effects. Original budgets/deadline remain in force.",
      inputSchema: z.object({ runId: runIdSchema }),
      execute: async ({ runId }) => {
        if (runs.has(runId)) return get(runId).status();
        const run = new CollaborationRun(
          join(ctx.getWorkDir(), "collaborations", runId),
          { resume: true },
        );
        runs.set(runId, run);
        if (!run.status().stopped) run.start();
        return run.status();
      },
    }),
    collaboration_inspect: tool({
      description:
        "Inspect experiment status, ordered trace events, and an optional artifact. Operator access includes private agent traces; do not expose this tool to experiment participants.",
      inputSchema: z.object({
        runId: runIdSchema,
        after: z.number().int().nonnegative().default(0),
        path: z.string().optional(),
        version: z.number().int().positive().optional(),
      }),
      execute: async ({ runId, after, path, version }) => {
        const run = get(runId);
        const events = run.store.events(after).slice(0, 100);
        return {
          ...run.status(),
          events,
          nextCursor: events.at(-1)?.id ?? after,
          artifact: path ? run.store.artifact(path, version) : undefined,
        };
      },
    }),
    collaboration_send: tool({
      description:
        "Inject an operator message into an agent mailbox or channel:name, waking subscribers.",
      inputSchema: z.object({
        runId: runIdSchema,
        to: z.string(),
        message: z.string().min(1).max(100_000),
      }),
      execute: async ({ runId, to, message }) =>
        get(runId).send(null, to, message),
    }),
    collaboration_publish: tool({
      description:
        "Publish a versioned operator artifact, waking agents subscribed to artifacts.",
      inputSchema: z.object({
        runId: runIdSchema,
        path: z.string(),
        content: z.string().max(1_000_000),
        expectedVersion: z.number().int().nonnegative(),
      }),
      execute: async ({ runId, path, content, expectedVersion }) =>
        get(runId).publish(null, path, content, expectedVersion),
    }),
    collaboration_stop: tool({
      description:
        "Stop an experiment permanently; abort in-flight model requests and retain its journal.",
      inputSchema: z.object({ runId: runIdSchema }),
      execute: async ({ runId }) => {
        const run = get(runId);
        run.stop();
        await run.waitForIdle();
        return run.status();
      },
    }),
  };
}
