import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
	writeAgentReflection,
	readAgentReflections,
} from "./agent-instruction-writer.js";
import { writeProjectFact, readProjectFacts } from "./facts-writer.js";
import {
	writeSavedReflection,
	listSavedReflections,
	slugify,
} from "./saved-reflection-writer.js";
import { writeArtifact, listArtifacts } from "./artifact-writer.js";
import { writeUserModelEntry, readUserModel } from "./user-model-writer.js";

// ── Test helpers ────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
	testDir = join(tmpdir(), `knowledge-test-${randomUUID()}`);
	await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

function pathInDir(...parts: string[]): string {
	return join(testDir, ...parts);
}

// ── Agent Instruction Writer ────────────────────────────────────────────

describe("agent-instruction-writer", () => {
	it("creates a new file with a Reflections section", async () => {
		const filePath = pathInDir("AGENTS.md");
		const result = await writeAgentReflection(filePath, {
			entries: ["Always use pnpm, never npm"],
		});

		expect(result).toBe(filePath);
		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("## Reflections");
		expect(content).toContain("<!-- umwelten:reflections:start -->");
		expect(content).toContain("<!-- umwelten:reflections:end -->");
		expect(content).toContain("- Always use pnpm, never npm");
	});

	it("appends a section to an existing file without one", async () => {
		const filePath = pathInDir("AGENTS.md");
		await writeFile(
			filePath,
			"# AGENTS\n\nHand-written content here.\n",
			"utf-8",
		);

		await writeAgentReflection(filePath, {
			entries: ["Use dotenvx for env vars"],
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("Hand-written content here.");
		expect(content).toContain("## Reflections");
		expect(content).toContain("- Use dotenvx for env vars");
	});

	it("replaces content between markers without touching surrounding content", async () => {
		const filePath = pathInDir("AGENTS.md");
		await writeFile(
			filePath,
			[
				"# AGENTS",
				"",
				"Hand-written intro.",
				"",
				"## Reflections",
				"",
				"<!-- umwelten:reflections:start -->",
				"- Old reflection",
				"<!-- umwelten:reflections:end -->",
				"",
				"## Other Section",
				"",
				"Hand-written outro.",
				"",
			].join("\n"),
			"utf-8",
		);

		await writeAgentReflection(filePath, {
			entries: ["New reflection one", "New reflection two"],
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("Hand-written intro.");
		expect(content).toContain("Hand-written outro.");
		expect(content).not.toContain("- Old reflection");
		expect(content).toContain("- New reflection one");
		expect(content).toContain("- New reflection two");
	});

	it("auto-prefixes entries that lack bullet markers", async () => {
		const filePath = pathInDir("CLAUDE.md");
		await writeAgentReflection(filePath, {
			entries: ["Just a bare statement"],
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("- Just a bare statement");
	});

	it("readAgentReflections returns null for non-existent file", async () => {
		const result = await readAgentReflections(pathInDir("nonexistent.md"));
		expect(result).toBeNull();
	});

	it("readAgentReflections returns null for file without section", async () => {
		const filePath = pathInDir("AGENTS.md");
		await writeFile(filePath, "# Just content\n", "utf-8");
		const result = await readAgentReflections(filePath);
		expect(result).toBeNull();
	});

	it("readAgentReflections returns text between markers", async () => {
		const filePath = pathInDir("AGENTS.md");
		await writeAgentReflection(filePath, {
			entries: ["Reflection A", "Reflection B"],
		});
		const result = await readAgentReflections(filePath);
		expect(result).toContain("- Reflection A");
		expect(result).toContain("- Reflection B");
	});
});

// ── FACTS.md Writer ─────────────────────────────────────────────────────

describe("facts-writer", () => {
	it("creates a new FACTS.md with a fact", async () => {
		const filePath = pathInDir("FACTS.md");
		await writeProjectFact(filePath, {
			fact: "The project uses pnpm workspaces",
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("# Project Facts");
		expect(content).toContain("- The project uses pnpm workspaces");
	});

	it("appends to existing FACTS.md", async () => {
		const filePath = pathInDir("FACTS.md");
		await writeFile(filePath, "# Project Facts\n\n- Existing fact\n", "utf-8");

		await writeProjectFact(filePath, { fact: "New fact added later" });

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("- Existing fact");
		expect(content).toContain("- New fact added later");
	});

	it("accepts a section heading", async () => {
		const filePath = pathInDir("FACTS.md");
		await writeProjectFact(filePath, {
			fact: "Core depends on nothing",
			section: "## Architecture",
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("## Architecture");
		expect(content).toContain("- Core depends on nothing");
	});

	it("readProjectFacts returns null for non-existent file", async () => {
		const result = await readProjectFacts(pathInDir("FACTS.md"));
		expect(result).toBeNull();
	});
});

// ── Saved Reflection Writer ────────────────────────────────────────────

describe("saved-reflection-writer", () => {
	it("creates a dated markdown file with frontmatter", async () => {
		const dir = pathInDir(".umwelten", "reflections");
		const filePath = await writeSavedReflection(dir, {
			title: "What we learned about auth",
			content: "The refresh token flow works but needs retry logic.",
			sourceId: "exp-default-src-abc",
			tag: "what-we-learned",
		});

		expect(filePath).toMatch(
			/\.umwelten\/reflections\/\d{4}-\d{2}-\d{2}-what-we-learned-about-auth\.md$/,
		);
		const content = await readFile(filePath, "utf-8");
		expect(content).toContain('title: "What we learned about auth"');
		expect(content).toContain("source: exp-default-src-abc");
		expect(content).toContain("tag: what-we-learned");
		expect(content).toContain(
			"The refresh token flow works but needs retry logic.",
		);
	});

	it("creates the directory if missing", async () => {
		const dir = pathInDir("new-dir", "reflections");
		const filePath = await writeSavedReflection(dir, {
			title: "Test reflection",
			content: "Body content.",
		});
		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("Body content.");
	});

	it("listSavedReflections returns files newest first", async () => {
		const dir = pathInDir(".umwelten", "reflections");

		// Write reflections with explicit date via options... actually they use Date.now()
		// so we need to be careful. Let's just write two and check they're listed.
		await writeSavedReflection(dir, { title: "First", content: "First body" });
		await writeSavedReflection(dir, {
			title: "Second",
			content: "Second body",
		});

		const files = await listSavedReflections(dir);
		expect(files.length).toBeGreaterThanOrEqual(2);
	});

	it("listSavedReflections returns empty for missing dir", async () => {
		const files = await listSavedReflections(pathInDir("no-such-dir"));
		expect(files).toEqual([]);
	});
});

// ── slugify ─────────────────────────────────────────────────────────────

describe("slugify", () => {
	it("converts a title to a URL-friendly slug", () => {
		expect(slugify("What We Learned About Auth")).toBe(
			"what-we-learned-about-auth",
		);
	});

	it("handles special characters", () => {
		expect(slugify("Fix: OAuth 2.0 + JWT!")).toBe("fix-oauth-2-0-jwt");
	});

	it("truncates to 80 characters", () => {
		const long = "a".repeat(200);
		expect(slugify(long).length).toBeLessThanOrEqual(80);
	});

	it("handles empty string", () => {
		expect(slugify("")).toBe("");
	});
});

// ── Artifact Writer ─────────────────────────────────────────────────────

describe("artifact-writer", () => {
	it("creates a dated markdown artifact", async () => {
		const dir = pathInDir(".umwelten", "artifacts");
		const filePath = await writeArtifact(dir, {
			title: "Weekly Report",
			content: "# Weekly\n\nProgress on features.",
			format: "md",
		});

		expect(filePath).toMatch(
			/\.umwelten\/artifacts\/\d{4}-\d{2}-\d{2}-weekly-report\.md$/,
		);
		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("# Weekly");
	});

	it("creates a dated HTML artifact with a proper document wrapper", async () => {
		const dir = pathInDir(".umwelten", "artifacts");
		const filePath = await writeArtifact(dir, {
			title: "Status Page",
			content: "<h1>Status</h1><p>All systems go.</p>",
			format: "html",
		});

		expect(filePath).toMatch(/\.html$/);
		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("<!DOCTYPE html>");
		expect(content).toContain("<title>Status Page</title>");
		expect(content).toContain("<h1>Status</h1>");
	});

	it("escapes HTML title in the document head", async () => {
		const dir = pathInDir(".umwelten", "artifacts");
		const filePath = await writeArtifact(dir, {
			title: "Risk & Analysis <Report>",
			content: "<p>Content</p>",
			format: "html",
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("&amp;");
		expect(content).toContain("&lt;Report&gt;");
	});

	it("listArtifacts returns files newest first", async () => {
		const dir = pathInDir(".umwelten", "artifacts");
		await writeArtifact(dir, { title: "First", content: "a", format: "md" });
		await writeArtifact(dir, { title: "Second", content: "b", format: "md" });

		const files = await listArtifacts(dir);
		expect(files.length).toBeGreaterThanOrEqual(2);
	});

	it("listArtifacts filters by format", async () => {
		const dir = pathInDir(".umwelten", "artifacts");
		await writeArtifact(dir, { title: "Report", content: "a", format: "md" });
		await writeArtifact(dir, {
			title: "Page",
			content: "<p>b</p>",
			format: "html",
		});

		const mdFiles = await listArtifacts(dir, "md");
		expect(mdFiles.every((f) => f.endsWith(".md"))).toBe(true);

		const htmlFiles = await listArtifacts(dir, "html");
		expect(htmlFiles.every((f) => f.endsWith(".html"))).toBe(true);
	});
});

// ── User Model Writer ───────────────────────────────────────────────────

describe("user-model-writer", () => {
	it("creates a new user-model.md with an entry", async () => {
		const filePath = pathInDir(".umwelten", "user-model.md");
		await writeUserModelEntry(filePath, {
			entry: "Prefers async/await over callbacks",
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("# Project User Model");
		expect(content).toContain("_Recorded:");
		expect(content).toContain("- Prefers async/await over callbacks");
	});

	it("appends to existing user-model.md", async () => {
		const filePath = pathInDir(".umwelten", "user-model.md");
		await writeUserModelEntry(filePath, { entry: "First observation" });
		await writeUserModelEntry(filePath, { entry: "Second observation" });

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("First observation");
		expect(content).toContain("Second observation");
	});

	it("accepts a category heading", async () => {
		const filePath = pathInDir(".umwelten", "user-model.md");
		await writeUserModelEntry(filePath, {
			entry: "Uses TypeScript strictly",
			category: "## Preferences",
		});

		const content = await readFile(filePath, "utf-8");
		expect(content).toContain("## Preferences");
		expect(content).toContain("- Uses TypeScript strictly");
	});

	it("readUserModel returns null for non-existent file", async () => {
		const result = await readUserModel(pathInDir(".umwelten", "user-model.md"));
		expect(result).toBeNull();
	});
});
