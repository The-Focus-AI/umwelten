/**
 * CompletionSink implementations.
 *
 * - JsonlCompletionSink: append-only, one file per UTC day, human-readable.
 *   Lives under `<project>/.umwelten/completions/` by default (see
 *   `resolveCompletionsDir`), matching the project-local, hand-editable
 *   convention for `.umwelten/` working data.
 * - MemoryCompletionSink: for tests and in-process consumers.
 * - NullCompletionSink: what `UMWELTEN_TRACE=0` resolves to.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CompletionRecord, CompletionSink } from "./types.js";

export class MemoryCompletionSink implements CompletionSink {
  readonly records: CompletionRecord[] = [];
  record(record: CompletionRecord): void {
    this.records.push(record);
  }
}

export class NullCompletionSink implements CompletionSink {
  record(): void {}
}

export class JsonlCompletionSink implements CompletionSink {
  private ensured = false;

  constructor(readonly dir: string) {}

  /** File for a record: `<dir>/YYYY-MM-DD.jsonl` keyed on the record's UTC start date. */
  fileFor(record: CompletionRecord): string {
    return join(this.dir, `${record.startedAt.slice(0, 10)}.jsonl`);
  }

  record(record: CompletionRecord): void {
    try {
      if (!this.ensured) {
        mkdirSync(this.dir, { recursive: true });
        this.ensured = true;
      }
      appendFileSync(this.fileFor(record), JSON.stringify(record) + "\n", "utf-8");
    } catch (err) {
      // Recording must never break a model call. Warn once per process.
      if (!warned) {
        warned = true;
        console.warn(
          `[umwelten] could not write completion record to ${this.dir}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}

let warned = false;

/**
 * Where completion records go when no sink is configured explicitly.
 *
 * 1. `UMWELTEN_COMPLETIONS_DIR` if set.
 * 2. `<cwd>/.umwelten/completions` when cwd looks like a project
 *    (has `.umwelten/` or `.git/`).
 * 3. `~/.umwelten/completions` otherwise (bare `umwelten run` outside a repo).
 */
export function resolveCompletionsDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  if (env.UMWELTEN_COMPLETIONS_DIR) return env.UMWELTEN_COMPLETIONS_DIR;
  if (existsSync(join(cwd, ".umwelten")) || existsSync(join(cwd, ".git"))) {
    return join(cwd, ".umwelten", "completions");
  }
  return join(homedir(), ".umwelten", "completions");
}

let defaultSink: CompletionSink | undefined;

/**
 * Process-wide default sink, resolved once.
 *
 * Disabled (`NullCompletionSink`) when `UMWELTEN_TRACE=0`, or when running
 * under vitest without an explicit `UMWELTEN_COMPLETIONS_DIR` — unit tests
 * drive the runner with mocked providers and must not litter the repo.
 */
export function getDefaultCompletionSink(env: NodeJS.ProcessEnv = process.env): CompletionSink {
  if (!defaultSink) {
    defaultSink = resolveSinkFromEnv(env);
  }
  return defaultSink;
}

/** Pure: pick the sink implied by an environment. Exported for tests. */
export function resolveSinkFromEnv(env: NodeJS.ProcessEnv): CompletionSink {
  const disabled =
    env.UMWELTEN_TRACE === "0" || (env.VITEST && !env.UMWELTEN_COMPLETIONS_DIR);
  return disabled
    ? new NullCompletionSink()
    : new JsonlCompletionSink(resolveCompletionsDir(env));
}

/** Replace the process-wide default (tests, embedders). Pass undefined to re-resolve lazily. */
export function setDefaultCompletionSink(sink: CompletionSink | undefined): void {
  defaultSink = sink;
}
