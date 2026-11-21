/**
 * Promotion Classifier
 *
 * Analyzes a reflection answer and determines which project knowledge
 * target(s) it should be promoted to.
 *
 * Uses keyword heuristics for deterministic routing and supports
 * LLM-based classification for ambiguous content.
 *
 * Promotion taxonomy (from PRD):
 *   - imperative agent guidance  → AGENTS.md Reflections section
 *   - declarative project truths  → FACTS.md
 *   - domain language             → CONTEXT.md
 *   - hard-to-reverse tradeoffs   → ADRs (docs/adr/)
 *   - reusable procedures         → Skills (draft)
 *   - human-facing outputs        → Artifacts
 *   - holding-area answers        → Saved Reflections
 *   - work-style observations     → user-model.md
 */

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Supported promotion target categories.
 */
export type PromotionTarget =
	| "agent-instruction" // AGENTS.md / CLAUDE.md Reflections
	| "project-fact" // FACTS.md
	| "domain-language" // CONTEXT.md
	| "adr" // docs/adr/YYYY-MM-DD-slug.md
	| "skill" // Skill draft
	| "artifact" // .umwelten/artifacts/
	| "saved-reflection" // .umwelten/reflections/
	| "user-model"; // .umwelten/user-model.md

/**
 * A single promotion decision.
 */
export interface PromotionDecision {
	/** The target category. */
	target: PromotionTarget;
	/** How confident the classifier is (0-1). */
	confidence: number;
	/** A human-readable label for this target. */
	label: string;
	/** The content to promote. */
	content: string;
	/** A suggested title/name for the promoted content. */
	title: string;
	/** Whether this decision was determined by heuristics or LLM. */
	source: "heuristic" | "llm";
}

/**
 * Result of classifying one piece of content.
 */
export interface ClassificationResult {
	/** Primary decision (highest confidence). */
	primary: PromotionDecision;
	/** Alternative decisions with lower confidence. */
	alternatives: PromotionDecision[];
}

// ── Heuristic patterns ─────────────────────────────────────────────────

interface HeuristicRule {
	target: PromotionTarget;
	label: string;
	/** Keywords that suggest this target. */
	keywords: string[];
	/** Phrases that strongly suggest this target. */
	strongPhrases: string[];
}

const HEURISTIC_RULES: HeuristicRule[] = [
	{
		target: "agent-instruction",
		label: "Agent instruction (AGENTS.md)",
		keywords: [
			"agent",
			"instruction",
			"guidance",
			"should",
			"must",
			"always",
			"never",
			"avoid",
		],
		strongPhrases: [
			"agent should",
			"always use",
			"never use",
			"remember to",
			"make sure to",
			"be careful to",
			"gotcha",
		],
	},
	{
		target: "project-fact",
		label: "Project fact (FACTS.md)",
		keywords: [
			"fact",
			"truth",
			"project uses",
			"project depends",
			"architecture",
			"built with",
		],
		strongPhrases: [
			"the project uses",
			"this project",
			"the codebase",
			"depends on",
			"is built with",
			"uses",
			"written in",
		],
	},
	{
		target: "domain-language",
		label: "Domain language (CONTEXT.md)",
		keywords: [
			"term",
			"definition",
			"vocabulary",
			"glossary",
			"means",
			"refers to",
		],
		strongPhrases: [
			"is defined as",
			"refers to",
			"means",
			"is called",
			"avoid the term",
			"prefer",
			"distinguish",
		],
	},
	{
		target: "adr",
		label: "Architecture Decision Record",
		keywords: [
			"decision",
			"tradeoff",
			"architecture",
			"chose",
			"selected",
			"decided",
		],
		strongPhrases: [
			"we decided",
			"we chose",
			"decision was",
			"trade-off",
			"architectural decision",
			"considered",
		],
	},
	{
		target: "skill",
		label: "Reusable procedure (Skill)",
		keywords: ["procedure", "workflow", "steps", "how to", "recipe", "process"],
		strongPhrases: [
			"to do this",
			"follow these steps",
			"first",
			"then",
			"repeatable",
			"workflow",
			"template",
		],
	},
	{
		target: "artifact",
		label: "Published output (Artifact)",
		keywords: [
			"report",
			"summary",
			"overview",
			"output",
			"document",
			"publish",
		],
		strongPhrases: ["the result was", "generated", "produced", "output"],
	},
	{
		target: "saved-reflection",
		label: "Saved Reflection",
		keywords: [
			"reflection",
			"observation",
			"learning",
			"insight",
			"note",
			"thought",
		],
		strongPhrases: [
			"what we learned",
			"what i learned",
			"observation",
			"key insight",
			"notable",
			"interesting",
		],
	},
	{
		target: "user-model",
		label: "Work-style observation (user-model.md)",
		keywords: ["prefer", "style", "habit", "tendency", "likes", "prefers"],
		strongPhrases: [
			"tends to",
			"prefers",
			"likes to",
			"habit of",
			"work style",
			"coding style",
		],
	},
];

