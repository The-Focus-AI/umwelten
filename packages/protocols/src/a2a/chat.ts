/**
 * Habitat HTTP/SSE chat client.
 *
 * Talks to a habitat's `/api/chat` endpoint (Vercel-AI-SDK SSE stream) and
 * `/health` endpoint. Used by the CLI's `umwelten habitat chat` and any other
 * tool that wants to drive a remote habitat over HTTP.
 *
 * `a2aChat({ url, token, prompt })` runs a one-shot or REPL session.
 * `fetchJson` / `truncateJson` / `discoverToken` are exported for callers that
 * need finer control.
 */

import http from "node:http";
import https from "node:https";
import { createInterface } from "node:readline";

export interface A2AChatOptions {
	url: string;
	token?: string;
	/** If set, send this prompt one-shot and return; otherwise run REPL. */
	prompt?: string;
	/** Override stdout writer (defaults to process.stdout.write). */
	write?: (s: string) => void;
}

export function truncateJson(input: unknown, max: number): string {
	const s = typeof input === "string" ? input : JSON.stringify(input);
	return s.length > max ? s.slice(0, max) + "..." : s;
}

export function fetchJson(url: string, token?: string): Promise<any> {
	const parsed = new URL(url);
	const reqModule = parsed.protocol === "https:" ? https : http;
	const headers: Record<string, string> = { accept: "application/json" };
	if (token) headers.authorization = `Bearer ${token}`;
	return new Promise((resolve, reject) => {
		reqModule
			.get(
				{
					hostname: parsed.hostname,
					port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
					path: parsed.pathname + parsed.search,
					headers,
				},
				(res: any) => {
					let data = "";
					res.on("data", (c: string) => (data += c));
					res.on("end", () => {
						try {
							resolve(JSON.parse(data));
						} catch {
							reject(new Error(`Invalid JSON from ${url}`));
						}
					});
				},
			)
			.on("error", reject);
	});
}

/**
 * Auto-discover a habitat's API key from a Gaia registry file.
 * Looks for `gaia-data/registry.json` (or `registry.json`) in the cwd and
 * matches by container port.
 */
export async function discoverToken(
	baseUrl: string,
): Promise<string | undefined> {
	const { readFile } = await import("node:fs/promises");
	const { resolve: resolvePath } = await import("node:path");

	const candidates = [
		resolvePath("gaia-data", "registry.json"),
		resolvePath("registry.json"),
	];
	const parsed = new URL(baseUrl);
	const port = parseInt(parsed.port || "80", 10);

	for (const candidate of candidates) {
		try {
			const raw = await readFile(candidate, "utf-8");
			const registry = JSON.parse(raw);
			const habitats = registry.habitats ?? [];
			const match = habitats.find((h: any) => h.containerPort === port);
			if (match?.apiKey) return match.apiKey;
		} catch {
			// File doesn't exist — try next
		}
	}
	return undefined;
}

interface SendDeps {
	chalk: typeof import("chalk").default;
	createMarkdownChatObserver: typeof import("@umwelten/core/cognition/observers.js")["createMarkdownChatObserver"];
}

async function sendOne(
	baseUrl: string,
	token: string | undefined,
	threadId: string,
	text: string,
	deps: SendDeps,
): Promise<void> {
	const { chalk, createMarkdownChatObserver } = deps;
	const obs = await createMarkdownChatObserver();
	const body = JSON.stringify({
		id: threadId,
		messages: [{ role: "user", content: text }],
	});

	const url = new URL(`${baseUrl}/api/chat`);
	const isHttps = url.protocol === "https:";
	const reqModule = isHttps ? https : http;

	return new Promise<void>((resolve, reject) => {
		const req = reqModule.request(
			{
				hostname: url.hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: url.pathname,
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
			},
			(res) => {
				if (res.statusCode && res.statusCode >= 400) {
					let data = "";
					res.on("data", (c) => (data += c));
					res.on("end", () => {
						console.error(
							chalk.red(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`),
						);
						resolve();
					});
					return;
				}

				let buffer = "";
				res.on("data", (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						if (!line.startsWith("data: ")) continue;
						const payload = line.slice(6).trim();
						if (payload === "[DONE]") continue;
						try {
							const event = JSON.parse(payload);
							switch (event.type) {
								case "text-delta":
									obs.onTextDelta?.(event.delta);
									break;
								case "reasoning-delta":
									process.stdout.write(chalk.dim(event.delta));
									break;
								case "tool-input-available":
									console.log(
										chalk.dim(
											`\n  [tool] ${event.toolName}(${truncateJson(event.input, 80)})`,
										),
									);
									break;
								case "tool-output-available": {
									const out =
										typeof event.output === "string"
											? event.output
											: JSON.stringify(event.output);
									const isErr = !!event.errorText;
									console.log(
										isErr
											? chalk.red(`  [error] ${out.slice(0, 200)}`)
											: chalk.dim(
													`  [result] ${out.slice(0, 200)}${out.length > 200 ? "..." : ""}`,
												),
									);
									break;
								}
								case "error":
									console.error(chalk.red(`  [error] ${event.errorText}`));
									break;
							}
						} catch {
							// Skip unparseable lines
						}
					}
				});
				res.on("end", () => {
					obs.end();
					process.stdout.write("\n");
					resolve();
				});
			},
		);
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

export async function a2aChat(options: A2AChatOptions): Promise<void> {
	const { default: chalk } = await import("chalk");
	const { createMarkdownChatObserver } = await import(
		"@umwelten/core/cognition/observers.js"
	);

	const baseUrl = options.url.replace(/\/+$/, "");
	let token = options.token;
	if (!token) {
		token = await discoverToken(baseUrl);
		if (token) {
			console.log(chalk.dim("(token auto-discovered from gaia registry)"));
		}
	}

	const threadId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

	// Health check
	try {
		const health = await fetchJson(`${baseUrl}/health`, token);
		console.log(
			`Connected to ${chalk.green(health.name ?? "habitat")} (${health.tools ?? "?"} tools, model: ${chalk.cyan(health.model ?? "none")})`,
		);
		if (!health.model) {
			console.log(
				chalk.yellow(
					"Warning: No model configured — the habitat may not respond.",
				),
			);
		}
	} catch (err: any) {
		console.error(chalk.red(`Cannot reach ${baseUrl}: ${err.message}`));
		process.exit(1);
	}

	const deps = { chalk, createMarkdownChatObserver };

	if (options.prompt) {
		await sendOne(baseUrl, token, threadId, options.prompt, deps);
		return;
	}

	console.log(chalk.dim("Type a message, or /quit to exit.\n"));
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const ask = (): void => {
		rl.question(chalk.blue("you> "), async (input) => {
			const trimmed = input.trim();
			if (!trimmed) return ask();
			if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") {
				rl.close();
				return;
			}
			await sendOne(baseUrl, token, threadId, trimmed, deps);
			ask();
		});
	};
	ask();
}
