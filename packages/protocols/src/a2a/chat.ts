/**
 * A2A streaming chat client (CLI-facing).
 *
 * Connects to any A2A-speaking agent (e.g. a `umwelten habitat serve` container,
 * a Gaia-managed container, or any third-party A2A server), discovers it via
 * its `/.well-known/agent-card.json`, and drives a one-shot or REPL chat over
 * `message/stream` JSON-RPC.
 *
 * `a2aChat({ url, token, prompt })` runs a one-shot or REPL session.
 * `fetchJson` / `truncateJson` / `discoverToken` are exported for callers that
 * need finer control.
 */

import http from "node:http";
import https from "node:https";
import { createInterface } from "node:readline";
import type { FilePart } from "@a2a-js/sdk";
import { streamA2AMessage } from "./client.js";

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
}

async function sendOne(
	baseUrl: string,
	token: string | undefined,
	contextId: string,
	text: string,
	deps: SendDeps,
): Promise<void> {
	const { chalk } = deps;

	let printedAnything = false;
	const printDelta = (delta: string): void => {
		if (!delta) return;
		process.stdout.write(delta);
		printedAnything = true;
	};

	try {
		for await (const event of streamA2AMessage({
			endpoint: `${baseUrl}/a2a`,
			text,
			apiKey: token,
			contextId,
		})) {
			switch (event.kind) {
				case "status-update": {
					// Streamed text deltas arrive as `working` status updates whose
					// status.message carries the partial text.
					const parts = event.status?.message?.parts ?? [];
					for (const part of parts) {
						if (part.kind === "text") printDelta(part.text);
					}
					break;
				}
				case "message": {
					// Final consolidated response. The executor publishes incremental
					// text via status-updates first, then a final `message` with the
					// same full text. To avoid double-printing, only emit if nothing
					// has been streamed yet.
					if (!printedAnything) {
						for (const part of event.parts) {
							if (part.kind === "text") printDelta(part.text);
						}
					}
					break;
				}
				case "artifact-update": {
					const artifact = event.artifact;
					const files = artifact.parts
						.filter((p): p is FilePart => p.kind === "file")
						.map((p) => {
							const f = p.file;
							return "uri" in f ? f.uri : (f.name ?? "(inline)");
						});
					console.log(
						chalk.dim(
							`\n  [artifact] ${artifact.name ?? artifact.artifactId}${files.length ? ` → ${files.join(", ")}` : ""}`,
						),
					);
					break;
				}
				case "task":
					// Initial task acknowledgement; nothing to render.
					break;
			}
		}
	} catch (err: any) {
		console.error(chalk.red(`\nA2A error: ${err.message ?? err}`));
	}

	process.stdout.write("\n");
}

export async function a2aChat(options: A2AChatOptions): Promise<void> {
	const { default: chalk } = await import("chalk");
	const { fetchAgentCard } = await import("./client.js");

	const baseUrl = options.url.replace(/\/+$/, "");
	let token = options.token;
	if (!token) {
		token = await discoverToken(baseUrl);
		if (token) {
			console.log(chalk.dim("(token auto-discovered from gaia registry)"));
		}
	}

	// Stable contextId for this CLI session so multi-turn REPL conversations
	// thread into the same habitat session.
	const contextId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

	// Discover the agent via its well-known card.
	const parsedUrl = new URL(baseUrl);
	try {
		const card = await fetchAgentCard({
			host: parsedUrl.hostname,
			port: parseInt(
				parsedUrl.port ||
					(parsedUrl.protocol === "https:" ? "443" : "80"),
				10,
			),
		});
		const skillCount = card.skills?.length ?? 0;
		console.log(
			`Connected to ${chalk.green(card.name)} (${skillCount} skill${skillCount === 1 ? "" : "s"}${card.version ? `, version ${card.version}` : ""})`,
		);
		if (card.description) {
			console.log(chalk.dim(card.description));
		}
	} catch (err: any) {
		console.error(
			chalk.red(`Cannot reach A2A agent at ${baseUrl}: ${err.message ?? err}`),
		);
		process.exit(1);
	}

	const deps = { chalk };

	if (options.prompt) {
		await sendOne(baseUrl, token, contextId, options.prompt, deps);
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
			await sendOne(baseUrl, token, contextId, trimmed, deps);
			ask();
		});
	};
	ask();
}
