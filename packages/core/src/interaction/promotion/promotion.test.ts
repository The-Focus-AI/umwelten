import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { classifyReflectionAnswer, extractTitle } from "./classifier.js";
import { PromotionRouter } from "./router.js";

// ── classifyReflectionAnswer ────────────────────────────────────────────

describe("classifyReflectionAnswer", () => {
	it("classifies agent guidance", () => {
		const result = classifyReflectionAnswer(
			"The agent should always use pnpm for package management. Never use npm as it causes issues with the workspace setup.",
		);
		expect(result.primary.target).toBe("agent-instruction");
		expect(result.primary.confidence).toBeGreaterThan(0.3);
	});

	it("classifies project facts", () => {
		const result = classifyReflectionAnswer(
			"The project uses TypeScript with strict mode enabled. It depends on pnpm workspaces for monorepo management.",
		);
		expect(result.primary.target).toBe("project-fact");
		expect(result.primary.label).toContain("FACTS.md");
	});

	it("classifies domain language", () => {
		const result = classifyReflectionAnswer(
			'An Interaction is defined as a flat conversation context exchanged with a model for one continuing line of work. Avoid the term "session" when referring to the model-facing conversation.',
		);
		expect(result.primary.target).toBe("domain-language");
	});

	it("classifies architecture decisions", () => {
		const result = classifyReflectionAnswer(
			"We decided to use pnpm workspaces over npm. The decision was made because npm had symlink issues in our monorepo setup.",
		);
		expect(result.primary.target).toBe("adr");
	});

	it("classifies procedural content as skill", () => {
		const result = classifyReflectionAnswer(
			"To set up a new skill: first create a SKILL.md file, then add the handler code, and register it in the loader. This is a repeatable workflow.",
		);
		expect(result.primary.target).toBe("skill");
	});

	it("classifies observations as saved reflection", () => {
		const result = classifyReflectionAnswer(
			"A key insight from this session: the memory runner pattern was causing conflicts with the context builder. The fix involved separating concerns.",
		);
		expect(result.primary.target).toBe("saved-reflection");
	});

	it("classifies work-style preferences as user-model", () => {
		const result = classifyReflectionAnswer(
			"The developer prefers async/await over callbacks and tends to use early returns for error handling.",
		);
		expect(result.primary.target).toBe("user-model");
	});

	it("provides alternatives with lower confidence", () => {
		const result = classifyReflectionAnswer(
			"The project uses TypeScript. We decided on pnpm. The agent should always use workspaces.",
		);
		expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
		// Primary should have highest confidence
		for (const alt of result.alternatives) {
			expect(alt.confidence).toBeLessThanOrEqual(result.primary.confidence);
		}
	});

	it("defaults to saved-reflection for ambiguous content", () => {
		const result = classifyReflectionAnswer("Hello world. This is a test.");
		expect(result.primary.target).toBe("saved-reflection");
		expect(result.primary.confidence).toBeGreaterThan(0);
	});

	it("extracts title from first line", () => {
		const title = extractTitle("Key Learning: Auth Tokens\n\nDetails here...");
		expect(title).toBe("Key Learning: Auth Tokens");
	});
});

// ── PromotionRouter ─────────────────────────────────────────────────────

