/**
 * Generic CLI Runtime Runner
 *
 * Turns any headless coding-agent CLI — codex, opencode, aider, anything a
 * project's mise.toml can install — into a bridge RuntimeRunner, declared in
 * config.json under `runtimes` instead of hand-writing a runner per tool
 * (the claude-sdk and pi runners remain the rich built-ins).
 *
 * Credential posture ("pass the right keys, not the vault"): the subprocess
 * env starts from the container env with every habitat-store secret scrubbed,
 * then only the secrets the spec declares are re-added. OAuth-file CLIs
 * (codex ChatGPT-plan auth.json) get their token materialized to disk via
 * `files` entries — written 0600 once, never overwriting a login done inside
 * the container.
 *
 * Hard rule: no output-token caps anywhere in this runner.
 */

import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	BridgeEventHandlers,
	RuntimeContext,
	RuntimeResult,
	RuntimeRunner,
} from "./bridge/types.js";
import type { RuntimeOutputParser, RuntimeSpec } from "./types.js";

/** What a runner needs from the habitat to build a scoped env. */
export interface RuntimeSecretSource {
	getSecret(name: string): string | undefined;
	listSecretNames(): string[];
}

// ── Presets ───────────────────────────────────────────────────────────

/**
 * Built-in specs so `"runtimes": { "codex": true }` is a complete
 * declaration. Config fields merge over the preset (explicit wins).
 *
 * codex: `exec --json` is the non-interactive JSONL mode. Approvals and
 * codex's own sandbox are bypassed because the habitat container IS the
 * sandbox — the same posture as the claude-sdk runner's permissionMode
 * "auto". Auth is OPENAI_API_KEY, or a ChatGPT-plan auth.json seeded from
 * the CODEX_AUTH_JSON secret into $CODEX_HOME.
 */
export const RUNTIME_PRESETS: Record<string, RuntimeSpec> = {
	codex: {
		command: "codex",
		args: [
			"exec",
			"--json",
			"--skip-git-repo-check",
			"--dangerously-bypass-approvals-and-sandbox",
			"--cd",
			"{cwd}",
			"{prompt}",
		],
		parser: "codex-json",
		secrets: ["OPENAI_API_KEY"],
		files: [
			{
				path: join(
					process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
					"auth.json",
				),
				secret: "CODEX_AUTH_JSON",
			},
		],
	},
};

/**
 * Resolve a config `runtimes` entry (possibly `true` or a partial spec)
 * against the matching preset. Returns undefined when no runnable spec
 * results (no command anywhere) — callers warn and skip.
 */
export function resolveRuntimeSpec(
	name: string,
	config: Partial<RuntimeSpec> | true,
): RuntimeSpec | undefined {
	const preset = RUNTIME_PRESETS[name];
	const overrides: Partial<RuntimeSpec> = config === true ? {} : config;
	const merged: Partial<RuntimeSpec> = { ...preset, ...overrides };
	if (!merged.command?.trim()) return undefined;
	return merged as RuntimeSpec;
}

// ── Env + credential files ────────────────────────────────────────────

/**
 * Build the subprocess env: container env with every habitat-store secret
 * removed, the spec's declared secrets re-added, then literal spec.env
 * ({cwd} substituted). PATH/HOME/etc. pass through untouched.
 *
 * Scope note: this scrubs the habitat secret STORE (secrets.json keys,
 * which Habitat.create injects into process.env). Env vars that only ever
 * existed as container env (e.g. Gaia's GITHUB_TOKEN --env) pass through.
 */
export function buildRuntimeEnv(
	spec: RuntimeSpec,
	secrets: RuntimeSecretSource,
	cwd: string,
): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...process.env };
	for (const name of secrets.listSecretNames()) {
		delete env[name];
	}
	for (const name of spec.secrets ?? []) {
		const value = secrets.getSecret(name);
		if (value !== undefined) env[name] = value;
	}
	for (const [key, value] of Object.entries(spec.env ?? {})) {
		env[key] = value.replaceAll("{cwd}", cwd);
	}
	return env;
}

