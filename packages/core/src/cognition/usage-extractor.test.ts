import { describe, it, expect } from "vitest";
import { extractStreamUsage, normalizeTokenUsage } from "./usage-extractor.js";

/**
 * Unit tests for the provider-specific usage cascade extracted from
 * runner.ts:402-551 in commit a64a5de (Wave D extraction).
 *
 * Each test builds a response object shaped like what the AI SDK
 * actually returns for that provider, then asserts the cascade
 * picks the right usage object. These tests pin the contract so
 * an AI-SDK upgrade that changes the proxy/getter shape will fail
 * loudly here instead of silently zeroing every benchmark.
 */

describe("extractStreamUsage", () => {
	describe("ollama", () => {
		it("extracts from _totalUsage.status.value (streaming)", async () => {
			const response = {
				_totalUsage: {
					status: {
						value: { promptTokens: 17, completionTokens: 42, totalTokens: 59 },
					},
				},
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "ollama");
			expect(usage).toEqual({ promptTokens: 17, completionTokens: 42, totalTokens: 59 });
		});

		it("falls back to steps[0].usage for non-streaming responses", async () => {
			const response = {
				steps: [{ usage: { promptTokens: 11, completionTokens: 22 } }],
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "ollama");
			expect(usage).toEqual({ promptTokens: 11, completionTokens: 22 });
		});

		it("awaits steps when it's a Promise", async () => {
			const response = {
				steps: Promise.resolve([{ usage: { promptTokens: 5, completionTokens: 9 } }]),
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "ollama");
			expect(usage).toEqual({ promptTokens: 5, completionTokens: 9 });
		});

		it("returns the initialUsage when neither _totalUsage nor steps fire", async () => {
			const response = { usage: undefined };
			const seed = { promptTokens: 1, completionTokens: 2 };
			const usage = await extractStreamUsage(response, seed, "ollama");
			expect(usage).toBe(seed);
		});
	});

	describe("openrouter / minimax / google", () => {
		const providers = ["openrouter", "minimax", "google"] as const;

		for (const provider of providers) {
			it(`[${provider}] extracts from _totalUsage.status.value`, async () => {
				const response = {
					_totalUsage: {
						status: {
							value: { inputTokens: 54, outputTokens: 12, totalTokens: 66 },
						},
					},
					usage: undefined,
				};
				const usage = await extractStreamUsage(response, undefined, provider);
				expect(usage).toEqual({ inputTokens: 54, outputTokens: 12, totalTokens: 66 });
			});

			it(`[${provider}] awaits _totalUsage when it's a Promise`, async () => {
				const response = {
					_totalUsage: Promise.resolve({
						status: { value: { inputTokens: 3, outputTokens: 7 } },
					}),
					usage: undefined,
				};
				const usage = await extractStreamUsage(response, undefined, provider);
				expect(usage).toEqual({ inputTokens: 3, outputTokens: 7 });
			});

			it(`[${provider}] falls back to _steps[0].usage when _totalUsage is empty`, async () => {
				const response = {
					_totalUsage: { status: { value: {} } },
					_steps: {
						status: {
							value: [{ usage: { inputTokens: 8, outputTokens: 4 } }],
						},
					},
					usage: undefined,
				};
				const usage = await extractStreamUsage(response, undefined, provider);
				expect(usage).toEqual({ inputTokens: 8, outputTokens: 4 });
			});

			it(`[${provider}] spreads getter-backed usage into a plain object`, async () => {
				// Simulate the proxy/getter shape: defineProperty with getters so
				// JSON.stringify-on-the-original returns {} but spread invokes
				// the getters and recovers the keys.
				const proxy: any = {};
				Object.defineProperty(proxy, "inputTokens", { enumerable: true, get: () => 22 });
				Object.defineProperty(proxy, "outputTokens", { enumerable: true, get: () => 33 });
				const response = {
					_totalUsage: { status: { value: proxy } },
					usage: undefined,
				};
				const usage = await extractStreamUsage(response, undefined, provider);
				expect(usage).toEqual({ inputTokens: 22, outputTokens: 33 });
				expect(Object.keys(usage)).toEqual(["inputTokens", "outputTokens"]);
			});
		}

		it("[google] preserves reasoningTokens when present (the smoke-test shape)", async () => {
			// Mirrors the real gemini-3-flash-preview shape captured in the
			// commit a64a5de smoke test.
			const response = {
				_totalUsage: {
					status: {
						value: {
							inputTokens: 54,
							outputTokens: 1,
							totalTokens: 102,
							reasoningTokens: 47,
							cachedInputTokens: 0,
						},
					},
				},
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "google");
			expect(usage.inputTokens).toBe(54);
			expect(usage.outputTokens).toBe(1);
			expect(usage.totalTokens).toBe(102);
			expect(usage.reasoningTokens).toBe(47);
		});
	});

	describe("github-models", () => {
		it("uses responseAny.usage when present", async () => {
			const response = {
				usage: { promptTokens: 7, completionTokens: 3 },
			};
			const usage = await extractStreamUsage(response, undefined, "github-models");
			expect(usage).toEqual({ promptTokens: 7, completionTokens: 3 });
		});

		it("falls back to usage_stats", async () => {
			const response = {
				usage_stats: { promptTokens: 10, completionTokens: 5 },
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "github-models");
			expect(usage).toEqual({ promptTokens: 10, completionTokens: 5 });
		});

		it("falls back to metadata.usage", async () => {
			const response = {
				metadata: { usage: { promptTokens: 13, completionTokens: 8 } },
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "github-models");
			expect(usage).toEqual({ promptTokens: 13, completionTokens: 8 });
		});

		it("falls back to _totalUsage.status.value", async () => {
			const response = {
				_totalUsage: { status: { value: { promptTokens: 4, completionTokens: 6 } } },
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "github-models");
			expect(usage).toEqual({ promptTokens: 4, completionTokens: 6 });
		});

		it("falls back to _steps[0].usage", async () => {
			const response = {
				_steps: { status: { value: [{ usage: { promptTokens: 2, completionTokens: 9 } }] } },
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "github-models");
			expect(usage).toEqual({ promptTokens: 2, completionTokens: 9 });
		});

		// Note: the response-header fallback path is unreachable in the
		// current cascade because the preceding _steps-based branch matches
		// first whenever _steps[0] exists, regardless of whether its usage
		// is populated. Preserved verbatim from the pre-extraction code; if
		// we ever fix the dead branch, this is where its test would live.
	});

	describe("fallback", () => {
		it("resolves response.usage Promise when no provider branch fired", async () => {
			const response = {
				usage: Promise.resolve({ promptTokens: 15, completionTokens: 25 }),
			};
			const usage = await extractStreamUsage(response, undefined, "openai");
			expect(usage).toEqual({ promptTokens: 15, completionTokens: 25 });
		});

		it("returns initialUsage if neither cascade nor response.usage helped", async () => {
			const response = { usage: undefined };
			const seed = { promptTokens: 99 };
			const usage = await extractStreamUsage(response, seed, "openai");
			expect(usage).toBe(seed);
		});

		it("returns initialUsage if response.usage resolves to empty", async () => {
			const response = { usage: Promise.resolve({}) };
			const seed = { promptTokens: 100, completionTokens: 50 };
			const usage = await extractStreamUsage(response, seed, "openai");
			expect(usage).toBe(seed);
		});
	});

	describe("normalizeTokenUsage refuses shaped-but-undefined", () => {
		// The MiniMax + GitHub Models streamText case: response.usage is an
		// object with the right keys, but every value is undefined. Must
		// return null so makeResult emits the "usage not available" warning
		// rather than silently writing {promptTokens: 0, completionTokens: 0}
		// to disk and contaminating benchmark cost data.
		it("returns null when every numeric field is undefined", () => {
			const usage = {
				inputTokens: undefined,
				outputTokens: undefined,
				totalTokens: undefined,
				reasoningTokens: undefined,
				cachedInputTokens: undefined,
			};
			expect(normalizeTokenUsage(usage)).toBeNull();
		});

		it("still defaults to 0 when at least one field has real data", () => {
			// Mixed shape: total is real, prompt/completion both undefined.
			// The MiniMax fallback should kick in and derive promptTokens=0,
			// completionTokens=total. This documents the "we have *some*
			// data, lean on the fallback" path that pre-dated the fix.
			const usage = {
				totalTokens: 42,
				inputTokens: undefined,
				outputTokens: undefined,
			};
			const normalized = normalizeTokenUsage(usage);
			expect(normalized).not.toBeNull();
			expect(normalized!.total).toBe(42);
		});
	});

	describe("normalizeTokenUsage downstream", () => {
		it("happily accepts what extractStreamUsage returns for Google", async () => {
			// End-to-end: the extracted shape feeds straight into the cost
			// calculator without any field mismatch.
			const response = {
				_totalUsage: {
					status: { value: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } },
				},
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "google");
			const normalized = normalizeTokenUsage(usage);
			expect(normalized).toEqual({
				promptTokens: 100,
				completionTokens: 50,
				total: 150,
			});
		});

		it("happily accepts what extractStreamUsage returns for Ollama", async () => {
			const response = {
				_totalUsage: {
					status: { value: { promptTokens: 30, completionTokens: 70 } },
				},
				usage: undefined,
			};
			const usage = await extractStreamUsage(response, undefined, "ollama");
			const normalized = normalizeTokenUsage(usage);
			expect(normalized).toEqual({
				promptTokens: 30,
				completionTokens: 70,
				total: 100,
			});
		});
	});
});
