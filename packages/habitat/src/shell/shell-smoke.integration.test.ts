/**
 * The shell, end to end in a real browser — mounted on a BARE node http
 * server, not the container. That is the point: the shell binds to the
 * serving contract alone, so any host that answers the contract's paths
 * (plus whatever endpoints its components call — /health here) hosts it.
 *
 * Integration test: launches the preinstalled chromium via playwright-core.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { createShellHandler } from "./serve-shell.js";

let server: Server;
let browser: Browser;
let baseUrl: string;
let customDir: string;
/** tools/call invocations the /mcp stub received: [name, args]. */
let toolCalls: Array<[string, Record<string, unknown>]>;
/** The stub's secret store, so panel round-trips are observable. */
let secretNames: string[];

// Exercise real navigation and tab storage without a central account or model.
async function loginFixture(page: Page, mode = "success") {
  const state = {
    expired: false,
    logins: 0,
    attempts: [] as Array<{ id: string; text: string; accepted: boolean }>,
  };
  await page.route("**/auth/session", (route) => route.fulfill({
    json: { userId: state.logins && mode === "different-user" ? "bob" : "alice", browserLogin: true },
  }));
  await page.route("**/auth/login?*", async (route) => {
    state.logins++;
    state.expired = mode === "still-expired";
    const returnTo = new URL(route.request().url()).searchParams.get("return_to")!;
    await route.fulfill({ status: 302, headers: { location: returnTo }, body: "" });
  });
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    state.attempts.push({ id: body.id, text: body.messages[0].content, accepted: !state.expired });
    if (state.expired) {
      if (mode === "network-error") return route.abort("failed");
      await route.fulfill({ status: mode === "server-error" ? 500 : 401, json: { error: "Request rejected" } });
    } else {
      await route.continue();
    }
  });
  await page.route("**/mcp", (route) => state.expired
    ? route.fulfill({ status: 401, json: { error: "Unauthorized" } })
    : route.continue());
  await page.goto(`${baseUrl}/shell/?panel=chat`);
  await page.locator("habitat-chat").waitFor({ state: "visible" });
  const chat = page.locator("habitat-chat");
  await chat.locator("input").fill("first message");
  await chat.locator("button").click();
  await expect.poll(() => chat.locator(".log").textContent()).toContain("echo: first message");
  await expect.poll(() => chat.locator("button").isEnabled()).toBe(true);
  return state;
}

/** Answer a tools/call like the habitat's stateless /mcp would. */
function stubToolResult(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "secrets_list":
      return { secrets: secretNames };
    case "secrets_set":
      secretNames.push(String(args.name));
      return { ok: true };
    case "secrets_remove":
      secretNames = secretNames.filter((n) => n !== args.name);
      return { ok: true };
    case "sessions_list":
      return {
        sessions: [
          {
            sessionId: "sess-1",
            firstPrompt: "build me a clock",
            messageCount: 4,
          },
        ],
      };
    case "sessions_messages":
      return {
        messages: [
          { role: "user", content: "build me a clock" },
          { role: "assistant", content: "done — mounted session-clock" },
        ],
      };
    default:
      throw new Error(`stub has no tool ${name}`);
  }
}

