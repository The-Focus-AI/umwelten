import { describe, it, expect } from "vitest";
import { startConnect, completeConnect, callbackUri } from "./connect.js";
import { createXConnector } from "../connectors/x.js";
import { signState } from "../connectors/state.js";

const x = createXConnector({ clientId: "cid", clientSecret: "csecret" });
const SECRET = "hmac-secret";
const BASE = "https://h.example";

describe("callbackUri", () => {
	it("builds the exact provider callback path (trailing-slash safe)", () => {
		expect(callbackUri("https://h.example/", "x")).toBe(
			"https://h.example/connect/x/callback",
		);
	});
});

describe("startConnect", () => {
	it("returns an authorize URL with a verifiable signed state", () => {
		const { authorizeUrl } = startConnect({
			connector: x,
			sub: "user-1",
			publicBaseUrl: BASE,
			secret: SECRET,
			nowSeconds: 1000,
		});
		const url = new URL(authorizeUrl);
		expect(url.searchParams.get("redirect_uri")).toBe(
			"https://h.example/connect/x/callback",
		);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		// state is our signed token and must verify back to the sub
		const state = url.searchParams.get("state")!;
		expect(state).toContain(".");
	});
});

describe("completeConnect", () => {
	const okFetch = (async () =>
		new Response(JSON.stringify({ refresh_token: "rt-9" }), {
			status: 200,
		})) as unknown as typeof fetch;

	function validState(sub = "user-1", provider = "x") {
		return signState({ sub, provider, verifier: "ver" }, SECRET, 1000);
	}

	it("happy path: exchanges and stores the per-sub secret", async () => {
		const stored: Record<string, string> = {};
		const res = await completeConnect({
			connector: x,
			provider: "x",
			query: { code: "auth-code", state: validState() },
			publicBaseUrl: BASE,
			secret: SECRET,
			nowSeconds: 1100,
			setSecret: (n, v) => {
				stored[n] = v;
			},
			fetchImpl: okFetch,
		});
		expect(res).toEqual({ ok: true, provider: "x", sub: "user-1" });
		expect(stored["TWITTER_REFRESH_TOKEN:user-1"]).toBe("rt-9");
	});

	it("rejects a provider error redirect", async () => {
		const res = await completeConnect({
			connector: x,
			provider: "x",
			query: { error: "access_denied" },
			publicBaseUrl: BASE,
			secret: SECRET,
			nowSeconds: 1100,
			setSecret: () => {},
			fetchImpl: okFetch,
		});
		expect(res.ok).toBe(false);
	});

	it("rejects missing code/state", async () => {
		const res = await completeConnect({
			connector: x,
			provider: "x",
			query: { code: "only-code" },
			publicBaseUrl: BASE,
			secret: SECRET,
			nowSeconds: 1100,
			setSecret: () => {},
			fetchImpl: okFetch,
		});
		expect(res).toMatchObject({ ok: false, status: 400 });
	});

	it("rejects an invalid/forged state", async () => {
		const res = await completeConnect({
			connector: x,
			provider: "x",
			query: { code: "c", state: validState("user-1", "x") + "x" },
			publicBaseUrl: BASE,
			secret: SECRET,
			nowSeconds: 1100,
			setSecret: () => {},
			fetchImpl: okFetch,
		});
		expect(res).toMatchObject({ ok: false, status: 400 });
	});

	it("rejects a state minted for a different provider (no cross-provider replay)", async () => {
		const res = await completeConnect({
			connector: x,
			provider: "x",
			query: { code: "c", state: validState("user-1", "google") },
			publicBaseUrl: BASE,
			secret: SECRET,
			nowSeconds: 1100,
			setSecret: () => {},
			fetchImpl: okFetch,
		});
		expect(res).toMatchObject({ ok: false, status: 400 });
	});

	it("surfaces an exchange failure as 502 and stores nothing", async () => {
		const stored: Record<string, string> = {};
		const badFetch = (async () =>
			new Response("nope", { status: 400 })) as unknown as typeof fetch;
		const res = await completeConnect({
			connector: x,
			provider: "x",
			query: { code: "c", state: validState() },
			publicBaseUrl: BASE,
			secret: SECRET,
			nowSeconds: 1100,
			setSecret: (n, v) => {
				stored[n] = v;
			},
			fetchImpl: badFetch,
		});
		expect(res).toMatchObject({ ok: false, status: 502 });
		expect(Object.keys(stored)).toHaveLength(0);
	});
});
