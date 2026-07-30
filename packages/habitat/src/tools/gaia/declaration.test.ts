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

/**
 * Nothing is inherited, defaulted or inferred. A habitat declares what it
 * needs and its own vault (#283) supplies it — earlier versions derived a
 * provider from Gaia and a key name from the provider registry, which only
 * existed to work around a flat shared vault and made a habitat's real
 * requirements impossible to read off its declaration.
 */
describe("declarationToCreateOptions — nothing is inferred", () => {
	const ctx = {
		id: "upperhand",
		gitUrl: "https://github.com/The-Focus-AI/client-upperhand.git",
	};

	it("leaves provider and model unset when the declaration omits them", () => {
		const opts = declarationToCreateOptions({}, ctx);
		expect(opts.provider).toBeUndefined();
		expect(opts.model).toBeUndefined();
	});

	it("carries provider and model through when the declaration states them", () => {
		const opts = declarationToCreateOptions(
			{ provider: "google", model: "gemini-3-flash-preview" },
			ctx,
		);
		expect(opts.provider).toBe("google");
		expect(opts.model).toBe("gemini-3-flash-preview");
	});

	it("does not invent a key binding from the provider", () => {
		const opts = declarationToCreateOptions({ provider: "google" }, ctx);
		expect(opts.secretBindings).toBeUndefined();
	});

	it("carries only the bindings the declaration actually asked for", () => {
		const opts = declarationToCreateOptions(
			{ secretBindings: ["GOOGLE_GENERATIVE_AI_API_KEY", "TAVILY_API_KEY"] },
			ctx,
		);
		expect(opts.secretBindings).toEqual([
			"GOOGLE_GENERATIVE_AI_API_KEY",
			"TAVILY_API_KEY",
		]);
	});
});

/**
 * A habitat declares what it needs and publishes it as `requiredCredentials`
 * on its agent card (ADR 0004). Gaia never read that — it provisioned from a
 * separate hand-maintained `secretBindings` list, and `export_habitat` even
 * generated the contract *from* the list, inverting the relationship. These
 * assert the declaration carries the real contract.
 */
describe("parseHabitatDeclaration — requiredSecrets contract", () => {
	const parse = (o: unknown) => parseHabitatDeclaration(JSON.stringify(o));

	it("carries a declared requirement through", () => {
		const d = parse({
			requiredSecrets: [{ name: "DATABASE_URL", description: "Postgres" }],
		});
		expect(d.requiredSecrets).toEqual([
			{ name: "DATABASE_URL", required: true, description: "Postgres" },
		]);
	});

	it("defaults required to true — a declared need is needed", () => {
		expect(parse({ requiredSecrets: [{ name: "K" }] }).requiredSecrets?.[0].required).toBe(
			true,
		);
	});

	it("keeps an explicit optional", () => {
		expect(
			parse({ requiredSecrets: [{ name: "K", required: false }] }).requiredSecrets?.[0]
				.required,
		).toBe(false);
	});

	it("carries an oauth requirement with its connect path", () => {
		const d = parse({
			requiredSecrets: [
				{ name: "TWITTER_REFRESH_TOKEN", type: "oauth", connectPath: "/connect/x" },
			],
		});
		expect(d.requiredSecrets?.[0]).toMatchObject({
			type: "oauth",
			connectPath: "/connect/x",
		});
	});

	/**
	 * An oauth entry with nowhere to send the user can never be satisfied —
	 * it would sit permanently unmet with no way to fix it.
	 */
	it("rejects an oauth requirement with no connectPath", () => {
		expect(() => parse({ requiredSecrets: [{ name: "T", type: "oauth" }] })).toThrow(
			/nowhere to send the user/,
		);
	});

	it("rejects an unknown type rather than guessing", () => {
		expect(() =>
			parse({ requiredSecrets: [{ name: "T", type: "magic" }] }),
		).toThrow(/must be "secret" or "oauth"/);
	});

	it("rejects a nameless requirement", () => {
		expect(() => parse({ requiredSecrets: [{ type: "secret" }] })).toThrow(
			/non-empty "name"/,
		);
	});

	it("still accepts the older secretBindings list", () => {
		expect(parse({ secretBindings: ["A"] }).secretBindings).toEqual(["A"]);
	});
});