describe("PromotionRouter", () => {
	let testDir: string;
	let router: PromotionRouter;

	beforeEach(() => {
		testDir = join(tmpdir(), `promotion-test-${randomUUID()}`);
		router = new PromotionRouter({ projectRoot: testDir });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("promotes to agent instruction file", async () => {
		const result = await router.promote({
			target: "agent-instruction",
			confidence: 0.8,
			label: "Agent instruction",
			content: "Always use pnpm",
			title: "Use pnpm",
			source: "heuristic",
		});

		expect(result.success).toBe(true);
		expect(result.target).toBe("agent-instruction");
		expect(result.filePath).toContain("AGENTS.md");

		const content = await readFile(result.filePath, "utf-8");
		expect(content).toContain("Always use pnpm");
		expect(content).toContain("<!-- umwelten:reflections:start -->");
	});

	it("promotes to FACTS.md", async () => {
		const result = await router.promote({
			target: "project-fact",
			confidence: 0.7,
			label: "Fact",
			content: "The project uses pnpm workspaces",
			title: "PNPM",
			source: "heuristic",
		});

		expect(result.success).toBe(true);
		const content = await readFile(result.filePath, "utf-8");
		expect(content).toContain("pnpm workspaces");
	});

	it("promotes to saved reflection", async () => {
		const result = await router.promote({
			target: "saved-reflection",
			confidence: 0.6,
			label: "Reflection",
			content:
				"Key insight: the memory runner pattern conflicted with context builder.",
			title: "Memory Runner Insight",
			source: "heuristic",
		});

		expect(result.success).toBe(true);
		expect(result.filePath).toContain(".umwelten/reflections/");
		const content = await readFile(result.filePath, "utf-8");
		expect(content).toContain("Memory Runner Insight");
		expect(content).toContain("memory runner pattern conflicted");
	});

	it("promotes to artifact", async () => {
		const result = await router.promote({
			target: "artifact",
			confidence: 0.5,
			label: "Artifact",
			content: "# Weekly Report\n\nProgress on features.",
			title: "Weekly Report",
			source: "heuristic",
		});

		expect(result.success).toBe(true);
		expect(result.filePath).toContain(".umwelten/artifacts/");
		expect(result.filePath).toMatch(/\.md$/);
		const content = await readFile(result.filePath, "utf-8");
		expect(content).toContain("# Weekly Report");
	});

	it("promotes to user model", async () => {
		const result = await router.promote({
			target: "user-model",
			confidence: 0.5,
			label: "User model",
			content: "Prefers TypeScript strict mode",
			title: "TypeScript",
			source: "heuristic",
		});

		expect(result.success).toBe(true);
		expect(result.filePath).toContain("user-model.md");
		const content = await readFile(result.filePath, "utf-8");
		expect(content).toContain("TypeScript strict mode");
	});

	it("promotes to ADR", async () => {
		const result = await router.promote({
			target: "adr",
			confidence: 0.9,
			label: "ADR",
			content: "We decided to use pnpm over npm for workspace management.",
			title: "Use pnpm for workspaces",
			source: "heuristic",
		});

		expect(result.success).toBe(true);
		expect(result.filePath).toContain("docs/adr/");
		expect(result.filePath).toMatch(/\.md$/);
		const content = await readFile(result.filePath, "utf-8");
		expect(content).toContain("Use pnpm for workspaces");
	});

	it("promotes to skill draft", async () => {
		const result = await router.promote({
			target: "skill",
			confidence: 0.7,
			label: "Skill",
			content: "# My Skill\n\nSteps to reproduce.",
			title: "My Skill",
			source: "heuristic",
		});

		expect(result.success).toBe(true);
		expect(result.filePath).toContain(".agents/skills/my-skill/");
		const content = await readFile(result.filePath, "utf-8");
		expect(content).toContain("# My Skill");
	});

	it("promotes to domain language (CONTEXT.md)", async () => {
		const result = await router.promote({
			target: "domain-language",
			confidence: 0.6,
			label: "Domain language",
			content: "An Exploration is a queryable grouping of Source Sessions.",
			title: "Exploration definition",
			source: "heuristic",
		});

		expect(result.success).toBe(true);
		expect(result.filePath).toContain("CONTEXT.md");
		const content = await readFile(result.filePath, "utf-8");
		expect(content).toContain("Exploration is a queryable grouping");
	});

	it("reports failure gracefully", async () => {
		const brokenRouter = new PromotionRouter({
			projectRoot: "/nonexistent/path/that/cannot/be/created",
		});
		const result = await brokenRouter.promote({
			target: "saved-reflection",
			confidence: 0.5,
			label: "Test",
			content: "Test content",
			title: "Test",
			source: "heuristic",
		});

		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("promotes multiple decisions", async () => {
		const decisions = [
			{
				target: "project-fact" as const,
				confidence: 0.8,
				label: "Fact",
				content: "Project uses pnpm",
				title: "PNPM",
				source: "heuristic" as const,
			},
			{
				target: "saved-reflection" as const,
				confidence: 0.5,
				label: "Reflection",
				content: "Learned about pnpm",
				title: "PNPM Learning",
				source: "heuristic" as const,
			},
		];

		const results = await router.promoteAll(decisions);
		expect(results).toHaveLength(2);
		expect(results.every((r) => r.success)).toBe(true);
	});
});
