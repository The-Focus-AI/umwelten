/** A bounded metadata projection; never exports transcripts, task messages or raw errors. */
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveCompletionsDir } from "@umwelten/core";
import {
  FileTaskStore,
  summarizeTasks,
  isAbandonableTaskState,
} from "@umwelten/protocols";
import { habitatTaskDir } from "./a2a-handler.js";
import type { OperationalTelemetry } from "./tools/gaia/operations.js";

export async function collectOperationalTelemetry(options: {
  workDir: string;
  configurationReady: boolean;
  runtimeErrors?: number;
  completionsDir?: string;
  now?: number;
}): Promise<OperationalTelemetry> {
  const now = options.now ?? Date.now();
  const tasks = await new FileTaskStore({
    dir: habitatTaskDir(options.workDir),
  }).listAll();
  // The task store tolerates damaged records for normal recovery. Monitoring
  // must not interpret a skipped record as proof that restarting is safe.
  const taskFiles = (await readdir(habitatTaskDir(options.workDir))).filter(
    (name) => name.endsWith(".task.json"),
  );
  if (taskFiles.length !== tasks.length)
    throw new Error("Task inventory incomplete");
  const summary = summarizeTasks(tasks);
  const activeTimes = tasks
    .filter((t) => isAbandonableTaskState(t.status?.state))
    .map((t) => Date.parse(t.status?.timestamp ?? ""))
    .filter(Number.isFinite);
  const executions = {
    count: 0,
    errors: 0,
    slow: 0,
    tokens: 0,
    cost: 0,
    available: false,
    truncated: false,
  };
  const dir = options.completionsDir ?? resolveCompletionsDir();
  // At most 512 KiB across the two dates that can intersect the 15-minute
  // window. Never scan a session transcript or retain provider usageRaw.
  const dates = new Set(
    [now, now - 15 * 60_000].map((t) => new Date(t).toISOString().slice(0, 10)),
  );
  for (const date of dates) {
    let file;
    try {
      file = await open(join(dir, `${date}.jsonl`), "r");
      const size = (await file.stat()).size;
      const length = Math.min(size, 256 * 1024);
      const data = Buffer.alloc(length);
      await file.read(data, 0, length, size - length);
      const lines = data.toString("utf8").split("\n");
      if (size > length) {
        lines.shift();
        executions.truncated = true;
      }
      executions.available = true;
      for (const line of lines) {
        if (!line) continue;
        try {
          const record = JSON.parse(line);
          const at = Date.parse(record.endedAt);
          if (
            !Number.isFinite(at) ||
            at < now - 15 * 60_000 ||
            at > now ||
            record.kind !== "llm"
          )
            continue;
          executions.count++;
          if (record.outcome === "error") executions.errors++;
          if (record.durationMs > 120_000) executions.slow++;
          if (Number.isFinite(record.tokens?.total) && record.tokens.total >= 0)
            executions.tokens += record.tokens.total;
          if (Number.isFinite(record.cost?.total) && record.cost.total >= 0)
            executions.cost += record.cost.total;
        } catch {
          executions.truncated = true;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      await file?.close();
    }
  }
  return {
    version: 1,
    observedAt: new Date(now).toISOString(),
    tasks: {
      active: summary.active,
      waiting: summary.interrupted,
      oldestActiveAt: activeTimes.length
        ? new Date(Math.min(...activeTimes)).toISOString()
        : null,
    },
    executions,
    runtimeErrors: options.runtimeErrors ?? 0,
    configurationReady: options.configurationReady,
  };
}

/** Only use authenticated internal addresses; redirects must not forward credentials. */
export async function fetchOperationsJson(
  url: string,
  key: string,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(3_000),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Operations endpoint unavailable");
  }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 256 * 1024) throw new Error("Operations response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
