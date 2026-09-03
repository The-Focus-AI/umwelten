/**
 * The Client surface (#409), as unit tests: the Exchange serves the same
 * shell contract as every habitat — page, boot script, its own manifest,
 * the transpiled substrate — and nothing outside the contract or beyond
 * read-only components.
 */

import { describe, it, expect } from "vitest";
import http from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import {
  createAccountSurfaceHandler,
  createClientSurfaceHandler,
} from "./serve.js";
import { createExchangeApp } from "../server.js";
import { MemoryStore } from "../store/memory-store.js";

async function get(
  handler: ReturnType<typeof createClientSurfaceHandler>,
  path: string,
) {
  const server = http.createServer(async (req, res) => {
    if (await handler(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      redirect: "manual",
    });
    return {
      status: res.status,
      location: res.headers.get("location"),
      body: await res.text(),
    };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe("the Exchange's client surface", () => {
  it("packages every runtime-read browser asset into the bundled image", async () => {
    const dockerfile = await readFile(
      new URL("../../Dockerfile", import.meta.url),
      "utf8",
    );
    expect(dockerfile).toContain("packages/substrate/shell /shell");
    expect(dockerfile).toContain("packages/substrate/src /src");
    expect(dockerfile).toContain(
      "packages/mycel/src/client-surface/components /app/components",
    );
    expect(dockerfile).toContain(
      "COPY --from=mycel-client --chown=mycel:mycel /client/dist /app/landing",
    );
    expect(dockerfile).toContain("apps/mycel-client/pnpm-lock.yaml");
    expect(dockerfile).toContain(
      "apps/mycel-client/vite.config.js ./vite.config.js",
    );
    expect(dockerfile).toContain("apps/mycel-client/public ./public");
    expect(dockerfile).toContain("ESBUILD_BINARY_PATH=/usr/local/bin/esbuild");
    expect(dockerfile).toContain(
      "COPY --from=esbuild-binary /esbuild /usr/local/bin/esbuild",
    );
  });

  it("serves the standard shell page under the contract", async () => {
    const r = await get(createClientSurfaceHandler(), "/shell/");
    expect(r.status).toBe(200);
    expect(r.body).toContain('src="./shell.js"');
  });

  it("its manifest is exactly the read-only components", async () => {
    const r = await get(createClientSurfaceHandler(), "/shell/manifest.json");
    const manifest = JSON.parse(r.body);
    expect(manifest.entries.map((e: { id: string }) => e.id)).toEqual([
      "health",
      "models",
      "catalogue-stats",
    ]);
  });

  it("declares no providers — evolved components are read-only by construction (#410)", async () => {
    // No provider entries means no shell:tools (or any mutating service)
    // exists on this host for an agent-authored component to inject; all it
    // can reach is the Exchange's public read endpoints.
    const r = await get(createClientSurfaceHandler(), "/shell/manifest.json");
    const manifest = JSON.parse(r.body) as {
      entries: { id: string; provides?: boolean }[];
    };
    expect(manifest.entries.filter((e) => e.provides)).toEqual([]);
  });

  it("serves the trusted account as a separate component assembly", async () => {
    const handler = createAccountSurfaceHandler();
    const bare = await get(handler, "/account");
    expect(bare.status).toBe(302);
    expect(bare.location).toBe("/account/");

    const page = await get(handler, "/account/");
    expect(page.status).toBe(200);
    expect(page.body).toContain('src="./shell.js"');

    const manifest = JSON.parse(
      (await get(handler, "/account/manifest.json")).body,
    ) as { entries: { id: string; provides?: boolean; url: string }[] };
    expect(manifest.entries.map((entry) => entry.id)).toEqual([
      "account-authentication",
      "account-layout",
      "account-customer",
      "account-overview",
      "account-applications",
      "account-playground",
      "account-funding",
      "account-admin-grant",
      "account-supplier-connections",
      "account-ledger",
      "account-usage",
      "account-team",
    ]);
    expect(
      manifest.entries
        .filter((entry) => entry.provides)
        .map((entry) => entry.id),
    ).toEqual(["account-authentication", "account-layout", "account-customer"]);
    expect(manifest.entries[0].url).toBe("/assets/account-authentication.js");
  });

  it("serves agent-authored components live from a configured dir (#410)", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "mycel-components-"));
    try {
      await writeFile(join(dir, "spark.js"), "export default { apply() {} };");
      const handler = createClientSurfaceHandler({ componentsDir: dir });
      const manifest = JSON.parse(
        (await get(handler, "/shell/manifest.json")).body,
      );
      const custom = manifest.entries.find(
        (e: { id: string }) => e.id === "custom:spark",
      );
      expect(custom.url).toBe("./custom/spark.js");
      expect(typeof custom.version).toBe("number");
      expect((await get(handler, "/shell/custom/spark.js")).status).toBe(200);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("transpiles the substrate to browser ESM", async () => {
    const r = await get(
      createClientSurfaceHandler(),
      "/shell/substrate/index.js",
    );
    expect(r.status).toBe(200);
    expect(r.body).not.toMatch(/\binterface\s+\w/);
    expect(r.body).toMatch(/export\s*\{/);
  });

  it("serves the shared conversation view used by Habitat and Mycel chat", async () => {
    const r = await get(
      createAccountSurfaceHandler(),
      "/account/substrate/conversation-view.js",
    );
    expect(r.status).toBe(200);
    expect(r.body).toContain("renderConversation");
  });

  it("serves its component modules raw", async () => {
    for (const [name, marker] of [
      ["health.js", "/health"],
      ["models.js", "/v1/models"],
    ]) {
      const r = await get(
        createClientSurfaceHandler(),
        `/shell/components/${name}`,
      );
      expect(r.status, name).toBe(200);
      expect(r.body, name).toContain(marker);
    }
  });

  it("refuses traversal", async () => {
    for (const path of [
      "/shell/components/../serve.js",
      "/shell/components/..%2Fserve.js",
      "/shell/substrate/../../server.js",
    ]) {
      const r = await get(createClientSurfaceHandler(), path);
      expect(r.status, path).toBe(404);
    }
  });
});

describe("wired into the exchange app", () => {
  async function appGet(path: string) {
    const app = createExchangeApp(new MemoryStore());
    const server = http.createServer((req, res) => void app(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        redirect: "manual",
      });
      return {
        status: res.status,
        location: res.headers.get("location"),
        body: await res.text(),
      };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  it("the hostname root serves the public product page", async () => {
    const r = await appGet("/");
    expect(r.status).toBe(200);
    expect(r.body).toContain("Mycel — intelligence grows in networks");
    expect(r.body).toContain('href="/shell/"');
  });

  it("the account route is the trusted substrate assembly", async () => {
    const redirect = await appGet("/account");
    expect(redirect.status).toBe(302);
    expect(redirect.location).toBe("/account/");
    const manifest = await appGet("/account/manifest.json");
    expect(manifest.status).toBe(200);
    expect(manifest.body).toContain('"account-applications"');
  });

  it("the exchange endpoints are untouched beside it", async () => {
    expect((await appGet("/health")).status).toBe(200);
    expect((await appGet("/v1/models")).status).toBe(200);
    expect((await appGet("/nope")).status).toBe(404);
  });
});
