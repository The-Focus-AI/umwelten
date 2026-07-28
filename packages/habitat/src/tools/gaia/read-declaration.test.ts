import { describe, expect, it, vi } from "vitest";
import {
	DeclarationFetchError,
	parseGitHubRepo,
	readDeclarationFromRepo,
} from "./read-declaration.js";

const REPO = "https://github.com/The-Focus-AI/client-upperhand.git";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const contents = (text: string) =>
	json({ content: Buffer.from(text).toString("base64"), encoding: "base64" });

describe("parseGitHubRepo", () => {
	it.each([
		["https://github.com/The-Focus-AI/client-upperhand.git", "client-upperhand"],
		["https://github.com/The-Focus-AI/client-upperhand", "client-upperhand"],
		["git@github.com:The-Focus-AI/client-upperhand.git", "client-upperhand"],
		["ssh://git@github.com/The-Focus-AI/client-upperhand.git", "client-upperhand"],
	])("parses %s", (url, repo) => {
		expect(parseGitHubRepo(url)).toEqual({ owner: "The-Focus-AI", repo });
	});

	it.each(["", "   ", "nonsense", "https://github.com/only-owner"])(
		"returns undefined for %s",
		(url) => expect(parseGitHubRepo(url)).toBeUndefined(),
	);
});

describe("readDeclarationFromRepo", () => {
	it("returns the declaration", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(contents('{"name":"UpperHand"}'));
		await expect(
			readDeclarationFromRepo(REPO, undefined, { fetchImpl }),
		).resolves.toBe('{"name":"UpperHand"}');
	});

	it("asks for habitat.json at the repo root", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(contents("{}"));
		await readDeclarationFromRepo(REPO, undefined, { fetchImpl });
		expect(String(fetchImpl.mock.calls[0][0])).toBe(
			"https://api.github.com/repos/The-Focus-AI/client-upperhand/contents/habitat.json",
		);
	});

	it("reads a named ref when asked", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(contents("{}"));
		await readDeclarationFromRepo(REPO, "release", { fetchImpl });
		expect(String(fetchImpl.mock.calls[0][0])).toContain("ref=release");
	});

	it("sends the ambient-read token", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(contents("{}"));
		await readDeclarationFromRepo(REPO, undefined, { fetchImpl, token: "ghs_x" });
		expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bearer ghs_x");
	});

	it("handles a plain-text response as well as base64", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ content: '{"name":"x"}', encoding: "none" }),
		);
		await expect(
			readDeclarationFromRepo(REPO, undefined, { fetchImpl }),
		).resolves.toBe('{"name":"x"}');
	});

	/**
	 * GitHub answers 404 for "no such file" and for "no such repo, as far as
	 * your token is concerned". Those need opposite fixes — add a declaration
	 * versus install the App — so they must not read alike.
	 */
	it("returns undefined when the repo is visible but has no declaration", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ message: "Not Found" }, 404))
			.mockResolvedValueOnce(json({ name: "client-upperhand" }, 200));

		await expect(
			readDeclarationFromRepo(REPO, undefined, { fetchImpl }),
		).resolves.toBeUndefined();
	});

	it("points at the App installation when the repo itself is invisible", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ message: "Not Found" }, 404));
		await expect(
			readDeclarationFromRepo(REPO, undefined, { fetchImpl }),
		).rejects.toThrow(/GitHub App is probably not installed/);
	});

	it("surfaces other HTTP failures rather than treating them as absent", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(
			readDeclarationFromRepo(REPO, undefined, { fetchImpl }),
		).rejects.toThrow(/HTTP 500/);
	});

	it("rejects a URL it cannot read a repo out of", async () => {
		await expect(
			readDeclarationFromRepo("nonsense", undefined, { fetchImpl: vi.fn() }),
		).rejects.toThrow(DeclarationFetchError);
	});

	it("complains clearly when the path is a directory", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json([{ name: "a" }]));
		await expect(
			readDeclarationFromRepo(REPO, undefined, { fetchImpl }),
		).rejects.toThrow(/no content field/);
	});
});