/**
 * Write secret-backed credential files (0600, dirs created) before a run.
 * Skips when the secret is unset or the file already exists — a login done
 * inside the container always wins over the seeded copy.
 */
export async function materializeCredentialFiles(
	spec: RuntimeSpec,
	secrets: RuntimeSecretSource,
	cwd: string,
): Promise<void> {
	for (const file of spec.files ?? []) {
		const value = secrets.getSecret(file.secret);
		if (value === undefined) continue;
		const path = file.path.replaceAll("{cwd}", cwd);
		if (existsSync(path)) continue;
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, value, { mode: 0o600 });
	}
}

// ── Arg templating ────────────────────────────────────────────────────

/**
 * Substitute {prompt}/{cwd} in the spec args; append the prompt as the
 * final argument when no arg referenced it. With `mise: true` the whole
 * invocation is wrapped in `mise x -- …` so the project's mise.toml
 * resolves the tool.
 */
export function buildInvocation(
	spec: RuntimeSpec,
	prompt: string,
	cwd: string,
): { command: string; args: string[] } {
	let sawPrompt = false;
	const rendered = (spec.args ?? []).map((arg) => {
		if (arg.includes("{prompt}")) sawPrompt = true;
		return arg.replaceAll("{prompt}", prompt).replaceAll("{cwd}", cwd);
	});
	if (!sawPrompt) rendered.push(prompt);
	if (spec.mise) {
		return { command: "mise", args: ["x", "--", spec.command, ...rendered] };
	}
	return { command: spec.command, args: rendered };
}

// ── Output parsing ────────────────────────────────────────────────────

export interface CliProgress {
	type: "text" | "reasoning" | "tool_use" | "tool_result";
	content: string;
	toolName?: string;
	input?: unknown;
	isError?: boolean;
}

interface CliStreamState {
	/** Native session id when the parser can extract one (codex thread_id). */
	sessionId?: string;
	finalText: string;
	/** Raw stdout accumulator for the text parser. */
	rawStdout: string;
	errors: string[];
}

/**
 * Handle one codex `--json` JSONL event (thread.started / item.* /
 * turn.*). Items: agent_message → final text, reasoning → reasoning
 * stream, command_execution → tool events.
 */
function handleCodexEvent(
	event: Record<string, unknown>,
	state: CliStreamState,
	onProgress?: (update: CliProgress) => void,
): void {
	switch (event.type) {
		case "thread.started": {
			if (typeof event.thread_id === "string") state.sessionId = event.thread_id;
			break;
		}
		case "item.started": {
			const item = event.item as Record<string, unknown> | undefined;
			if (item?.type === "command_execution" && typeof item.command === "string") {
				onProgress?.({
					type: "tool_use",
					content: `Running ${item.command}`,
					toolName: "shell",
					input: { command: item.command },
				});
			}
			break;
		}
		case "item.completed": {
			const item = event.item as Record<string, unknown> | undefined;
			if (!item) break;
			if (item.type === "agent_message" && typeof item.text === "string") {
				state.finalText = item.text;
				onProgress?.({ type: "text", content: item.text });
			} else if (item.type === "reasoning" && typeof item.text === "string") {
				onProgress?.({ type: "reasoning", content: item.text });
			} else if (item.type === "command_execution") {
				onProgress?.({
					type: "tool_result",
					content:
						typeof item.aggregated_output === "string"
							? item.aggregated_output
							: "",
					toolName: "shell",
					isError:
						typeof item.exit_code === "number" && item.exit_code !== 0,
				});
			}
			break;
		}
		case "turn.failed": {
			const error = event.error as { message?: unknown } | undefined;
			state.errors.push(
				typeof error?.message === "string" ? error.message : "codex turn failed",
			);
			break;
		}
		case "error": {
			if (typeof event.message === "string") state.errors.push(event.message);
			break;
		}
	}
}

