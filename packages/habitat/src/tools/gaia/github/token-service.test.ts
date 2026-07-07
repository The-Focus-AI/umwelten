/**
 * GitHub token service — scope derivation from GaiaHabitatEntry.github,
 * 50-minute mint cache (fake clock), and the boot-token bundle. Mint layer
 * mocked; no network, no key files (readFileImpl is never hit when a mint
 * mock is provided — asserted explicitly, since the ADR forbids the key
 * contents from being cached anywhere).
 */

import { describe, it, expect, vi } from "vitest";
import {
	createGithubTokenService,
	deriveGithubTokenScope,
	type GithubTokenScope,
} from "./token-service.js";
import type { InstallationToken } from "./app-auth.js";

const CFG = {
	appId: "12345",
	installationId: "9876",
	privateKeyFile: "/etc/gaia/github-app.pem",
};

function makeClock(startMs = 1_000_000) {
	let t = startMs;
	return {
		now: () => t,
		advanceMinutes: (m: number) => {
			t += m * 60_000;
		},
	};
}

let mintCounter = 0;
function makeMint() {
	return vi.fn(async (_scope: GithubTokenScope): Promise<InstallationToken> => {
		mintCounter += 1;
		return {
			token: `tok-${mintCounter}`,
			expiresAt: new Date("2026-07-06T13:00:00Z"),
		};
	});
}

describe("deriveGithubTokenScope", () => {
	it("read: 'org' → contents:read with repositories omitted", () => {
		expect(deriveGithubTokenScope({ github: { read: "org" } }, "read")).toEqual({
			permissions: { contents: "read" },
		});
	});

	it("read list → contents:read pinned to sorted repos", () => {
		expect(
			deriveGithubTokenScope(
				{ github: { read: ["standards", "a-repo"] } },
				"read",
			),
		).toEqual({
			repositories: ["a-repo", "standards"],
			permissions: { contents: "read" },
		});
	});

	it("write → contents/issues/pull_requests write scoped to the write list", () => {
		expect(
			deriveGithubTokenScope(
				{ github: { write: ["twitter-habitat"] } },
				"write",
			),
		).toEqual({
			repositories: ["twitter-habitat"],
			permissions: {
				contents: "write",
				issues: "write",
				pull_requests: "write",
			},
		});
	});

	it("strips owner prefixes to bare repo names and dedupes (mint API 422s on owner/name)", () => {
		expect(
			deriveGithubTokenScope(
				{ github: { read: ["The-Focus-AI/standards", "standards", "The-Focus-AI/zebra"] } },
				"read",
			),
		).toEqual({
			repositories: ["standards", "zebra"],
			permissions: { contents: "read" },
		});
		expect(
			deriveGithubTokenScope(
				{ github: { write: ["The-Focus-AI/twitter-habitat"] } },
				"write",
			),
		).toEqual({
			repositories: ["twitter-habitat"],
			permissions: {
				contents: "write",
				issues: "write",
				pull_requests: "write",
			},
		});
	});

	it("returns null when the entry declares no matching scope", () => {
		expect(deriveGithubTokenScope({}, "read")).toBeNull();
		expect(deriveGithubTokenScope({ github: {} }, "read")).toBeNull();
		expect(deriveGithubTokenScope({ github: { read: [] } }, "read")).toBeNull();
		expect(
			deriveGithubTokenScope({ github: { read: "org" } }, "write"),
		).toBeNull();
		expect(deriveGithubTokenScope({ github: { write: [] } }, "write")).toBeNull();
	});
});

