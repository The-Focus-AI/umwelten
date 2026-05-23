/**
 * Extraction workflow engine — coordinates digest extraction across Explorations.
 *
 * Deep module per issue #63. Exposes a simple interface (determineScope + run)
 * with non-trivial internal logic: scope detection, chronicity control,
 * progress streaming, and candidate persistence.
 */

import type { SessionDigest } from "./analysis-types.js";
import type { ModelDetails } from "../../cognition/types.js";
import { digestSession } from "./session-digester.js";
import {
	CandidatePersistence,
	type CandidateKind,
} from "../knowledge/candidate-persistence.js";
import type { SessionIndexEntry } from "../types/types.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Persist a SessionDigest to <projectPath>/.umwelten/digests/sessions/<encoded-id>.json.
 *
 * Mirrors the loadDigest/saveDigest helpers in @umwelten/sessions; duplicated
 * here so the engine doesn't need to depend on the sessions package.
 */
async function persistDigest(
	projectPath: string,
	digest: SessionDigest,
): Promise<string> {
	const filename = `${encodeURIComponent(digest.sessionId)}.json`;
	const path = join(
		projectPath,
		".umwelten",
		"digests",
		"sessions",
		filename,
	);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(digest, null, 2), "utf-8");
	return path;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type ExtractionPhase = "pending" | "digesting" | "digested" | "failed";

export interface ExtractionProgress {
	explorationId: string;
	sessionId: string;
	phase: ExtractionPhase;
	detail?: string;
}

export interface ExtractionInput {
	explorationId: string;
	sessionId: string;
	modified: string;
	source: string;
	/** Full session entry for the digester. */
	sessionEntry: SessionIndexEntry;
}

export interface DigestInfo {
	digestedAt: string;
	schemaVersion?: number;
}

export interface ExtractionScope {
	/** Explorations with no digest at all — newest first. */
	undigested: ExtractionInput[];
	/** Explorations whose digest is outdated — newest first. */
	stale: ExtractionInput[];
}

export interface ExtractionEngineOptions {
	concurrency?: number;
	schemaVersion?: number;
}

export interface ExtractionResult {
	digested: number;
	stale: number;
	failed: number;
	skipped: number;
}

// ── Scope Detection ────────────────────────────────────────────────────────

/**
 * Determine which Explorations need extraction.
 *
 * Partitions inputs into undigested (no digest exists) and stale (digest
 * exists but is outdated). A digest is stale when:
 * - The source session was modified after the digest was created, OR
 * - The extraction schema version changed since the digest was created.
 *
 * Both partitions are sorted newest-first by session modified time.
 */
export function determineScope(
	inputs: ExtractionInput[],
	digests: Map<string, DigestInfo>,
	currentSchemaVersion?: number,
): ExtractionScope {
	const undigested: ExtractionInput[] = [];
	const stale: ExtractionInput[] = [];

	for (const input of inputs) {
		const digest = digests.get(input.sessionId);

		if (!digest) {
			undigested.push(input);
			continue;
		}

		const sessionModified = new Date(input.modified).getTime();
		const digestAt = new Date(digest.digestedAt).getTime();
		const isStaleByTime = sessionModified > digestAt;

		const isStaleBySchema =
			currentSchemaVersion !== undefined &&
			digest.schemaVersion !== undefined &&
			digest.schemaVersion !== currentSchemaVersion;

		if (isStaleByTime || isStaleBySchema) {
			stale.push(input);
		}
	}

	const sortNewestFirst = (a: ExtractionInput, b: ExtractionInput) =>
		new Date(b.modified).getTime() - new Date(a.modified).getTime();

	undigested.sort(sortNewestFirst);
	stale.sort(sortNewestFirst);

	return { undigested, stale };
}

// ── Extraction Engine ──────────────────────────────────────────────────────

/**
 * Coordinates LLM extraction across a list of Explorations.
 *
 * Features:
 * - Scope detection: newest undigested first, plus stale
 * - Concurrency control: default 1 (configurable)
 * - Progress streaming: pending → digesting → digested | failed
 * - Candidate persistence: results written project-locally
 */
