#!/usr/bin/env node
/**
 * Smoke test for the provider-specific usage cascade in
 * `packages/core/src/cognition/usage-extractor.ts` (extracted from
 * runner.ts in commit a64a5de, Wave D).
 *
 * For each cascade-relevant provider, drives the real
 * `BaseModelRunner` through BOTH `generateText` and `streamText`
 * and reports:
 *   - content non-empty
 *   - tokenUsage.promptTokens > 0
 *   - tokenUsage.completionTokens > 0
 *   - cost-calculation shape sane
 *
 * Why both paths: as of this writing, the AI SDK's streamText
 * adapter for MiniMax and GitHub Models returns shaped-but-
 * undefined usage (keys present, every value undefined). The
 * runner's `normalizeTokenUsage` correctly returns null for that
 * shape (emitting a "usage not available" warning rather than
 * silently writing zeros to disk) — but the streamText cells in
 * this report will show "no-usage" for those providers until the
 * underlying SDK adapter is fixed. The generateText path works
 * for every provider tested.
 *
 * Cost: roughly $0.0002 per run for the paid providers (2 calls
 * each). Skip with CASCADE_SKIP=google,openrouter. Local providers
 * are skipped automatically when their server isn't reachable.
 *
 * Run: dotenvx run -- pnpm smoke:cascade
 */

import { Interaction } from "../packages/core/src/interaction/core/interaction.js";
import { Stimulus } from "../packages/core/src/stimulus/stimulus.js";
import { BaseModelRunner } from "../packages/core/src/cognition/runner.js";
import type { ModelDetails, ModelResponse } from "../packages/core/src/cognition/types.js";
import "../packages/core/src/env/load.js";

interface Target {
	provider: string;
	model: string;
	requiresKey?: string;
	localUrl?: string;
}

const TARGETS: Target[] = [
	{ provider: "google", model: "gemini-3-flash-preview", requiresKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
	{ provider: "openrouter", model: "openai/gpt-5.4-nano", requiresKey: "OPENROUTER_API_KEY" },
	{ provider: "minimax", model: "MiniMax-M2.5", requiresKey: "MINIMAX_API_KEY" },
	{ provider: "github-models", model: "openai/gpt-4o-mini", requiresKey: "GITHUB_TOKEN" },
	{ provider: "ollama", model: "gemma4:e4b", localUrl: "http://localhost:11434/api/tags" },
];

// Known-empty: providers whose streamText path returns shaped-but-
// undefined usage. Empty now — minimax and github-models were fixed
// by passing `includeUsage: true` to createOpenAICompatible in their
// provider modules. Keep this set as the escape hatch: if a future
// AI-SDK upgrade or new provider regresses, add the provider name
// here so the smoke test stays honest about the partial coverage.
const STREAM_NO_USAGE_EXPECTED = new Set<string>();

const SKIP = new Set(
	(process.env.CASCADE_SKIP ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean),
);

const PROMPT = "Reply with the single word 'ok' and nothing else.";

type Path = "generateText" | "streamText";

interface CellResult {
	status: "ok" | "skip" | "fail" | "no-usage-expected";
	note: string;
}

async function isReachable(url: string): Promise<boolean> {
	try {
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), 2000);
		const res = await fetch(url, { signal: ac.signal });
		clearTimeout(timer);
		return res.ok;
	} catch {
		return false;
	}
}

function buildInteraction(target: Target) {
	const stimulus = new Stimulus({ role: "concise assistant" });
	const model: ModelDetails = { name: target.model, provider: target.provider };
	const interaction = new Interaction(model, stimulus);
	interaction.addMessage({ role: "user", content: PROMPT });
	return interaction;
}