describe("createGithubTokenService", () => {
	it("returns null for everything when the App is not configured", async () => {
		const service = createGithubTokenService(null, { mint: makeMint() });
		expect(service.enabled).toBe(false);
		expect(
			await service.tokenFor({ github: { read: "org" } }, "read"),
		).toBeNull();
		expect(
			await service.bootTokensFor({ github: { read: "org" } }),
		).toBeUndefined();
	});

	it("returns null when the entry has no matching scope", async () => {
		const mint = makeMint();
		const service = createGithubTokenService(CFG, { mint });
		expect(await service.tokenFor({}, "read")).toBeNull();
		expect(
			await service.tokenFor({ github: { read: "org" } }, "write"),
		).toBeNull();
		expect(mint).not.toHaveBeenCalled();
	});

	it("mints with the derived scope and never reads the key file when mint is injected", async () => {
		const mint = makeMint();
		const readFileImpl = vi.fn();
		const service = createGithubTokenService(CFG, { mint, readFileImpl });

		const token = await service.tokenFor(
			{ github: { write: ["twitter-habitat"] } },
			"write",
		);
		expect(token?.token).toMatch(/^tok-/);
		expect(mint).toHaveBeenCalledWith({
			repositories: ["twitter-habitat"],
			permissions: {
				contents: "write",
				issues: "write",
				pull_requests: "write",
			},
		});
		expect(readFileImpl).not.toHaveBeenCalled();
	});

	it("caches per (habitat + kind + sorted repo list) for 50 minutes", async () => {
		const clock = makeClock();
		const mint = makeMint();
		const service = createGithubTokenService(CFG, { mint, now: clock.now });

		const entry = { id: "h1", github: { read: ["b", "a"] } };
		const first = await service.tokenFor(entry, "read");
		// Same habitat, same repo set in a different declaration order → cache hit
		const second = await service.tokenFor(
			{ id: "h1", github: { read: ["a", "b"] } },
			"read",
		);
		expect(second?.token).toBe(first?.token);
		expect(mint).toHaveBeenCalledTimes(1);

		// 49 minutes later: still cached
		clock.advanceMinutes(49);
		expect((await service.tokenFor(entry, "read"))?.token).toBe(first?.token);
		expect(mint).toHaveBeenCalledTimes(1);

		// past 50 minutes: re-mint
		clock.advanceMinutes(2);
		const fresh = await service.tokenFor(entry, "read");
		expect(fresh?.token).not.toBe(first?.token);
		expect(mint).toHaveBeenCalledTimes(2);
	});

	it("never shares tokens across habitats, even with identical scopes", async () => {
		const mint = makeMint();
		const service = createGithubTokenService(CFG, { mint });

		const a = await service.tokenFor(
			{ id: "habitat-a", github: { read: ["standards"] } },
			"read",
		);
		const b = await service.tokenFor(
			{ id: "habitat-b", github: { read: ["standards"] } },
			"read",
		);
		expect(a?.token).not.toBe(b?.token);
		expect(mint).toHaveBeenCalledTimes(2);
	});

	it("keeps read/write and different repo sets in separate cache slots", async () => {
		const mint = makeMint();
		const service = createGithubTokenService(CFG, { mint });

		const entry = { github: { read: ["r1"], write: ["r1"] } };
		const read = await service.tokenFor(entry, "read");
		const write = await service.tokenFor(entry, "write");
		expect(read?.token).not.toBe(write?.token);

		await service.tokenFor({ github: { read: ["r2"] } }, "read");
		expect(mint).toHaveBeenCalledTimes(3);
	});

	it("does not collide an org-read cache slot with a repo-list slot", async () => {
		const mint = makeMint();
		const service = createGithubTokenService(CFG, { mint });
		const org = await service.tokenFor({ github: { read: "org" } }, "read");
		const listed = await service.tokenFor({ github: { read: ["x"] } }, "read");
		expect(org?.token).not.toBe(listed?.token);
		expect(mint).toHaveBeenCalledTimes(2);
	});

	it("bootTokensFor bundles read+write and reuses the cache", async () => {
		const mint = makeMint();
		const service = createGithubTokenService(CFG, { mint });
		const entry = {
			id: "twitter",
			github: { read: "org" as const, write: ["twitter-habitat"] },
		};

		const bundle = await service.bootTokensFor(entry);
		expect(bundle?.read).toBeDefined();
		expect(bundle?.write).toBeDefined();
		expect(bundle?.read).not.toBe(bundle?.write);
		expect(mint).toHaveBeenCalledTimes(2);

		// second boot within TTL: no extra mints
		await service.bootTokensFor(entry);
		expect(mint).toHaveBeenCalledTimes(2);
	});

	it("bootTokensFor omits only the failing kind and never throws", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const mint = vi.fn(async (scope: GithubTokenScope) => {
				if (scope.permissions.contents === "write") {
					throw new Error("boom");
				}
				return { token: "read-ok", expiresAt: new Date() };
			});
			const service = createGithubTokenService(CFG, { mint });
			const bundle = await service.bootTokensFor({
				id: "x",
				github: { read: "org", write: ["r"] },
			});
			expect(bundle).toEqual({ read: "read-ok" });
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
		} finally {
			warn.mockRestore();
		}
	});

	it("bootTokensFor returns undefined for scope-less entries", async () => {
		const service = createGithubTokenService(CFG, { mint: makeMint() });
		expect(await service.bootTokensFor({ id: "plain" })).toBeUndefined();
	});
});
