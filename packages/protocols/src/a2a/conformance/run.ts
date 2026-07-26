#!/usr/bin/env tsx
/**
 * Run the conformance suite against an A2A agent by address.
 *
 * This is the second target of the fixture set (#274): the same cases the unit
 * suite runs in-process, pointed at a habitat that is actually running — in a
 * container, behind Gaia, wherever.
 *
 * ```bash
 * # A habitat, with the two lifecycle states a model-backed agent can produce
 * pnpm tsx packages/protocols/src/a2a/conformance/run.ts \
 *   --url http://127.0.0.1:7440 --token "$HABITAT_API_KEY" \
 *   --prompt-slow "Count to 10000 out loud, one number per line."
 *
 * # Include the durability cases by telling the harness how to bounce it
 * pnpm tsx packages/protocols/src/a2a/conformance/run.ts \
 *   --url http://127.0.0.1:7440 --restart-cmd "docker restart habitat-ops"
 *
 * # An agent running the scripted executor can be driven through everything
 * pnpm tsx packages/protocols/src/a2a/conformance/run.ts --url ... --scripted
 * ```
 *
 * Exit code is 1 iff a case failed. Skips do not fail the run — they are
 * printed, because "we did not test that" is information, not a pass.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createHttpConformanceSubject } from "./http-subject.js";
import { formatConformanceReport, runA2AConformance } from "./runner.js";
import { CONFORMANCE_DIRECTIVES } from "./scripted-agent.js";
import type { ConformanceIntent } from "./types.js";

const execAsync = promisify(exec);

const USAGE = `Usage: tsx run.ts --url <agent-url> [options]

  --url <url>              Agent base URL or full /a2a endpoint (required)
  --token <bearer>         Bearer token, if the agent enforces one
  --scripted               Drive with the scripted agent's directives
  --prompt-quick <text>    Text that makes the agent answer promptly
  --prompt-slow <text>     Text that keeps it working until cancelled
  --prompt-fail <text>     Text that makes a run fail
  --prompt-reject <text>   Text the agent refuses outright
  --prompt-input <text>    Text that leaves it waiting for input
  --restart-cmd <cmd>      Shell command that stops and starts the agent;
                           enables the durability and sweep cases
  --restart-timeout <ms>   How long to wait for it to answer again (60000)
  --only <id,id>           Run only these case ids
  --timeout <ms>           Per-wait timeout for a Task to move (15000)
  --json                   Print the report as JSON
  --help`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
	const args: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith("--")) {
			args[key] = next;
			i++;
		} else {
			args[key] = true;
		}
	}
	return args;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/**
 * Wait for the agent to serve its card again after a restart. The card is the
 * readiness signal rather than the port: a container that is listening but has
 * not finished its boot sweep would answer `tasks/get` from a half-recovered
 * store.
 */
async function waitForAgent(url: string, timeoutMs: number): Promise<void> {
	const cardUrl = new URL("/.well-known/agent-card.json", url).toString();
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	for (;;) {
		try {
			const res = await fetch(cardUrl, { headers: { accept: "application/json" } });
			if (res.ok) return;
			lastError = new Error(`agent card responded ${res.status}`);
		} catch (err) {
			lastError = err;
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`agent did not come back within ${timeoutMs}ms: ${
					lastError instanceof Error ? lastError.message : String(lastError)
				}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (args.help || !args.url || typeof args.url !== "string") {
		console.log(USAGE);
		process.exit(args.help ? 0 : 1);
	}

	const url = args.url;
	const restartCmd = stringOrNull(args["restart-cmd"]);
	const restartTimeoutMs = Number(args["restart-timeout"] ?? 60_000);

	// A model-backed agent answers when asked and can be cancelled mid-answer.
	// Everything else it has to be told how to do, or the case is skipped.
	const prompts: Partial<Record<ConformanceIntent, string | null>> = args.scripted
		? { ...CONFORMANCE_DIRECTIVES }
		: {
				quick:
					stringOrNull(args["prompt-quick"]) ??
					"Reply with exactly the word: ok",
				slow: stringOrNull(args["prompt-slow"]),
				fail: stringOrNull(args["prompt-fail"]),
				reject: stringOrNull(args["prompt-reject"]),
				"input-required": stringOrNull(args["prompt-input"]),
			};

	const subject = createHttpConformanceSubject({
		endpoint: url,
		name: url,
		...(typeof args.token === "string" ? { apiKey: args.token } : {}),
		prompts,
		settleTimeoutMs: Number(args.timeout ?? 15_000),
		...(restartCmd
			? {
					restart: async () => {
						await execAsync(restartCmd);
						await waitForAgent(url, restartTimeoutMs);
					},
				}
			: {}),
	});

	const report = await runA2AConformance(subject, {
		...(typeof args.only === "string"
			? { only: args.only.split(",").map((id) => id.trim()) }
			: {}),
	});

	console.log(args.json ? JSON.stringify(report, null, 2) : formatConformanceReport(report));
	process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
