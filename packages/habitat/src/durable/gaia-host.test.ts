import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { GaiaHost } from "./gaia-host.js";

describe("GaiaHost (pi-durable multi-Habitat host)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  async function bootTestGaia(opts?: {
    dataDir?: string;
    apiKeys?: string[];
    useJwt?: boolean;
    responses?: string[];
  }) {
    const dataDir = opts?.dataDir ?? (await mkdtemp(join(tmpdir(), "umwelten-gaia-test-")));
    const ownsDir = !opts?.dataDir;

    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwk = await exportJWK(publicKey);
    const keySet = createLocalJWKSet({ keys: [jwk] });

    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "gaia-brain" }],
    });
    const queue = opts?.responses ?? [
      "Answer 1 from DurableHabitat",
      "Answer 2 from DurableHabitat",
      "Answer 3 from DurableHabitat",
    ];
    faux.setResponses(queue.map((t) => fauxAssistantMessage(t)));

    const gaia = await GaiaHost.open({
      dataDir,
      defaultModel: { provider: "faux", modelId: "gaia-brain" },
      publicUrl: "https://gaia.habitats.example.com",
      baseDomain: "habitats.example.com",
      apiKeys: opts?.apiKeys ?? ["key-primary", "key-secondary"],
      keySet: opts?.useJwt === false ? undefined : keySet,
      authAudiences: ["https://gaia.habitats.example.com"],
      modelsFactory: () => {
        const m = createModels();
        m.setProvider(faux.provider);
        return m;
      },
    });

    const server: Server = createServer((req, res) => {
      void gaia.handleRequest(req, res);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    cleanups.push(async () => {
      server.close();
      await gaia.close();
      if (ownsDir) {
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    return { gaia, baseUrl, dataDir, privateKey, faux };
  }

  it("serves /health and root Agent Card with bearerFormat JWT while guarding /api/habitats", async () => {
    const { baseUrl } = await bootTestGaia();

    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as Record<string, unknown>;
    expect(health).toMatchObject({
      status: "ok",
      name: "Gaia HabitatHost",
      runtime: "pi-durable",
      auth: "jwt+bearer",
      model: "faux/gaia-brain",
      registeredHabitats: 0,
      openHabitats: [],
    });

    const cardRes = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    expect(cardRes.status).toBe(200);
    const card = (await cardRes.json()) as {
      name: string;
      securitySchemes?: { bearer?: { httpAuthSecurityScheme?: { bearerFormat?: string } } };
    };
    expect(card.name).toBe("Gaia HabitatHost");
    expect(card.securitySchemes?.bearer?.httpAuthSecurityScheme?.bearerFormat).toBe("JWT");

    // Unauthenticated control-plane calls fail closed with 401
    const unauth = await fetch(`${baseUrl}/api/habitats`);
    expect(unauth.status).toBe(401);

    // Secondary comma-separated bearer key authenticates cleanly
    const authOk = await fetch(`${baseUrl}/api/habitats`, {
      headers: { Authorization: "Bearer key-secondary" },
    });
    expect(authOk.status).toBe(200);
  });

  it("persists Habitat declarations across host restarts without waking sleeping SQLite files", async () => {
    const sharedDir = await mkdtemp(join(tmpdir(), "umwelten-gaia-persist-"));
    try {
      const first = await bootTestGaia({ dataDir: sharedDir, useJwt: false });

      const createRes = await fetch(`${first.baseUrl}/api/habitats`, {
        method: "POST",
        headers: {
          Authorization: "Bearer key-primary",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "research-desk",
          name: "Research Desk",
          description: "Tracks weekly model releases",
          instructions: "Be concise.",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        habitat: { id: string; open: boolean; publicOrigin: string };
      };
      expect(created.habitat.id).toBe("research-desk");
      expect(created.habitat.open).toBe(false);
      expect(created.habitat.publicOrigin).toBe(
        "https://research-desk.habitats.example.com",
      );

      // Rejects reserved id "gaia" and path-traversal ids
      const badRes = await fetch(`${first.baseUrl}/api/habitats`, {
        method: "POST",
        headers: {
          Authorization: "Bearer key-primary",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: "../escape" }),
      });
      expect(badRes.status).toBe(400);

      // Restart a fresh GaiaHost over the same dataDir
      await first.gaia.close();
      const second = await bootTestGaia({ dataDir: sharedDir, useJwt: false });

      const listRes = await fetch(`${second.baseUrl}/api/habitats`, {
        headers: { Authorization: "Bearer key-primary" },
      });
      const listed = (await listRes.json()) as {
        habitats: Array<{ id: string; name: string; open: boolean }>;
      };
      expect(listed.habitats).toHaveLength(1);
      expect(listed.habitats[0]).toMatchObject({
        id: "research-desk",
        name: "Research Desk",
        open: false,
      });
    } finally {
      await rm(sharedDir, { recursive: true, force: true });
    }
  });

  it("isolates A2A 1.0 conversations per JWT speaker and supports subdomain routing", async () => {
    const { baseUrl, gaia, privateKey } = await bootTestGaia({
      responses: ["Hello Alice!", "Hello Bob!"],
    });

    await gaia.upsertHabitat({ id: "notes", name: "Notes Agent" });

    const aliceJwt = await new SignJWT({ org_id: "focus" })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("alice")
      .setAudience("https://notes.habitats.example.com")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const bobJwt = await new SignJWT({ org_id: "focus" })
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("bob")
      .setAudience("https://notes.habitats.example.com")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    // Non-admin speaker JWT cannot mutate /api/habitats control plane
    const blockedAdmin = await fetch(`${baseUrl}/api/habitats`, {
      headers: { Authorization: `Bearer ${aliceJwt}` },
    });
    expect(blockedAdmin.status).toBe(401);

    // Subdomain routing (`X-Forwarded-Host` / `Host: notes.habitats.example.com`) + per-speaker A2A SendMessage
    const sendA2A = (jwt: string, msgId: string, text: string) =>
      fetch(`${baseUrl}/a2a`, {
        method: "POST",
        headers: {
          "X-Forwarded-Host": "notes.habitats.example.com",
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
          "A2A-Version": "1.0",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: msgId,
          method: "SendMessage",
          params: {
            message: {
              messageId: msgId,
              role: "ROLE_USER",
              parts: [{ text }],
            },
          },
        }),
      });

    const rAlice = await sendA2A(aliceJwt, "m-1", "Hi from Alice");
    expect(rAlice.status).toBe(200);
    const bodyAlice = (await rAlice.json()) as {
      result?: { task?: { contextId?: string; status?: { state?: string } } };
    };
    expect(bodyAlice.result?.task?.status?.state).toBe("TASK_STATE_COMPLETED");

    const rBob = await sendA2A(bobJwt, "m-2", "Hi from Bob");
    expect(rBob.status).toBe(200);
    const bodyBob = (await rBob.json()) as {
      result?: { task?: { contextId?: string; status?: { state?: string } } };
    };
    expect(bodyBob.result?.task?.status?.state).toBe("TASK_STATE_COMPLETED");

    // Distinct speakers receive distinct conversation contexts
    expect(bodyAlice.result?.task?.contextId).not.toBe(
      bodyBob.result?.task?.contextId,
    );
  });

  it("accepts A2A requests over Docker bridge / X-Forwarded-Proto:https while rejecting plain public-IP HTTP", async () => {
    const { gaia } = await bootTestGaia({ useJwt: false });

    function mockReqRes(remoteAddress: string, headers: Record<string, string> = {}) {
      let status = 200;
      let body = "";
      const req = {
        url: "/.well-known/agent-card.json",
        method: "GET",
        headers: { host: "gaia.habitats.example.com", ...headers },
        socket: { remoteAddress },
        on: () => req,
        off: () => req,
      } as any;
      const res = {
        writableFinished: false,
        headersSent: false,
        destroyed: false,
        setHeader: () => undefined,
        writeHead: (c: number) => {
          status = c;
          res.headersSent = true;
        },
        end: (chunk?: string) => {
          body = chunk ?? "";
          res.writableFinished = true;
        },
        on: () => res,
        off: () => res,
      } as any;
      return { req, res, read: () => ({ status, body }) };
    }

    // 1. Docker bridge IP (172.18.0.2, like Caddy on internal bridge or -p 127.0.0.1:17420:7420) -> 200
    const bridgeCall = mockReqRes("172.18.0.2");
    await gaia.handleRequest(bridgeCall.req, bridgeCall.res);
    expect(bridgeCall.read().status).toBe(200);

    // 2. Public IP without TLS or X-Forwarded-Proto: https -> 400
    const publicPlainCall = mockReqRes("203.0.113.42");
    await gaia.handleRequest(publicPlainCall.req, publicPlainCall.res);
    expect(publicPlainCall.read().status).toBe(400);

    // 3. Public IP behind TLS terminator setting X-Forwarded-Proto: https -> 200
    const proxiedTlsCall = mockReqRes("203.0.113.42", {
      "x-forwarded-proto": "https",
    });
    await gaia.handleRequest(proxiedTlsCall.req, proxiedTlsCall.res);
    expect(proxiedTlsCall.read().status).toBe(200);
  });
});
