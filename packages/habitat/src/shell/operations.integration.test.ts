import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { createShellHandler } from "./serve-shell.js";

let server: Server;
let browser: Browser;
let origin: string;
let report: Record<string, unknown>;
beforeAll(async () => {
  const shell = createShellHandler({
    entries: [
      { id: "tools", url: "./components/tools.js", provides: true },
      { id: "operations", url: "./components/operations.js" },
    ],
  });
  server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({
            status: "ok",
            name: "Synthetic Gaia",
            auth: "open",
          }),
        );
      return;
    }
    if (req.url === "/mcp" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const rpc = JSON.parse(body);
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(report) }],
            },
          }),
        );
      return;
    }
    if (await shell(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    args: ["--no-sandbox"],
  });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

describe("operational health panel", () => {
  it("renders fresh, degraded, stale and unavailable evidence without HTML injection", async () => {
    const page = await browser.newPage({
      viewport: { width: 1180, height: 780 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = {
      version: 1,
      observedAt: new Date().toISOString(),
      stale: false,
      recoveryEnabled: false,
      investigations: [],
      actions: [],
    };
    for (const state of ["clear", "active", "stale", "unavailable"] as const) {
      report =
        state === "unavailable"
          ? {}
          : {
              ...base,
              observedAt:
                state === "stale"
                  ? "2026-01-01T00:00:00.000Z"
                  : new Date().toISOString(),
              conditions:
                state === "clear"
                  ? []
                  : [
                      {
                        subject: "client-a",
                        severity: "error",
                        state: "active",
                        summary:
                          "SaaS registration needs an explicit organization and workspace decision.",
                      },
                    ],
              investigations:
                state === "active"
                  ? [
                      {
                        conditionId: "client-a:registration-destination",
                        decision:
                          "Operator must select an existing workspace. Do not restart this habitat.",
                      },
                    ]
                  : [],
            };
      await page.goto(`${origin}/shell/`);
      const panel = page.locator('[data-component="operations"]');
      await expect
        .poll(() => panel.textContent())
        .not.toContain("Loading observations");
      if (state === "clear")
        await expect
          .poll(() => panel.textContent())
          .toContain("No active conditions");
      if (state === "active") {
        await expect
          .poll(() => panel.textContent())
          .toContain("1 conditions need attention");
        await panel.locator("summary").click();
        expect(
          await panel.locator("details").getAttribute("open"),
        ).not.toBeNull();
      }
      if (state === "stale" || state === "unavailable")
        await expect.poll(() => panel.textContent()).toContain("Unknown");
      if (process.env.SHELL_SCREENSHOT_DIR) {
        await mkdir(process.env.SHELL_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.SHELL_SCREENSHOT_DIR,
            `gaia-operations-${state}.png`,
          ),
          fullPage: true,
        });
      }
    }
    report = {
      ...base,
      conditions: [
        {
          subject: "<img src=x onerror=alert(1)>",
          severity: "error",
          state: "active",
          summary: "<script>secret()</script>",
        },
      ],
    };
    await page.goto(`${origin}/shell/`);
    await expect
      .poll(() => page.locator('[data-component="operations"]').textContent())
      .toContain("<script>secret()</script>");
    expect(
      await page.locator('[data-component="operations"] img').count(),
    ).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);
});
