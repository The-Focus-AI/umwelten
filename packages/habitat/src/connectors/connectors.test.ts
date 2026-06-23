import { describe, it, expect } from "vitest";
import { createPkcePair, base64url } from "./pkce.js";
import { signState, verifyState } from "./state.js";
import { createXConnector, X_AUTHORIZE_URL } from "./x.js";
import { buildDefaultConnectors } from "./registry.js";

describe("pkce", () => {
	it("produces url-safe verifier + challenge", () => {
		const { verifier, challenge } = createPkcePair();
		expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(verifier).not.toEqual(challenge);
	});
	it("base64url strips padding and +/", () => {
		expect(base64url(Buffer.from([255, 255, 255]))).toBe("____");
	});
});

describe("signState / verifyState", () => {
	const secret = "test-secret";
	const claims = { sub: "user-1", provider: "x", verifier: "v123" };

	it("round-trips valid claims", () => {
		const tok = signState(claims, secret, 1000);
		const out = verifyState(tok, secret, 1100);
		expect(out).toMatchObject(claims);
		expect(out?.exp).toBe(1000 + 600);
	});
	it("rejects a tampered body", () => {
		const tok = signState(claims, secret, 1000);
		const [body, mac] = tok.split(".");
		const forged = `${body}x.${mac}`;
		expect(verifyState(forged, secret, 1100)).toBeNull();
	});
	it("rejects a wrong secret (forged mac)", () => {
		const tok = signState(claims, secret, 1000);
		expect(verifyState(tok, "other-secret", 1100)).toBeNull();
	});
	it("rejects an expired token", () => {
		const tok = signState(claims, secret, 1000); // exp = 1600
		expect(verifyState(tok, secret, 1700)).toBeNull();
	});
	it("rejects malformed input", () => {
		expect(verifyState("nope", secret, 1100)).toBeNull();
		expect(verifyState("", secret, 1100)).toBeNull();
	});
});

describe("x connector", () => {
	const x = createXConnector({ clientId: "cid", clientSecret: "csecret" });

	it("secretKey is the per-sub TWITTER_REFRESH_TOKEN convention (#176)", () => {
		expect(x.secretKey("user-9")).toBe("TWITTER_REFRESH_TOKEN:user-9");
	});

	it("buildAuthorizeUrl carries PKCE S256 + state + scopes", () => {
		const url = new URL(
			x.buildAuthorizeUrl({
				redirectUri: "https://h.example/connect/x/callback",
				state: "STATE",
				codeChallenge: "CHAL",
			}),
		);
		expect(`${url.origin}${url.pathname}`).toBe(X_AUTHORIZE_URL);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("client_id")).toBe("cid");
		expect(url.searchParams.get("code_challenge")).toBe("CHAL");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("state")).toBe("STATE");
		expect(url.searchParams.get("scope")).toContain("offline.access");
	});

	it("exchangeCode uses Basic auth + code_verifier, no client_id in body", async () => {
		let captured: { headers: Record<string, string>; body: string } | null =
			null;
		const fakeFetch = (async (_url: string, init: RequestInit) => {
			captured = {
				headers: init.headers as Record<string, string>,
				body: String(init.body),
			};
			return new Response(JSON.stringify({ refresh_token: "rt-1" }), {
				status: 200,
			});
		}) as unknown as typeof fetch;

		const out = await x.exchangeCode({
			code: "abc",
			redirectUri: "https://h.example/connect/x/callback",
			codeVerifier: "ver",
			fetchImpl: fakeFetch,
		});
		expect(out.refreshToken).toBe("rt-1");
		expect(captured!.headers.authorization).toBe(
			`Basic ${Buffer.from("cid:csecret").toString("base64")}`,
		);
		expect(captured!.body).toContain("code_verifier=ver");
		expect(captured!.body).toContain("grant_type=authorization_code");
		expect(captured!.body).not.toContain("client_id=");
	});

	it("exchangeCode throws on non-2xx", async () => {
		const fakeFetch = (async () =>
			new Response("bad", { status: 400 })) as unknown as typeof fetch;
		await expect(
			x.exchangeCode({
				code: "abc",
				redirectUri: "r",
				codeVerifier: "v",
				fetchImpl: fakeFetch,
			}),
		).rejects.toThrow(/X token exchange failed: 400/);
	});

	it("exchangeCode throws when no refresh_token (missing offline.access)", async () => {
		const fakeFetch = (async () =>
			new Response(JSON.stringify({ access_token: "a" }), {
				status: 200,
			})) as unknown as typeof fetch;
		await expect(
			x.exchangeCode({
				code: "abc",
				redirectUri: "r",
				codeVerifier: "v",
				fetchImpl: fakeFetch,
			}),
		).rejects.toThrow(/no refresh_token/);
	});
});

describe("buildDefaultConnectors", () => {
	it("is empty without X creds (inert by default)", () => {
		expect(buildDefaultConnectors({} as NodeJS.ProcessEnv).size).toBe(0);
	});
	it("registers x when both creds are present", () => {
		const m = buildDefaultConnectors({
			TWITTER_CLIENT_ID: "a",
			TWITTER_CLIENT_SECRET: "b",
		} as NodeJS.ProcessEnv);
		expect(m.has("x")).toBe(true);
		expect(m.get("x")!.name).toBe("x");
	});
	it("does not register x with only one cred", () => {
		expect(
			buildDefaultConnectors({
				TWITTER_CLIENT_ID: "a",
			} as NodeJS.ProcessEnv).size,
		).toBe(0);
	});
});
