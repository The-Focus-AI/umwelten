import http from "node:http";
import { createHmac } from "node:crypto";
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
      fundingConfigured: false,
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

  it("lets customers disable, re-enable, and revoke an owned Application", async () => {
    const onboarded = await request("/api/customer/onboard", {
      subject: "user_alice",
      method: "POST",
      body: { clientName: "Alice Labs", applicationName: "Lifecycle" },
    });
    const applicationId = (
      onboarded.body as { dashboard: { applications: { id: string }[] } }
    ).dashboard.applications[0].id;

    expect(
      (
        await request(`/api/customer/applications/${applicationId}/enabled`, {
          subject: "user_alice",
          method: "POST",
          body: { enabled: false },
        })
      ).status,
    ).toBe(200);
    expect((await store.getApplication(applicationId))?.enabled).toBe(false);

    await request(`/api/customer/applications/${applicationId}/enabled`, {
      subject: "user_alice",
      method: "POST",
      body: { enabled: true },
    });
    expect((await store.getApplication(applicationId))?.enabled).toBe(true);

    expect(
      (
        await request(`/api/customer/applications/${applicationId}/revoke`, {
          subject: "user_alice",
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (await store.getApplication(applicationId))?.credentialHash,
    ).toBeUndefined();
  });

  it("supports one-use Client invitations without Clerk Organizations", async () => {
    await request("/api/customer/onboard", {
      subject: "user_alice",
      method: "POST",
      body: { clientName: "Alice Labs", applicationName: "Team app" },
    });
    const invited = await request("/api/customer/invitations", {
      subject: "user_alice",
      method: "POST",
    });
    expect(invited.status).toBe(201);
    const token = (invited.body as { invitation: { token: string } }).invitation
      .token;
    expect(token).toMatch(/^invite-mycel-/);

    const accepted = await request("/api/customer/invitations/accept", {
      subject: "user_bob",
      method: "POST",
      body: { token },
    });
    expect(accepted.status).toBe(200);
    expect(await store.getClientOperator("user_bob")).toMatchObject({
      role: "member",
    });
    expect(
      (
        await request("/api/customer/invitations", {
          subject: "user_bob",
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/customer/invitations/accept", {
          subject: "user_charlie",
          method: "POST",
          body: { token },
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await request("/api/customer/operators/user_bob", {
          subject: "user_alice",
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    expect(await store.getClientOperator("user_bob")).toBeNull();
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
    expect(serialized).not.toContain("tokenHash");
  });

  it("creates Stripe Checkout and credits each signed payment event once", async () => {
    const fundingStore = new MemoryStore();
    const secret = "whsec_test";
    let checkoutBody = "";
    const handler = createCustomerHandler({
      store: fundingStore,
      verifyOperator: async (authorization) => ({
        subject: authorization?.replace("Bearer ", "") ?? "",
      }),
      stripeSecretKey: "sk_test_example",
      stripeWebhookSecret: secret,
      publicOrigin: "https://mycel.example",
      fetch: async (_url, init) => {
        checkoutBody = String(init?.body);
        return new Response(
          JSON.stringify({ url: "https://checkout.stripe.example/session" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const fundingServer = http.createServer(async (req, res) => {
      if (await handler(req, res)) return;
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      fundingServer.listen(0, "127.0.0.1", resolve),
    );
    const fundingOrigin = `http://127.0.0.1:${(fundingServer.address() as AddressInfo).port}`;
    try {
      const call = (path: string, body: unknown, headers = {}) =>
        fetch(`${fundingOrigin}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        });
      await call(
        "/api/customer/onboard",
        { clientName: "Paid client", applicationName: "Paid app" },
        { authorization: "Bearer user_paid" },
      );
      const checkout = await call(
        "/api/customer/funding/checkout",
        { amountCents: 2_500 },
        { authorization: "Bearer user_paid" },
      );
      expect(checkout.status).toBe(201);
      expect(checkoutBody).toContain("unit_amount%5D=2500");

      const link = await fundingStore.getClientOperator("user_paid");
      const event = {
        id: "evt_paid_once",
        type: "checkout.session.completed",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            amount_total: 2_500,
            payment_status: "paid",
            metadata: { client_id: link?.clientId },
          },
        },
      };
      const raw = JSON.stringify(event);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${raw}`)
        .digest("hex");
      const deliver = () =>
        fetch(`${fundingOrigin}/api/customer/stripe/webhook`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": `t=${timestamp},v1=${signature}`,
          },
          body: raw,
        });
      expect((await deliver()).status).toBe(200);
      expect((await deliver()).status).toBe(200);
      expect(
        (await fundingStore.getBalance("client", link!.clientId)).microDollars,
      ).toBe(25_000_000);
      expect(
        await fundingStore.listLedgerEntries("client", link!.clientId),
      ).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) =>
        fundingServer.close(() => resolve()),
      );
    }
  });
});