/**
 * Where codex wrote the native session JSONL: $CODEX_HOME/sessions (or
 * ~/.codex/sessions) is date-sharded (YYYY/MM/DD/rollout-…-<threadId>.jsonl)
 * with the timestamp in the filename, so the path is found by a bounded
 * walk rather than derived. Best-effort — undefined when not found.
 */
export async function findCodexSessionPath(
	threadId: string,
	env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
	const base = env.CODEX_HOME?.trim() || join(homedir(), ".codex");
	const root = join(base, "sessions");
	const walk = async (dir: string, depth: number): Promise<string | undefined> => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return undefined;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isFile() && entry.name.includes(threadId)) return full;
			if (entry.isDirectory() && depth > 0) {
				const found = await walk(full, depth - 1);
				if (found) return found;
			}
		}
		return undefined;
	};
	return walk(root, 4);
}

// ── Runner ────────────────────────────────────────────────────────────

export interface CliRunOptions {
	/** The resolved runtime spec (command/args/parser). */
	spec: RuntimeSpec;
	/** Working directory (the agent's projectPath). */
	cwd: string;
	/** Fully-built subprocess env (see buildRuntimeEnv). */
	env?: Record<string, string | undefined>;
	/** Callback for streaming progress updates. */
	onProgress?: (update: CliProgress) => void;
	/** Injectable spawn for tests. */
	spawnFn?: typeof spawn;
}

export interface CliRunResult {
	/** Final assistant text. */
	content: string;
	/** Whether the run completed successfully (exit 0, no fatal events). */
	success: boolean;
	/** Error details when success is false. */
	errors: string[];
	/** Native session id when the parser extracted one. */
	sessionId?: string;
	/** Absolute path to the native session log, when discoverable. */
	sessionPath?: string;
}

/**
 * Run a prompt through a config-declared CLI runtime. Resolves on process
 * exit — missing binaries and non-zero exits resolve to
 * `{ success: false, errors: [...] }` rather than throwing or hanging.
 */
export function runCliAgent(
	prompt: string,
	options: CliRunOptions,
): Promise<CliRunResult> {
	const { spec, cwd } = options;
	const spawnFn = options.spawnFn ?? spawn;
	const parser: RuntimeOutputParser = spec.parser ?? "text";
	const { command, args } = buildInvocation(spec, prompt, cwd);

	return new Promise((resolve) => {
		const state: CliStreamState = { finalText: "", rawStdout: "", errors: [] };
		let stdoutBuffer = "";
		let stderrTail = "";

		const proc = spawnFn(command, args, {
			cwd,
			env: options.env ?? process.env,
			// stdin ignored: prompt goes via argv; a piped-open stdin makes
			// several CLIs (pi, codex) wait for EOF and hang.
			stdio: ["ignore", "pipe", "pipe"],
		});

		const consumeLine = (line: string) => {
			if (parser === "codex-json") {
				const trimmed = line.trim();
				if (!trimmed.startsWith("{")) return; // startup noise
				try {
					const event = JSON.parse(trimmed) as Record<string, unknown>;
					handleCodexEvent(event, state, options.onProgress);
				} catch {
					/* partial or non-JSON line — ignore */
				}
			} else {
				options.onProgress?.({ type: "text", content: line });
			}
		};

		proc.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			if (parser === "text") state.rawStdout += text;
			stdoutBuffer += text;
			let idx = stdoutBuffer.indexOf("\n");
			while (idx !== -1) {
				consumeLine(stdoutBuffer.slice(0, idx));
				stdoutBuffer = stdoutBuffer.slice(idx + 1);
				idx = stdoutBuffer.indexOf("\n");
			}
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString()).slice(-2000);
		});

		const finish = async (success: boolean, errors: string[]) => {
			const content =
				parser === "text" ? state.rawStdout.trim() : state.finalText;
			const sessionPath =
				parser === "codex-json" && state.sessionId
					? await findCodexSessionPath(state.sessionId, options.env)
					: undefined;
			resolve({
				content,
				success,
				errors,
				sessionId: state.sessionId,
				sessionPath,
			});
		};

		proc.on("error", (err: NodeJS.ErrnoException) => {
			const hint =
				err.code === "ENOENT"
					? `"${command}" not found on PATH — install it in the image, or declare it in the project's mise.toml and set "mise": true on the runtime.`
					: `Failed to spawn ${command}: ${err.message}`;
			void finish(false, [hint]);
		});

		proc.on("close", (code: number | null) => {
			if (stdoutBuffer) consumeLine(stdoutBuffer);
			if (code === 0 && state.errors.length === 0) {
				void finish(true, []);
			} else {
				const errors = [...state.errors];
				if (code !== 0) {
					errors.push(
						`${command} exited with code ${code ?? "null"}${stderrTail ? `: ${stderrTail.trim()}` : ""}`,
					);
				}
				void finish(false, errors);
			}
		});
	});
}

