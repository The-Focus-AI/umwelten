import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createLandingHandler } from "./landing.js";

async function request(path: string, method = "GET") {
  const handler = createLandingHandler();
  const server = http.createServer(async (req, res) => {
    if (await handler(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      body: await response.text(),
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("Mycel's public landing page", () => {
  it("serves the page and its explicit assets", async () => {
    const page = await request("/?source=test");
    expect(page.status).toBe(200);
    expect(page.type).toContain("text/html");
    expect(page.body).toContain("Intelligence grows");
    expect(page.body).toContain("Create account");

    // `/account/` belongs to the substrate assembly, not this static handler.
    expect((await request("/account?funding=success")).status).toBe(404);

    const scriptPath = page.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    const stylePath = page.body.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    expect(scriptPath).toBeTruthy();
    expect(stylePath).toBeTruthy();

    const css = await request(stylePath!);
    expect(css.status).toBe(200);
    expect(css.type).toContain("text/css");
    expect(css.body).toContain("prefers-reduced-motion");

    const animation = await request(scriptPath!);
    expect(animation.status).toBe(200);
    expect(animation.type).toContain("text/javascript");
    expect(animation.body).toContain("requestAnimationFrame");
    expect(animation.body).toContain("/v1/models");

    const authentication = await request("/assets/account-authentication.js");
    expect(authentication.status).toBe(200);
    expect(authentication.body).toContain("export");

    const agentGuide = await request("/llms.txt");
    expect(agentGuide.status).toBe(200);
    expect(agentGuide.type).toContain("text/plain");
    expect(agentGuide.body).toContain("/v1/models");
    expect(agentGuide.body).toContain("catalogue is dynamic");

    const fullAgentGuide = await request("/llms-full.txt");
    expect(fullAgentGuide.status).toBe(200);
    expect(fullAgentGuide.body).toContain("sorted lexicographically");
    expect(fullAgentGuide.body).toContain("not array position");

    const openapi = await request("/openapi.json");
    expect(openapi.status).toBe(200);
    expect(openapi.type).toContain("application/json");
    expect(JSON.parse(openapi.body).paths).toHaveProperty("/models");
    expect(JSON.parse(openapi.body).paths).toHaveProperty("/chat/completions");
  });

  it("answers HEAD without sending the asset body", async () => {
    const page = await request("/");
    const stylePath = page.body.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    const response = await request(stylePath!, "HEAD");
    expect(response.status).toBe(200);
    expect(response.body).toBe("");
  });

  it("leaves unknown paths and non-read methods to the Exchange", async () => {
    expect((await request("/assets/nope.js")).status).toBe(404);
    expect((await request("/assets/%2e%2e/server.ts")).status).toBe(404);
    expect((await request("/package.json")).status).toBe(404);
    expect((await request("/", "POST")).status).toBe(404);
  });
});
