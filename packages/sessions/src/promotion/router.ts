/**
 * Promotion Router
 *
 * Takes a PromotionDecision from the classifier and executes it by
 * calling the appropriate knowledge writer. Routes content to the
 * correct project knowledge target file.
 */
import { join } from "node:path";
import { writeAgentReflection } from "../knowledge/agent-instruction-writer.js";
import { writeProjectFact } from "../knowledge/facts-writer.js";
import { writeSavedReflection } from "../knowledge/saved-reflection-writer.js";
import { writeArtifact } from "../knowledge/artifact-writer.js";
import { writeUserModelEntry } from "../knowledge/user-model-writer.js";
import type { PromotionTarget, PromotionDecision } from "./classifier.js";

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Result of promoting content.
 */
export interface PromotionResult {
	/** The target that was written to. */
	target: PromotionTarget;
	/** The file path that was written. */
	filePath: string;
	/** Whether the promotion succeeded. */
	success: boolean;
	/** Error message if promotion failed. */
	error?: string;
}

/**
 * Configuration for the promotion router.
 */
export interface PromotionRouterConfig {
	/** Project root directory. */
	projectRoot: string;
	/** Override the agent instruction file path (default: AGENTS.md). */
	agentInstructionFile?: string;
	/** Override the FACTS.md file path (default: FACTS.md). */
	factsFile?: string;
	/** Override the user model file path (default: .umwelten/user-model.md). */
	userModelFile?: string;
	/** Override the reflections directory (default: .umwelten/reflections/). */
	reflectionsDir?: string;
	/** Override the artifacts directory (default: .umwelten/artifacts/). */
	artifactsDir?: string;
}

// ── Router ──────────────────────────────────────────────────────────────

export class PromotionRouter {
	constructor(private config: PromotionRouterConfig) {}

	/**
	 * Execute a promotion decision by writing to the appropriate target.
	 */
	async promote(decision: PromotionDecision): Promise<PromotionResult> {
		const { target, content, title } = decision;

		try {
			switch (target) {
				case "agent-instruction":
					return await this.promoteToAgentInstruction(content, title);
				case "project-fact":
					return await this.promoteToFact(content);
				case "domain-language":
					return await this.promoteToDomainLanguage(content);
				case "adr":
					return await this.promoteToAdr(content, title);
				case "skill":
					return await this.promoteToSkill(content, title);
				case "artifact":
					return await this.promoteToArtifact(content, title);
				case "saved-reflection":
					return await this.promoteToSavedReflection(content, title);
				case "user-model":
					return await this.promoteToUserModel(content);
			}
		} catch (err) {
			return {
				target,
				filePath: "",
				success: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	/**
	 * Promote content to multiple targets (e.g. primary + alternatives).
	 */
	async promoteAll(decisions: PromotionDecision[]): Promise<PromotionResult[]> {
		return Promise.all(decisions.map((d) => this.promote(d)));
	}

	// ── Target writers ─────────────────────────────────────────────────

	private async promoteToAgentInstruction(
		content: string,
		_title: string,
	): Promise<PromotionResult> {
		const filePath =
			this.config.agentInstructionFile ??
			join(this.config.projectRoot, "AGENTS.md");
		await writeAgentReflection(filePath, { entries: [content] });
		return { target: "agent-instruction", filePath, success: true };
	}

	private async promoteToFact(content: string): Promise<PromotionResult> {
		const filePath =
			this.config.factsFile ?? join(this.config.projectRoot, "FACTS.md");
		await writeProjectFact(filePath, { fact: content });
		return { target: "project-fact", filePath, success: true };
	}

	private async promoteToDomainLanguage(
		content: string,
	): Promise<PromotionResult> {
		const filePath = join(this.config.projectRoot, "CONTEXT.md");
		const { appendFile, mkdir } = await import("node:fs/promises");
		const { dirname } = await import("node:path");
		await mkdir(dirname(filePath), { recursive: true });
		await appendFile(filePath, `\n${content}\n`, "utf-8");
		return { target: "domain-language", filePath, success: true };
	}

	private async promoteToAdr(
		content: string,
		title: string,
	): Promise<PromotionResult> {
		const { writeFile, mkdir } = await import("node:fs/promises");
		const adrDir = join(this.config.projectRoot, "docs", "adr");
		await mkdir(adrDir, { recursive: true });

		// Generate sequential ADR number
		const { readdir } = await import("node:fs/promises");
		let nextNum = 1;
		try {
			const files = await readdir(adrDir);
			const nums = files
				.filter((f) => /^\d{4}-/.test(f))
				.map((f) => parseInt(f.slice(0, 4), 10))
				.filter((n) => !isNaN(n));
			if (nums.length > 0) nextNum = Math.max(...nums) + 1;
		} catch {
			// Directory doesn't exist yet
		}

		const date = new Date().toISOString().slice(0, 10);
		const slug = title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60);

		const adrContent = `# ${String(nextNum).padStart(4, "0")}: ${title}\n\n${content}\n`;
		const filePath = join(
			adrDir,
			`${String(nextNum).padStart(4, "0")}-${date}-${slug}.md`,
		);
		await writeFile(filePath, adrContent, "utf-8");
		return { target: "adr", filePath, success: true };
	}

	private async promoteToSkill(
		content: string,
		title: string,
	): Promise<PromotionResult> {
		const { writeFile, mkdir } = await import("node:fs/promises");
		const slug = title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40);

		const skillsDir = join(this.config.projectRoot, ".agents", "skills", slug);
		await mkdir(skillsDir, { recursive: true });
		const filePath = join(skillsDir, "SKILL.md");
		await writeFile(filePath, content, "utf-8");
		return { target: "skill", filePath, success: true };
	}

	private async promoteToArtifact(
		content: string,
		title: string,
	): Promise<PromotionResult> {
		const dir =
			this.config.artifactsDir ??
			join(this.config.projectRoot, ".umwelten", "artifacts");
		const filePath = await writeArtifact(dir, { title, content, format: "md" });
		return { target: "artifact", filePath, success: true };
	}

	private async promoteToSavedReflection(
		content: string,
		title: string,
	): Promise<PromotionResult> {
		const dir =
			this.config.reflectionsDir ??
			join(this.config.projectRoot, ".umwelten", "reflections");
		const filePath = await writeSavedReflection(dir, { title, content });
		return { target: "saved-reflection", filePath, success: true };
	}

	private async promoteToUserModel(content: string): Promise<PromotionResult> {
		const filePath =
			this.config.userModelFile ??
			join(this.config.projectRoot, ".umwelten", "user-model.md");
		await writeUserModelEntry(filePath, { entry: content });
		return { target: "user-model", filePath, success: true };
	}
}
