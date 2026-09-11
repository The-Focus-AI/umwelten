import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { chromium } from "playwright-core";
import {
  startContainerServer,
  type StartedContainerServer,
} from "./container-server.js";
import type { Habitat } from "./habitat.js";

// Real HTTP/auth/routing; no tools, model calls, central service, or shared data.
const habitat = {
  getConfig: () => ({ name: "login-test" }),
  getTools: () => ({}),
  getWorkDir: () => "/tmp/habitat-login-test",
} as unknown as Habitat;
let server: StartedContainerServer | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
  vi.unstubAllEnvs();
});

async function start(managed = true, issuer = "https://habitats.example") {
  const keys = await generateKeyPair("ES256");
  vi.stubEnv("HABITAT_API_KEY", "test-service-key");
  vi.stubEnv("HABITAT_AUTH_AUDIENCE", managed ? "https://child.example" : "");
  vi.stubEnv("HABITAT_AUTH_ISSUER", managed ? issuer : "");
  vi.stubEnv(
    "HABITAT_AUTH_PUBLIC_KEY",
    managed ? await exportSPKI(keys.publicKey) : "",
  );
  vi.stubEnv("HABITAT_AUTH_JWKS_URL", "");
  vi.stubEnv("HABITAT_ID", "research");
  server = await startContainerServer({ habitat, port: 0, host: "127.0.0.1" });
  const request = (
    path: string,
    headers: Record<string, string> = {},
    method = "GET",
  ) =>
    fetch(`http://127.0.0.1:${server!.port}${path}`, {
      method,
      headers: { accept: "text/html", ...headers },
      redirect: "manual",
    });
  const token = (audience: string, expiry: number) =>
    new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .setSubject("user-42")
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiry)
      .sign(keys.privateKey);
  return { request, token };
}

describe("central browser login entry", () => {
  it("redirects direct documents and explicit login, preserving safe destinations", async () => {
    const { request } = await start();
    for (const [path, returnTo] of [
      ["/", "/shell/"],
      ["/shell?panel=usage", "/shell/?panel=usage"],
      ["/shell/", "/shell/"],
      ["/shell/solo/status?panel=usage", "/shell/solo/status/?panel=usage"],
    ]) {
      const response = await request(path);
      expect(response.status).toBe(303);
      const location = new URL(response.headers.get("location")!);
      expect(location.origin).toBe("https://habitats.example");
      expect(location.pathname).toBe("/auth/handoff");
      expect(location.searchParams.get("habitat_id")).toBe("research");
      expect(location.searchParams.get("return_to")).toBe(returnTo);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    const login = await request(
      "/auth/login?return_to=%2Fshell%2F%3Fpanel%3Dusage",
    );
    expect(
      new URL(login.headers.get("location")!).searchParams.get("return_to"),
    ).toBe("/shell/?panel=usage");
    expect(
      (await request("/auth/login?return_to=https%3A%2F%2Fevil.example"))
        .status,
    ).toBe(400);
  });

  it("accepts valid user cookies but redirects expired and wrong-audience cookies", async () => {
    const { request, token } = await start();
    const now = Math.floor(Date.now() / 1000);
    for (const [audience, expiry, status] of [
      ["https://child.example", now + 300, 200],
      ["https://other.example", now + 300, 303],
      ["https://child.example", now - 30, 303],
    ] as const) {
      const response = await request("/shell/", {
        cookie: `habitat_session=${await token(audience, expiry)}`,
      });
      expect(response.status).toBe(status);
      if (status === 200)
        expect(await response.text()).toContain('src="./shell.js"');
    }
  });

  it("does not redirect API calls, modules, embedded projections, or valid service callers", async () => {
    const { request } = await start();
    expect((await request("/api/habitat")).status).toBe(401);
    expect((await request("/mcp", {}, "POST")).status).toBe(401);
    expect((await request("/shell/components/auth.js")).status).toBe(200);
    expect(
      (await request("/shell/solo/status/", { "sec-fetch-dest": "iframe" }))
        .status,
    ).toBe(200);
    expect(
      (await request("/shell/", { authorization: "Bearer test-service-key" }))
        .status,
    ).toBe(200);
  });

  it("leaves legacy-only Shell access unchanged and reports login as unconfigured", async () => {
    const { request } = await start(false);
    expect((await request("/shell/")).status).toBe(200);
    expect((await request("/auth/login")).status).toBe(404);
  });

  it("navigates Chromium to central login and opens the Shell with a user cookie", async () => {
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    });
    // This verifies browser navigation, not Clerk or the central service.
    const central = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>Central login fixture</h1>");
    });
    try {
      await new Promise<void>((resolve) =>
        central.listen(0, "127.0.0.1", resolve),
      );
      const issuer = `http://127.0.0.1:${(central.address() as AddressInfo).port}`;
      const { token } = await start(true, issuer);
      const context = await browser.newContext();
      const page = await context.newPage();
      const base = `http://127.0.0.1:${server!.port}`;
      await page.goto(`${base}/shell/?panel=usage`);
      expect(await page.getByRole("heading").textContent()).toBe(
        "Central login fixture",
      );
      expect(new URL(page.url()).searchParams.get("return_to")).toBe(
        "/shell/?panel=usage",
      );
      await context.addCookies([
        {
          name: "habitat_session",
          url: base,
          httpOnly: true,
          sameSite: "Lax",
          value: await token(
            "https://child.example",
            Math.floor(Date.now() / 1000) + 300,
          ),
        },
      ]);
      // Avoid exercising unrelated component API calls with the minimal host.
      await page.route("**/shell/shell.js", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: "",
        }),
      );
      await page.goto(`${base}/shell/?panel=usage`);
      expect(await page.title()).toBe("Shell");
      expect(await page.locator("main#region").count()).toBe(1);
      expect(page.url()).toBe(`${base}/shell/?panel=usage`);
    } finally {
      await browser.close();
      await new Promise<void>((resolve) => central.close(() => resolve()));
    }
  });
});
