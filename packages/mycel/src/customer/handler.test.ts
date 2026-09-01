import http from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashCredential } from "../auth/credentials.js";
import { MemoryStore } from "../store/memory-store.js";
import {
  createClerkOperatorVerifier,
  createCustomerHandler,
} from "./handler.js";

describe("Clerk customer identity", () => {
  it("accepts only the configured issuer and browser origin", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const jwksServer = http.createServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          keys: [{ ...publicJwk, kid: "test-key", use: "sig" }],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, "127.0.0.1", resolve),
    );
    const issuer = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;
    const token = (authorizedParty: string, tokenIssuer = issuer) =>
      new SignJWT({ azp: authorizedParty })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(tokenIssuer)
        .setSubject("user_alice")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    const verify = createClerkOperatorVerifier({
      issuer,
      authorizedParties: ["https://mycel.example"],
    });
    try {
      await expect(
        verify(`Bearer ${await token("https://mycel.example")}`),
      ).resolves.toEqual({ subject: "user_alice" });
      await expect(
        verify(`Bearer ${await token("https://another.example")}`),
      ).rejects.toThrow();
      await expect(
        verify(
          `Bearer ${await token("https://mycel.example", "https://wrong.example")}`,
        ),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
    }
  });
});

describe("Mycel's self-service customer control plane", () => {
  let store: MemoryStore;
  let server: http.Server;
  let origin: string;

  beforeEach(async () => {
    store = new MemoryStore();
    const handler = createCustomerHandler({
      store,
      defaultCreditLimitMicroDollars: 5_000_000,
      verifyOperator: async (authorization) => {
        const subject = authorization?.match(/^Bearer (.+)$/)?.[1];
        if (!subject) throw new Error("unauthorized");
        return { subject };
      },
    });
    server = http.createServer(async (req, res) => {
      if (await handler(req, res)) return;
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function request(
    path: string,
    options: { subject?: string; method?: string; body?: unknown } = {},
  ) {
    const response = await fetch(`${origin}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.subject
          ? { authorization: `Bearer ${options.subject}` }
          : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  it("requires a verified Clerk operator", async () => {
    expect((await request("/api/customer")).status).toBe(401);
  });

  it("provisions a Client and first Application without storing the credential", async () => {
    expect(
      (await request("/api/customer", { subject: "user_alice" })).body,
    ).toEqual({
      onboarded: false,
    });

    const response = await request("/api/customer/onboard", {
      subject: "user_alice",
      method: "POST",
      body: { clientName: "Alice Labs", applicationName: "Research app" },
    });
    expect(response.status).toBe(201);
    const result = response.body as {
      credential: string;
      dashboard: {
        onboarded: boolean;
        client: { id: string; creditLimitMicroDollars: number };
        applications: { id: string }[];
      };
    };
    expect(result.credential).toMatch(/^sk-mycel-/);
    expect(result.dashboard.onboarded).toBe(true);
    expect(result.dashboard.client.creditLimitMicroDollars).toBe(5_000_000);
    expect(result.dashboard.applications).toHaveLength(1);

    const application = await store.getApplication(
      result.dashboard.applications[0].id,
    );
    expect(application?.credentialHash).toBe(hashCredential(result.credential));
    expect(JSON.stringify(application)).not.toContain(result.credential);
    expect(await store.getClientOperator("user_alice")).toMatchObject({
      clientId: result.dashboard.client.id,
    });
  });

  it("creates and rotates only Applications owned by the caller", async () => {
    const onboarded = await request("/api/customer/onboard", {
      subject: "user_alice",
      method: "POST",
      body: { clientName: "Alice Labs", applicationName: "First" },
    });
    const first = (
      onboarded.body as { dashboard: { applications: { id: string }[] } }
    ).dashboard.applications[0].id;

    const created = await request("/api/customer/applications", {
      subject: "user_alice",
      method: "POST",
      body: { applicationName: "Second" },
    });
    expect(created.status).toBe(201);
    expect((created.body as { credential: string }).credential).toMatch(
      /^sk-mycel-/,
    );

    const refused = await request(
      `/api/customer/applications/${first}/rotate`,
      {
        subject: "user_bob",
        method: "POST",
      },
    );
    expect(refused.status).toBe(404);

    const rotated = await request(
      `/api/customer/applications/${first}/rotate`,
      {
        subject: "user_alice",
        method: "POST",
      },
    );
    expect(rotated.status).toBe(200);
    expect((rotated.body as { credential: string }).credential).toMatch(
      /^sk-mycel-/,
    );
  });

  it("returns only customer-safe usage fields for owned Applications", async () => {
    const onboarded = await request("/api/customer/onboard", {
      subject: "user_alice",
      method: "POST",
      body: { clientName: "Alice Labs", applicationName: "Private" },
    });
    const applicationId = (
      onboarded.body as { dashboard: { applications: { id: string }[] } }
    ).dashboard.applications[0].id;
    await store.recordRequest({
      id: "request-1",
      applicationId,
      subject: "end-user-1",
      supplierId: "secret-wholesaler",
      model: "example/model",
      promptTokens: 10,
      completionTokens: 20,
      cost: 10,
      charge: 20,
      outcome: "completed",
      startedAt: new Date("2026-09-01T00:00:00Z"),
      finishedAt: new Date("2026-09-01T00:00:01Z"),
    });

    const dashboard = await request("/api/customer", { subject: "user_alice" });
    const serialized = JSON.stringify(dashboard.body);
    expect(serialized).toContain("example/model");
    expect(serialized).not.toContain("secret-wholesaler");
    expect(serialized).not.toContain('"cost"');
    expect(serialized).not.toContain("credentialHash");
  });
});
