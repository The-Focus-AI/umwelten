/**
 * Terminal plumbing shared by quiz.ts and reconnect.ts: colors, a promise
 * based prompt, and a small flag parser. Kept dependency-free so the example
 * runs with nothing but the workspace packages.
 */

import readline from "node:readline/promises";

const wrap = (code: string) => (t: string) => `\x1b[${code}m${t}\x1b[0m`;

export const cyan = wrap("1;36");
export const green = wrap("1;32");
export const yellow = wrap("1;33");
export const magenta = wrap("1;35");
export const red = wrap("1;31");
export const dim = wrap("2");
export const bold = wrap("1");

/**
 * Report a failed run as a message rather than a stack trace. Missing API
 * keys and missing profiles are the two common ways these scripts stop, and
 * neither is a bug worth a traceback.
 */
export function die(err: unknown): void {
  console.error(`\n${red(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
}

/** Distinct colors for participants, assigned by roster position. */
export const SPEAKER_COLORS = [cyan, green, magenta, yellow];

export interface Prompter {
  ask(prompt: string): Promise<string>;
  close(): void;
}

export function createPrompter(): Prompter {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    ask: (prompt: string) => rl.question(prompt),
    close: () => rl.close(),
  };
}

export type Flags = Record<string, string | boolean>;

/**
 * Parse `--flag value`, `--flag=value`, `--flag` (true) and `--no-flag`
 * (false).
 *
 * A flag claims the next token unless that token starts with `--`, so a bare
 * boolean flag must not be followed by a bare word. Neither script here takes
 * positional arguments, so that never comes up; anything not attached to a
 * flag is ignored rather than silently misread as one.
 */
export function parseFlags(argv: string[]): { flags: Flags } {
  const flags: Flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (body.startsWith("no-")) {
      flags[body.slice(3)] = false;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }

  return { flags };
}

export function flagString(
  flags: Flags,
  name: string,
  fallback: string,
): string {
  const value = flags[name];
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function flagBool(
  flags: Flags,
  name: string,
  fallback: boolean,
): boolean {
  const value = flags[name];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "false" && value !== "0";
  return fallback;
}

export function flagNumber(
  flags: Flags,
  name: string,
  fallback: number | undefined,
): number | undefined {
  const value = flags[name];
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --${name} "${value}" — expected a number.`);
  }
  return parsed;
}