beforeAll(async () => {
  customDir = await mkdtemp(join(tmpdir(), "shell-smoke-custom-"));
  toolCalls = [];
  secretNames = ["TAVILY_API_KEY"];
  const shell = createShellHandler({ customComponentsDir: customDir });
  server = createServer(async (req, res) => {
    if (req.url?.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          name: "smoke-habitat",
          tools: 7,
          auth: "open",
          model: "test/model-1",
        }),
      );
      return;
    }
    if (req.url?.startsWith("/mcp") && req.method === "POST") {
      // Stateless tools/call, one JSON-RPC message per POST — the same
      // contract the habitat's /mcp answers (verified by probe in #402).
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const rpc = JSON.parse(raw) as {
        id: number;
        params: { name: string; arguments?: Record<string, unknown> };
      };
      const args = rpc.params.arguments ?? {};
      toolCalls.push([rpc.params.name, args]);
      let body: unknown;
      try {
        const result = stubToolResult(rpc.params.name, args);
        body = {
          jsonrpc: "2.0",
          id: rpc.id,
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        };
      } catch (err) {
        body = {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            isError: true,
            content: [{ type: "text", text: String(err) }],
          },
        };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    if (req.url?.startsWith("/api/chat") && req.method === "POST") {
      // A minimal UI-message stream: echo the last user text back with a
      // tool event in the middle, in the same wire vocabulary the real
      // container emits (web/ui-stream.ts).
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as {
        messages: { role: string; content: string }[];
      };
      const text = body.messages.at(-1)?.content ?? "";
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = (e: object) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (text === "fail before reply" || text === "fail after partial reply") {
        if (text === "fail after partial reply") {
          emit({ type: "text-delta", id: "m1", delta: "Partial answer" });
        }
        emit({ type: "error", errorText: "HTTP 503: no_eligible_offer" });
        res.end("data: [DONE]\n\n");
        return;
      }
      emit({ type: "reasoning-delta", delta: "thinking about it" });
      emit({
        type: "tool-input-available",
        toolCallId: "t1",
        toolName: "current_time",
        input: {},
      });
      emit({ type: "tool-output-available", toolCallId: "t1", output: "now" });
      emit({ type: "text-delta", id: "m1", delta: "echo: " });
      emit({ type: "text-delta", id: "m1", delta: text });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    if (await shell(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // PLAYWRIGHT_CHROMIUM points at a system chromium when the environment
  // pre-installs one whose build differs from playwright-core's pin (the
  // remote runner ships /opt/pw-browsers/chromium). Unset, playwright
  // resolves its own browsers as usual.
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
  await rm(customDir, { recursive: true, force: true });
});

describe("the shell assembles itself in a browser", () => {
  it("boots, loads the manifest, mounts the status component, renders live data", async () => {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await page.goto(`${baseUrl}/shell`);

    // The status component is a mounted custom element...
    const card = page.locator("habitat-status");
    await card.waitFor({ state: "visible", timeout: 10_000 });

    // ...rendering data fetched from the host, not placeholders.
    await expect
      .poll(async () => card.textContent(), { timeout: 10_000 })
      .toContain("smoke-habitat");
    expect(await card.textContent()).toContain("test/model-1");

    // The shell reports the assembly honestly (written when sync settles).
    await expect
      .poll(() => page.locator("#shell-status").textContent(), {
        timeout: 10_000,
      })
      .toContain("8 components mounted");

    // The loader is live page state, not a build artifact.
    const entries = await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__shell.loader.entries().map((e: any) => ({
        id: e.id,
        active: e.fiber?.active,
      })),
    );
    expect(entries).toEqual([
      { id: "layout", active: true },
      { id: "status", active: true },
      { id: "conversation", active: true },
      { id: "tools", active: true },
      { id: "chat", active: true },
      { id: "quick-prompts", active: true },
      { id: "secrets", active: true },
      { id: "sessions", active: true },
    ]);

    expect(pageErrors).toEqual([]);
    await page.close();
  }, 30_000);

  it("chat streams a reply through the conversation service", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);
    const chat = page.locator("habitat-chat");
    await chat.waitFor({ state: "visible", timeout: 10_000 });

    await chat.locator("input").fill("hello substrate");
    await chat.locator("button").click();

    // User bubble, streamed reply, tool event, reasoning — all rendered.
    await expect
      .poll(() => chat.locator(".log").textContent(), { timeout: 10_000 })
      .toContain("echo: hello substrate");
    const log = await chat.locator(".log").textContent();
    expect(log).toContain("hello substrate"); // the user's message
    expect(log).toContain("current_time"); // the tool event
    expect(log).toContain("thinking about it"); // the reasoning line
    await page.close();
  }, 30_000);

  it.each(["fail before reply", "fail after partial reply"])(
    "chat displays stream errors: %s",
    async (prompt) => {
      const page = await browser.newPage();
      try {
        await page.goto(`${baseUrl}/shell/`);
        const chat = page.locator("habitat-chat");
        await chat.waitFor({ state: "visible", timeout: 10_000 });
        await chat.locator("input").fill(prompt);
        await chat.locator("button").click();
        await expect.poll(() => chat.locator('[data-role="assistant"]').last().textContent()).toBe(
          (prompt === "fail after partial reply" ? "Partial answer" : "") + "HTTP 503: no_eligible_offer",
        );
        await expect.poll(() => chat.locator("button").isEnabled()).toBe(true);
        await chat.locator("input").fill("try again");
        await chat.locator("button").click();
        await expect.poll(() => chat.locator('[data-role="assistant"]').last().textContent()).toContain("echo: try again");
      } finally { await page.close(); }
    },
  );

  it("signs in again and resumes only the rejected chat with the same thread and history", async () => {
    const page = await browser.newPage();
    try {
      const state = await loginFixture(page);
      state.expired = true;
      const chat = page.locator("habitat-chat");
      await chat.locator("input").fill("second message");
      await chat.locator("button").click();
      await expect.poll(() => chat.locator(".log").textContent()).toContain("echo: second message");
      expect(state.logins).toBe(1);
      expect(state.attempts.map(({ text, accepted }) => ({ text, accepted }))).toEqual([
        { text: "first message", accepted: true },
        { text: "second message", accepted: false },
        { text: "second message", accepted: true },
      ]);
      expect(new Set(state.attempts.map((attempt) => attempt.id)).size).toBe(1);
      expect(await chat.locator('[data-role="user"]').count()).toBe(2);
      expect(await chat.locator(".log").textContent()).toContain("echo: first message");
      expect(new URL(page.url()).search).toBe("?panel=chat");
      expect(await page.evaluate(() => sessionStorage.getItem("shell:conversation-login"))).toBeNull();
    } finally { await page.close(); }
  });

  it("renders Markdown and inspectable tool results after sign-in recovery", async () => {
    const page = await browser.newPage();
    try {
      const state = await loginFixture(page);
      state.expired = true;
      const chat = page.locator("habitat-chat");
      await chat.locator("input").fill("**Preview ready** [Open preview](https://example.com/preview)");
      await chat.locator("button").click();
      await expect.poll(() => chat.locator("strong").textContent()).toBe("Preview ready");
      expect(state.logins).toBe(1);
      expect(await chat.locator("a").getAttribute("href")).toBe("https://example.com/preview");
      const tool = chat.locator("details").last();
      expect(await tool.getAttribute("open")).toBeNull();
      await tool.locator("summary").click();
      expect(await tool.locator("pre").allTextContents()).toEqual(["{}", "now"]);
      await chat.locator("input").fill("fail after partial reply");
      await chat.locator("button").click();
      await expect.poll(() => chat.locator('[data-role="assistant"]').last().textContent()).toBe("Partial answerHTTP 503: no_eligible_offer");
    } finally { await page.close(); }
  });

  it("preserves an unsent draft when a panel discovers session expiry", async () => {
    const page = await browser.newPage();
    try {
      const state = await loginFixture(page);
      await page.locator("habitat-chat input").fill("draft not sent yet");
      state.expired = true;
      await page.locator('[data-session="sess-1"]').click();
      await expect.poll(() => state.logins).toBe(1);
      await expect.poll(() => page.locator("habitat-chat input").inputValue()).toBe("draft not sent yet");
      expect(state.attempts).toHaveLength(1);
      expect(await page.locator("habitat-chat .log").textContent()).toContain("echo: first message");
    } finally { await page.close(); }
  });

  it("does not let a panel's expiry interrupt a chat already in flight", async () => {
    const page = await browser.newPage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      const state = await loginFixture(page);
      await page.route("**/api/chat", async (route) => {
        await gate;
        await route.fulfill({
          contentType: "text/event-stream",
          body: 'data: {"type":"text-delta","delta":"finished once"}\n\ndata: [DONE]\n\n',
        });
      });
      await page.locator("habitat-chat input").fill("long request");
      await page.locator("habitat-chat button").click();
      await expect.poll(() => page.locator("habitat-chat button").isDisabled()).toBe(true);
      state.expired = true;
      await page.locator('[data-session="sess-1"]').click();
      await expect.poll(() => page.locator('[data-component="sessions"]').textContent()).toContain("Your session expired");
      expect(state.logins).toBe(0);
      release();
      await expect.poll(() => page.locator("habitat-chat .log").textContent()).toContain("finished once");
    } finally { release(); await page.close(); }
  });

  it.each(["different-user", "still-expired", "server-error", "network-error"])("does not leak history or replay indefinitely: %s", async (mode) => {
    const page = await browser.newPage();
    try {
      const state = await loginFixture(page, mode);
      state.expired = true;
      await page.locator("habitat-chat input").fill("private pending message");
      await page.locator("habitat-chat button").click();
      if (mode === "different-user") {
        await expect.poll(() => state.logins).toBe(1);
        await expect.poll(() => page.locator('habitat-chat [data-role="user"]').count()).toBe(0);
        expect(await page.locator("habitat-chat .log").textContent()).not.toContain("first message");
        expect(state.attempts).toHaveLength(2);
      } else {
        await expect.poll(() => page.locator("habitat-chat .log").textContent()).toContain(
          mode === "still-expired" ? "Your session expired" : mode === "network-error" ? "Failed to fetch" : "HTTP 500",
        );
        expect(state.logins).toBe(mode === "still-expired" ? 1 : 0);
        expect(state.attempts).toHaveLength(mode === "still-expired" ? 3 : 2);
      }
    } finally { await page.close(); }
  });

  it("self-assembly: a component file written to the custom dir appears live, edits hot-replace, removal unmounts", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);
    await page.locator("habitat-status").waitFor({ state: "visible" });

    const componentSource = (label: string) => `
      import { serviceKey } from "../substrate/index.js";
      const regionKey = serviceKey("shell:region");
      export default {
        name: "greeting",
        inject: [regionKey],
        apply(ctx, view) {
          const el = document.createElement("div");
          el.className = "shell-card";
          el.dataset.component = "greeting";
          el.innerHTML = "<h2>greeting</h2><p>${label}</p>";
          view.get(regionKey).appendChild(el);
          return () => el.remove();
        },
      };
    `;

    // 1. The agent (here: the test, same file write) creates a component.
    await writeFile(join(customDir, "greeting.js"), componentSource("hello from v1"));
    const card = page.locator('[data-component="greeting"]');
    await card.waitFor({ state: "visible", timeout: 15_000 }); // no reload
    expect(await card.textContent()).toContain("hello from v1");

    // 2. An edit hot-replaces it (mtime moves → version moves → reload).
    await new Promise((r) => setTimeout(r, 10)); // ensure mtime advances
    await writeFile(join(customDir, "greeting.js"), componentSource("hello from v2"));
    await expect
      .poll(() => card.textContent(), { timeout: 15_000 })
      .toContain("hello from v2");

    // 3. Removal unmounts it from the live page.
    await rm(join(customDir, "greeting.js"));
    await expect.poll(() => card.count(), { timeout: 15_000 }).toBe(0);

    await page.close();
  }, 60_000);

  it("a quick-prompt click lands in the chat transcript — the service is shared, not chat-private", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);
    await page.locator("habitat-chat").waitFor({ state: "visible" });

    await page
      .locator('[data-component="quick-prompts"] button')
      .first()
      .click();

    await expect
      .poll(() => page.locator("habitat-chat .log").textContent(), {
        timeout: 10_000,
      })
      .toContain("echo: What tools do you have?");
    await page.close();
  }, 30_000);

  it("secrets panel: list, set (write-only), remove — all through tools/call, no private routes", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);
    const panel = page.locator('[data-component="secrets"]');
    await panel.waitFor({ state: "visible", timeout: 10_000 });

    // Lists what the tool reports.
    await expect
      .poll(() => panel.textContent(), { timeout: 10_000 })
      .toContain("TAVILY_API_KEY");

    // Set: value field clears immediately; the new name appears via refresh.
    await panel.locator('input[name="name"]').fill("NEW_KEY");
    await panel.locator('input[name="value"]').fill("super-secret-value");
    await panel.locator("form button").click();
    expect(await panel.locator('input[name="value"]').inputValue()).toBe("");
    await expect
      .poll(() => panel.textContent(), { timeout: 10_000 })
      .toContain("NEW_KEY");
    // The value never appears anywhere in the page.
    expect(await page.content()).not.toContain("super-secret-value");

    // Remove.
    await panel.locator('[data-remove="NEW_KEY"]').click();
    await expect
      .poll(() => panel.textContent(), { timeout: 10_000 })
      .not.toContain("NEW_KEY");

    // Everything went through the tool surface.
    const names = toolCalls.map(([n]) => n);
    expect(names).toContain("secrets_list");
    expect(names).toContain("secrets_set");
    expect(names).toContain("secrets_remove");
    await page.close();
  }, 30_000);

  it("sessions panel: lists sessions and opens one to its messages", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/`);
    const panel = page.locator('[data-component="sessions"]');
    await panel.waitFor({ state: "visible", timeout: 10_000 });

    await expect
      .poll(() => panel.textContent(), { timeout: 10_000 })
      .toContain("build me a clock");

    await panel.locator('[data-session="sess-1"]').click();
    await expect
      .poll(() => panel.textContent(), { timeout: 10_000 })
      .toContain("done — mounted session-clock");

    await panel.locator(".back").click();
    await expect(
      await panel.locator("ul").isVisible(),
    ).toBe(true);
    await page.close();
  }, 30_000);

  it("a solo page mounts exactly its target component (#406's mountable projection)", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell/solo/status/`);

    // The target renders with live data...
    const card = page.locator("habitat-status");
    await card.waitFor({ state: "visible", timeout: 10_000 });
    await expect
      .poll(() => card.textContent(), { timeout: 10_000 })
      .toContain("smoke-habitat");

    // ...and nothing else does: panels stay out, only providers rode along.
    expect(await page.locator("habitat-chat").count()).toBe(0);
    expect(await page.locator('[data-component="secrets"]').count()).toBe(0);
    await page.close();
  }, 30_000);

  it("unmounting through the loader reverts the component from the live page", async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/shell`);
    await page.locator("habitat-status").waitFor({ state: "visible" });

    await page.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__shell.loader.apply([]),
    );

    await expect
      .poll(() => page.locator("habitat-status").count())
      .toBe(0);
    await page.close();
  }, 30_000);
});