function evaluate(target: Target, path: Path, response: ModelResponse, dt: number): CellResult {
	const usage = response.metadata.tokenUsage;
	const cost = response.metadata.cost;
	const hasContent = !!response.content && response.content.trim().length > 0;
	const hasTokens = usage.promptTokens > 0 && usage.completionTokens > 0;

	if (!hasContent) {
		return { status: "fail", note: "empty content" };
	}
	if (!hasTokens) {
		if (path === "streamText" && STREAM_NO_USAGE_EXPECTED.has(target.provider)) {
			return {
				status: "no-usage-expected",
				note: `0+0 (SDK limitation: ${target.provider} streamText returns shaped-but-undefined usage)`,
			};
		}
		return {
			status: "fail",
			note: `promptTokens=${usage.promptTokens}, completionTokens=${usage.completionTokens}`,
		};
	}

	const total = usage.promptTokens + usage.completionTokens;
	const costStr = cost?.totalCost != null ? `$${cost.totalCost.toFixed(6)}` : "n/a";
	return {
		status: "ok",
		note: `tokens ${usage.promptTokens}+${usage.completionTokens}=${total}, cost ${costStr}, ${dt}ms`,
	};
}

async function smokeProvider(target: Target): Promise<{ generateText: CellResult; streamText: CellResult }> {
	if (SKIP.has(target.provider)) {
		const skip: CellResult = { status: "skip", note: "CASCADE_SKIP" };
		return { generateText: skip, streamText: skip };
	}
	if (target.requiresKey && !process.env[target.requiresKey]) {
		const skip: CellResult = { status: "skip", note: `no ${target.requiresKey}` };
		return { generateText: skip, streamText: skip };
	}
	if (target.localUrl && !(await isReachable(target.localUrl))) {
		const skip: CellResult = { status: "skip", note: `${target.localUrl} unreachable` };
		return { generateText: skip, streamText: skip };
	}

	const runner = new BaseModelRunner();

	let generateText: CellResult;
	try {
		const interaction = buildInteraction(target);
		const t0 = Date.now();
		const response = await runner.generateText(interaction);
		generateText = evaluate(target, "generateText", response, Date.now() - t0);
	} catch (e) {
		generateText = { status: "fail", note: e instanceof Error ? e.message : String(e) };
	}

	let streamText: CellResult;
	try {
		const interaction = buildInteraction(target);
		const t0 = Date.now();
		const response = await runner.streamText(interaction);
		streamText = evaluate(target, "streamText", response, Date.now() - t0);
	} catch (e) {
		streamText = { status: "fail", note: e instanceof Error ? e.message : String(e) };
	}

	return { generateText, streamText };
}

const ICON: Record<CellResult["status"], string> = {
	ok: "✅",
	skip: "⏭ ",
	fail: "❌",
	"no-usage-expected": "⚠️ ",
};

async function run() {
	console.log("\n🔌 Cascade smoke test\n");
	console.log(`  Prompt: ${JSON.stringify(PROMPT)}\n`);

	let totals = { ok: 0, skip: 0, fail: 0, expected: 0 };
	const failures: string[] = [];

	for (const target of TARGETS) {
		const id = `${target.provider}:${target.model}`;
		console.log(`  ${id}`);
		const { generateText, streamText } = await smokeProvider(target);
		console.log(`    generateText  ${ICON[generateText.status]} ${generateText.note}`);
		console.log(`    streamText    ${ICON[streamText.status]} ${streamText.note}`);
		for (const [path, r] of Object.entries({ generateText, streamText })) {
			if (r.status === "ok") totals.ok++;
			else if (r.status === "skip") totals.skip++;
			else if (r.status === "no-usage-expected") totals.expected++;
			else {
				totals.fail++;
				failures.push(`${id} (${path}): ${r.note}`);
			}
		}
	}

	console.log(
		`\n  Totals: ${totals.ok} ok, ${totals.skip} skipped, ${totals.expected} no-usage-expected, ${totals.fail} unexpected failures\n`,
	);

	if (failures.length > 0) {
		console.error("Unexpected failures:");
		for (const f of failures) console.error(`  - ${f}`);
		process.exit(1);
	}
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
