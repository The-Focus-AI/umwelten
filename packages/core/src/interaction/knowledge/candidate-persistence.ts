import { readFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

export type CandidateKind =
	| "project-facts"
	| "skill-candidates"
	| "open-loops"
	| "preferences"
	| "mistakes";

const CANDIDATES_DIR = ".umwelten/candidates";

export class CandidatePersistence {
	constructor(private readonly projectRoot: string) {}

	private get storeDir(): string {
		return join(this.projectRoot, CANDIDATES_DIR);
	}

	private filePath(kind: CandidateKind): string {
		return join(this.storeDir, `${kind}.jsonl`);
	}

	private async ensureDir(): Promise<void> {
		await mkdir(this.storeDir, { recursive: true });
	}

	/**
	 * Append a candidate of a specific kind to its project-local JSONL file.
	 */
	async append(kind: CandidateKind, payload: Record<string, any>): Promise<void> {
		await this.ensureDir();
		const file = this.filePath(kind);
		const line = JSON.stringify(payload) + "\n";
		await appendFile(file, line, "utf-8");
	}

	/**
	 * Read all candidates of a specific kind.
	 * Returns empty array if file is missing (ENOENT) or empty.
	 */
	async read(kind: CandidateKind): Promise<Record<string, any>[]> {
		const file = this.filePath(kind);
		try {
			const content = await readFile(file, "utf-8");
			const lines = content.split("\n");
			const results: Record<string, any>[] = [];
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					results.push(JSON.parse(trimmed));
				} catch {
					// Gracefully skip malformed JSONL lines in production/tests
				}
			}
			return results;
		} catch (error: any) {
			if (error?.code === "ENOENT") {
				return [];
			}
			throw error;
		}
	}

	/**
	 * Read all candidate kinds and return them as a mapped object.
	 */
	async readAll(): Promise<Record<CandidateKind, Record<string, any>[]>> {
		const kinds: CandidateKind[] = [
			"project-facts",
			"skill-candidates",
			"open-loops",
			"preferences",
			"mistakes",
		];
		
		const results = await Promise.all(kinds.map(kind => this.read(kind)));
		
		const map = {} as Record<CandidateKind, Record<string, any>[]>;
		kinds.forEach((kind, index) => {
			map[kind] = results[index];
		});
		
		return map;
	}
}