export class ExtractionEngine {
	private readonly concurrency: number;
	private readonly schemaVersion: number;

	constructor(options: ExtractionEngineOptions = {}) {
		this.concurrency = options.concurrency ?? 1;
		this.schemaVersion = options.schemaVersion ?? 1;
	}

	/**
	 * Run extraction on a list of Explorations.
	 *
	 * @param inputs All Exploration inputs.
	 * @param digests Existing digests (keyed by sessionId) for scope detection.
	 * @param projectPath The project root for candidate persistence and digest paths.
	 * @param model The LLM model to use for extraction.
	 * @param onProgress Callback for progress streaming.
	 */
	async run(
		inputs: ExtractionInput[],
		digests: Map<string, DigestInfo>,
		projectPath: string,
		projectName: string,
		model: ModelDetails,
		onProgress?: (event: ExtractionProgress) => void,
	): Promise<ExtractionResult> {
		const scope = determineScope(inputs, digests, this.schemaVersion);

		// Combine: undigested first, then stale
		const toProcess = [...scope.undigested, ...scope.stale];
		const skipped = inputs.length - toProcess.length;

		if (toProcess.length === 0) {
			return { digested: 0, stale: 0, failed: 0, skipped };
		}

		// Emit pending for all
		for (const input of toProcess) {
			onProgress?.({
				explorationId: input.explorationId,
				sessionId: input.sessionId,
				phase: "pending",
			});
		}

		let digested = 0;
		const staleCount = scope.stale.length; // pre-counted
		let failed = 0;

		// Helper used by both the sequential and concurrent paths.
		const processOne = async (input: ExtractionInput): Promise<void> => {
			onProgress?.({
				explorationId: input.explorationId,
				sessionId: input.sessionId,
				phase: "digesting",
				detail: `Extracting ${input.sessionId.slice(0, 8)}...`,
			});

			try {
				const digest = await digestSession(
					input.sessionEntry,
					projectPath,
					projectName,
					model,
					(p) => {
						onProgress?.({
							explorationId: input.explorationId,
							sessionId: input.sessionId,
							phase: "digesting",
							detail: `[${p.phase}] ${p.detail ?? input.sessionId.slice(0, 8)}`,
						});
					},
				);

				if (!digest) {
					// digestSession returns null when the session is too small to
					// extract anything useful (e.g. < 2 messages, no beats, or
					// adapter format not supported by parseSessionFile). Treat that
					// as a failure so the dashboard surfaces it instead of silently
					// flipping the row to "digested".
					failed++;
					onProgress?.({
						explorationId: input.explorationId,
						sessionId: input.sessionId,
						phase: "failed",
						detail:
							"No digest produced (session too small or unsupported format)",
					});
					return;
				}

				// Persist the digest. digestSession builds but does not save.
				await persistDigest(projectPath, digest);

				digested++;
				onProgress?.({
					explorationId: input.explorationId,
					sessionId: input.sessionId,
					phase: "digested",
					detail: `Completed ${input.sessionId.slice(0, 8)}`,
				});
			} catch (err) {
				failed++;
				onProgress?.({
					explorationId: input.explorationId,
					sessionId: input.sessionId,
					phase: "failed",
					detail: err instanceof Error ? err.message : "Unknown error",
				});
			}
		};

		// Process with concurrency control
		if (this.concurrency === 1) {
			// Sequential processing (default)
			for (const input of toProcess) {
				await processOne(input);
			}
		} else {
			// Concurrent processing with a sliding window
			let cursor = 0;
			const processNext = async (): Promise<void> => {
				while (cursor < toProcess.length) {
					const idx = cursor++;
					await processOne(toProcess[idx]);
				}
			};
			const workers = Array.from({ length: this.concurrency }, () =>
				processNext(),
			);
			await Promise.all(workers);
		}

		return { digested, stale: staleCount, failed, skipped };
	}
}