// ── RuntimeRunner adapter ─────────────────────────────────────────────

/**
 * Adapt a config-declared spec to the bridge's RuntimeRunner contract:
 * scoped env, credential files, progress → bridge events, and a
 * nativeSessionRef when the parser surfaced a session.
 *
 * `runFn` is injectable for tests; production uses runCliAgent.
 */
export function createCliRuntimeRunner(
	name: string,
	spec: RuntimeSpec,
	secrets: RuntimeSecretSource,
	runFn: typeof runCliAgent = runCliAgent,
): RuntimeRunner {
	return {
		async run(
			prompt: string,
			ctx: RuntimeContext,
			events: BridgeEventHandlers,
		): Promise<RuntimeResult> {
			const cwd = ctx.agent.projectPath;
			const env = buildRuntimeEnv(spec, secrets, cwd);
			try {
				await materializeCredentialFiles(spec, secrets, cwd);
			} catch (err) {
				// Non-fatal: the CLI may still auth via env.
				console.warn(
					`[cli-runner:${name}] credential file write failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			const result = await runFn(prompt, {
				spec,
				cwd,
				env,
				onProgress: (update) => {
					if (update.type === "text") {
						events.onText?.(update.content);
					} else if (update.type === "reasoning") {
						events.onReasoning?.(update.content);
					} else if (update.type === "tool_use" && update.toolName) {
						events.onToolCall?.(update.toolName, update.input);
					} else if (update.type === "tool_result" && update.toolName) {
						events.onToolResult?.(
							update.toolName,
							update.content,
							update.isError === true,
						);
					}
				},
			});

			return {
				content: result.content,
				success: result.success,
				errors: result.errors.length ? result.errors : undefined,
				nativeSessionRef:
					result.sessionId && result.sessionPath
						? {
								runtime: name,
								nativeSessionId: result.sessionId,
								nativeSessionPath: result.sessionPath,
							}
						: undefined,
			};
		},
	};
}

// ── Config wiring ─────────────────────────────────────────────────────

/** The slice of Habitat this module needs (config + secret store). */
export interface RuntimeConfigSource extends RuntimeSecretSource {
	getConfig(): { runtimes?: Record<string, Partial<RuntimeSpec> | true> };
}

/**
 * Build RuntimeRunners for every config-declared runtime. Invalid entries
 * (reserved name, no command and no preset) warn and are skipped — one bad
 * declaration never blocks the server. Spread AFTER the built-ins so a
 * config-declared `pi`/`claude-sdk` overrides them by name.
 */
export function buildConfiguredRuntimeRunners(
	habitat: RuntimeConfigSource,
): Record<string, RuntimeRunner> {
	const runners: Record<string, RuntimeRunner> = {};
	const declared = habitat.getConfig().runtimes ?? {};
	for (const [name, config] of Object.entries(declared)) {
		if (name === "default") {
			console.warn(
				'[cli-runner] "default" is the base Interaction loop and cannot be redeclared — skipping.',
			);
			continue;
		}
		const spec = resolveRuntimeSpec(name, config);
		if (!spec) {
			console.warn(
				`[cli-runner] runtime "${name}" has no command and no preset — skipping.`,
			);
			continue;
		}
		runners[name] = createCliRuntimeRunner(name, spec, habitat);
	}
	return runners;
}