// ── Classifier ──────────────────────────────────────────────────────────

/**
 * Analyze a reflection answer and determine the best promotion target.
 *
 * Uses keyword heuristics with strong-phrase matching for high-confidence
 * results. For ambiguous content, the caller can optionally use an LLM
 * via `classifyWithLLM()`.
 */
export function classifyReflectionAnswer(
	content: string,
): ClassificationResult {
	const lower = content.toLowerCase();
	const scores = new Map<
		PromotionTarget,
		{ score: number; strongMatches: number }
	>();

	for (const rule of HEURISTIC_RULES) {
		let score = 0;
		let strongMatches = 0;

		// Strong phrase matches (higher weight)
		for (const phrase of rule.strongPhrases) {
			if (lower.includes(phrase)) {
				score += 3;
				strongMatches++;
			}
		}

		// Keyword matches (lower weight)
		for (const kw of rule.keywords) {
			if (containsWord(content, kw)) {
				score += 1;
			}
		}

		if (score > 0) {
			scores.set(rule.target, { score, strongMatches });
		}
	}

	// Build decisions sorted by score
	const decisions: PromotionDecision[] = [];
	for (const [target, { score, strongMatches }] of scores) {
		const rule = HEURISTIC_RULES.find((r) => r.target === target)!;
		// Confidence: strong matches give 0.6-1.0, keyword-only gives 0.2-0.6
		const confidence = Math.min(1.0, 0.2 + strongMatches * 0.2 + score * 0.08);

		decisions.push({
			target,
			confidence: Math.round(confidence * 100) / 100,
			label: rule.label,
			content,
			title: extractTitle(content),
			source: "heuristic",
		});
	}

	// Sort by confidence descending
	decisions.sort((a, b) => b.confidence - a.confidence);

	return {
		primary: decisions[0] ?? {
			target: "saved-reflection",
			confidence: 0.3,
			label: "Saved Reflection (default)",
			content,
			title: extractTitle(content),
			source: "heuristic",
		},
		alternatives: decisions.slice(1),
	};
}

/**
 * Extract a title from content (first line or first sentence).
 */
export function extractTitle(content: string): string {
	const firstLine = content.split("\n")[0].trim();
	if (firstLine && firstLine.length < 100) return firstLine;

	// First sentence
	const match = content.match(/^[^.?!]+[.?!]/);
	if (match) {
		const sentence = match[0].trim();
		return sentence.length < 100 ? sentence : sentence.slice(0, 97) + "...";
	}

	return content.slice(0, 80);
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Check if a string contains a word as a standalone word (not substring).
 * Avoids regex injection / ReDoS.
 */
function containsWord(text: string, word: string): boolean {
	const lower = text.toLowerCase();
	const w = word.toLowerCase();
	const idx = lower.indexOf(w);
	if (idx === -1) return false;
	// Check word boundaries: must be at start or preceded by non-alpha
	const before = idx === 0 ? true : !isAlpha(lower[idx - 1]);
	const after =
		idx + w.length >= lower.length ? true : !isAlpha(lower[idx + w.length]);
	return before && after;
}

function isAlpha(ch: string): boolean {
	return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}
