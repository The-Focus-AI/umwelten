import { describe, expect, it } from "vitest";
import {
	HABITAT_DECLARATION_FILE,
	HabitatDeclarationError,
	declarationToCreateOptions,
	parseHabitatDeclaration,
} from "./declaration.js";

const MINIMAL = JSON.stringify({ name: "UpperHand" });

describe("parseHabitatDeclaration", () => {
	it("accepts a minimal declaration", () => {
		expect(parseHabitatDeclaration(MINIMAL)).toEqual({ name: "UpperHand" });
	});

	it("accepts an empty object — every field is optional", () => {
		expect(parseHabitatDeclaration("{}")).toEqual({});
	});

	it("reads mounts", () => {
		const d = parseHabitatDeclaration(
			JSON.stringify({
				mounts: [
					{ gitRemote: "https://github.com/x/a.git" },
					{ gitRemote: "https://github.com/x/b.git", gitBranch: "release", id: "bee" },
				],
			}),
		);
		expect(d.mounts).toEqual([
			{ gitRemote: "https://github.com/x/a.git" },
			{ gitRemote: "https://github.com/x/b.git", gitBranch: "release", id: "bee" },
		]);
	});

	it("reads model, secret bindings and github write", () => {
		const d = parseHabitatDeclaration(
			JSON.stringify({
				provider: "google",
				model: "gemini-3-flash-preview",
				secretBindings: ["GOOGLE_GENERATIVE_AI_API_KEY"],
				github: { write: ["client-upperhand"] },
			}),
		);
		expect(d).toMatchObject({
			provider: "google",
			model: "gemini-3-flash-preview",
			secretBindings: ["GOOGLE_GENERATIVE_AI_API_KEY"],
			github: { write: ["client-upperhand"] },
		});
	});

	it("preserves an org-wide read, which is a deliberate act", () => {
		const d = parseHabitatDeclaration(JSON.stringify({ github: { read: "org" } }));
		expect(d.github?.read).toBe("org");
	});

	/**
	 * The Owned repo is the repo the declaration lives in. Writing it down
	 * would create a second place for it to be wrong.
	 */
	it("refuses a declared gitUrl", () => {
		expect(() =>
			parseHabitatDeclaration(JSON.stringify({ gitUrl: "https://github.com/x/a.git" })),
		).toThrow(/the repo this file lives in/);
	});

	describe("rejects rather than repairs", () => {
		it.each([
			["not JSON at all", "{ nope"],
			["a top-level array", "[]"],
			["a top-level string", '"hello"'],
			["a non-string name", JSON.stringify({ name: 42 })],
			["mounts that are not an array", JSON.stringify({ mounts: {} })],
			["a mount that is not an object", JSON.stringify({ mounts: ["x"] })],
			["a mount with no remote", JSON.stringify({ mounts: [{}] })],
			["a mount with a blank remote", JSON.stringify({ mounts: [{ gitRemote: "  " }] })],
			["a non-string mount branch", JSON.stringify({ mounts: [{ gitRemote: "g", gitBranch: 1 }] })],
			["secretBindings that are not strings", JSON.stringify({ secretBindings: [1] })],
			["github that is not an object", JSON.stringify({ github: "org" })],
			["a non-array github.write", JSON.stringify({ github: { write: "x" } })],
		])("rejects %s", (_label, source) => {
			expect(() => parseHabitatDeclaration(source)).toThrow(HabitatDeclarationError);
		});

		it("names the file in the error, so the fix is obvious", () => {
			expect(() => parseHabitatDeclaration("{ nope")).toThrow(
				new RegExp(HABITAT_DECLARATION_FILE),
			);
		});
	});
});

describe("declarationToCreateOptions", () => {
	const ctx = { id: "upperhand", gitUrl: "https://github.com/x/client-upperhand.git" };

	it("takes the id and Owned repo from context, not the declaration", () => {
		const opts = declarationToCreateOptions({ name: "UpperHand" }, ctx);
		expect(opts).toMatchObject({ id: "upperhand", gitUrl: ctx.gitUrl });
	});

	it("falls back to the id when the declaration names nothing", () => {
		expect(declarationToCreateOptions({}, ctx).name).toBe("upperhand");
	});

	it("carries mounts through to creation", () => {
		const opts = declarationToCreateOptions(
			{ mounts: [{ gitRemote: "https://github.com/x/a.git" }] },
			ctx,
		);
		expect(opts.mounts).toHaveLength(1);
	});

	it("omits what the declaration did not state", () => {
		const opts = declarationToCreateOptions({}, ctx);
		expect(opts).not.toHaveProperty("provider");
		expect(opts).not.toHaveProperty("storage");
	});

	it("carries a branch when the context pins one", () => {
		expect(
			declarationToCreateOptions({}, { ...ctx, gitBranch: "main" }).gitBranch,
		).toBe("main");
	});
});
