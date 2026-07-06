/**
 * GitHub App auth primitives (ADR 0004) — JWT construction and installation
 * token minting. The JWT is decoded part-by-part and verified against the
 * real public key; the mint path runs against a mocked fetch so URL,
 * headers, body shape, and failure handling are all asserted without
 * touching the network. Token values are treated as opaque — no format or
 * length assumptions (ghs_<appid>_<jwt> era).
 */

import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { buildAppJwt, mintInstallationToken } from "./app-auth.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function decodePart(part: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(part, "base64url").toString("utf-8"));
}

describe("buildAppJwt", () => {
	it("emits header {alg: RS256, typ: JWT} and iat/exp/iss claims around now", () => {
		const now = 1_760_000_000;
		const jwt = buildAppJwt({ appId: "12345", privateKeyPem: privateKey, now });

		const parts = jwt.split(".");
		expect(parts).toHaveLength(3);

		expect(decodePart(parts[0])).toEqual({ alg: "RS256", typ: "JWT" });
		expect(decodePart(parts[1])).toEqual({
			iat: now - 60,
			exp: now + 540,
			iss: "12345",
		});
	});

	it("stringifies a numeric appId in iss", () => {
		const jwt = buildAppJwt({ appId: 777, privateKeyPem: privateKey, now: 100 });
		expect(decodePart(jwt.split(".")[1]).iss).toBe("777");
	});

	it("signs with RS256 verifiable by the public key", () => {
		const jwt = buildAppJwt({ appId: "1", privateKeyPem: privateKey, now: 100 });
		const [header, claims, signature] = jwt.split(".");
		const verified = createVerify("RSA-SHA256")
			.update(`${header}.${claims}`)
			.verify(publicKey, Buffer.from(signature, "base64url"));
		expect(verified).toBe(true);
	});

	it("uses base64url (no padding, no +/ characters)", () => {
		const jwt = buildAppJwt({ appId: "1", privateKeyPem: privateKey, now: 100 });
		expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
	});
});

function mockFetch(status: number, body: unknown) {
	return vi.fn().mockResolvedValue({
		status,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
		json: async () => body,
	} as unknown as Response) as unknown as typeof fetch;
}

const baseOpts = {
	appId: "12345",
	privateKeyPem: privateKey,
	installationId: "9876",
};

describe("mintInstallationToken", () => {
	it("POSTs the correct URL with Bearer JWT + Accept header", async () => {
		const fetchImpl = mockFetch(201, {
			token: "ghs_12345_opaque.jwt.tail",
			expires_at: "2026-07-06T13:00:00Z",
		});

		const result = await mintInstallationToken(baseOpts, {
			fetchImpl,
			now: () => 1_760_000_000,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe(
			"https://api.github.com/app/installations/9876/access_tokens",
		);
		expect(init.method).toBe("POST");
		expect(init.headers.Accept).toBe("application/vnd.github+json");
		// Authorization carries the App JWT (verify claims, not token shape)
		const jwt = (init.headers.Authorization as string).replace(/^Bearer /, "");
		expect(decodePart(jwt.split(".")[1])).toMatchObject({ iss: "12345" });

		// No repositories/permissions provided ⇒ no body at all
		expect(init.body).toBeUndefined();

		expect(result.token).toBe("ghs_12345_opaque.jwt.tail");
		expect(result.expiresAt).toEqual(new Date("2026-07-06T13:00:00Z"));
	});

	it("sends repositories/permissions in the JSON body only when provided", async () => {
		const fetchImpl = mockFetch(201, {
			token: "t",
			expires_at: "2026-07-06T13:00:00Z",
		});

		await mintInstallationToken(
			{
				...baseOpts,
				repositories: ["standards", "twitter-habitat"],
				permissions: { contents: "read" },
			},
			{ fetchImpl },
		);

		const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(init.headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(init.body)).toEqual({
			repositories: ["standards", "twitter-habitat"],
			permissions: { contents: "read" },
		});
	});

	it("sends only the provided field (permissions without repositories)", async () => {
		const fetchImpl = mockFetch(201, {
			token: "t",
			expires_at: "2026-07-06T13:00:00Z",
		});

		await mintInstallationToken(
			{ ...baseOpts, permissions: { contents: "read" } },
			{ fetchImpl },
		);

		const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body).toEqual({ permissions: { contents: "read" } });
		expect("repositories" in body).toBe(false);
	});

	it("throws with status + response body excerpt on non-201", async () => {
		const fetchImpl = mockFetch(422, {
			message: "There is at least one repository that does not exist",
		});

		await expect(
			mintInstallationToken(
				{ ...baseOpts, repositories: ["ghost-repo"] },
				{ fetchImpl },
			),
		).rejects.toThrow(/422.*does not exist/s);
	});
});
