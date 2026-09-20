import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";
import type { ConversationMessage } from "@umwelten/substrate/conversation-view.js";
import { createShellHandler } from "./serve-shell.js";

let server: Server;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  const shell = createShellHandler();
  server = createServer(async (req, res) => {
    if (await shell(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  page = await browser.newPage();
  await page.goto(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/shell/solo/chat/`,
  );
  await page.waitForSelector("habitat-chat .log", { state: "attached" });
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function render(messages: ConversationMessage[]) {
  await page.evaluate((messages) => {
    const chat = document.querySelector("habitat-chat") as HTMLElement & {
      renderTranscript(messages: ConversationMessage[]): void;
    };
    chat.renderTranscript(messages);
  }, messages);
}

async function assistant(text: string, streaming = false) {
  await render([
    { role: "assistant", parts: [{ kind: "text", text }], streaming },
  ]);
}

describe("shared assistant Markdown in Habitat chat", () => {
  it("renders semantic blocks, nested lists, emphasis, code and safe links through browser ESM", async () => {
    await assistant(
      '# Status\n\n## C#\n\n**Ready** with *care* and `a < b`.\n\n- first\n  - nested\n- second\n\n3. third\n4. fourth\n\n```js\nconst x = "<img>";\n```\n\n[**Docs**](https://example.com/a_(b)) and [mail](mailto:help@example.com)',
    );
    expect(await page.locator(".log h1").textContent()).toBe("Status");
    expect(await page.locator(".log h2").textContent()).toBe("C#");
    expect(await page.locator(".log strong").allTextContents()).toEqual([
      "Ready",
      "Docs",
    ]);
    expect(await page.locator(".log em").textContent()).toBe("care");
    expect(await page.locator(".log ul > li").allTextContents()).toEqual([
      "firstnested",
      "nested",
      "second",
    ]);
    expect(await page.locator(".log ol").getAttribute("start")).toBe("3");
    expect(await page.locator(".log ol li").allTextContents()).toEqual([
      "third",
      "fourth",
    ]);
    expect(await page.locator(".log code").allTextContents()).toEqual([
      "a < b",
      'const x = "<img>";',
    ]);
    expect(
      await page
        .locator(".log a")
        .evaluateAll((anchors) =>
          anchors.map((a) => [
            a.getAttribute("href"),
            a.getAttribute("rel"),
            a.getAttribute("target"),
          ]),
        ),
    ).toEqual([
      ["https://example.com/a_(b)", "noopener noreferrer", "_blank"],
      ["mailto:help@example.com", "noopener noreferrer", "_blank"],
    ]);
  });

  it("never creates active HTML, images or unsafe links, including every streamed prefix", async () => {
    const attack =
      '<img src=x onerror="window.pwned=1"><svg onload="window.pwned=1"><script>window.pwned=1</script>\n\n[bad](javascript:alert(1)) [bad](JaVaScRiPt:alert(1)) [bad](data:text/html,evil) [bad](vbscript:evil) [bad](file:///etc/passwd) [bad](//evil.test) [bad](java&#x73;cript:alert(1)) [bad](java\tscript:alert(1)) [bad](https://) ![image](https://evil.test/pixel)\n\n`<iframe src=x>`\n\n```html\n<a href="javascript:evil">evil</a>\n```';
    for (let length = 0; length <= attack.length; length++) {
      await assistant(attack.slice(0, length), true);
      expect(
        await page
          .locator(".log a, .log img, .log svg, .log script, .log iframe")
          .count(),
      ).toBe(0);
    }
    expect(await page.evaluate(() => "pwned" in window)).toBe(false);
    expect(await page.locator(".log").textContent()).toContain(
      '<img src=x onerror="window.pwned=1">',
    );
  });

  it("reparses partial emphasis, destinations and fences without losing streaming state", async () => {
    await assistant("**Wor", true);
    expect(await page.locator(".log").textContent()).toBe("**Wor…");
    await assistant("**Working** [docs](https://exam", true);
    expect(await page.locator(".log strong").textContent()).toBe("Working");
    expect(await page.locator(".log a").count()).toBe(0);
    await assistant(
      "**Working** [docs](https://example.com)\n\n```ts\nconst x = 1;",
      true,
    );
    expect(await page.locator(".log a").count()).toBe(1);
    expect(await page.locator(".log pre code").textContent()).toBe(
      "const x = 1;",
    );
    expect(
      await page.locator('.log [data-role="assistant"] > p').textContent(),
    ).toBe("…");
    await assistant(
      "**Working** [docs](https://example.com)\n\n```ts\nconst x = 1;\n```\n\nDone.",
    );
    expect(await page.locator(".log pre code").textContent()).toBe(
      "const x = 1;",
    );
    expect(await page.locator('.log [data-role="assistant"] > p').count()).toBe(
      0,
    );
    expect(await page.locator(".log p").last().textContent()).toBe("Done.");
    expect(await page.locator(".log > div").count()).toBe(1);
  });

  it("preserves literal user, reasoning and error parts and transcript scrolling", async () => {
    await render([
      {
        role: "user",
        parts: [{ kind: "text", text: "**literal** <b>user</b>" }],
      },
      {
        role: "assistant",
        parts: [
          { kind: "reasoning", text: "**thinking**" },
          { kind: "tool", name: "<search>" },
          { kind: "tool", name: "done", output: false },
          { kind: "error", text: "`failed` <img>" },
          { kind: "text", text: "**answer**" },
        ],
      },
    ]);
    expect(await page.locator('.log [data-role="user"]').textContent()).toBe(
      "**literal** <b>user</b>",
    );
    expect(
      await page.locator('.log [data-role="assistant"] > p').allTextContents(),
    ).toEqual(["**thinking**", "`failed` <img>"]);
    expect(await page.locator(".log summary").allTextContents()).toEqual([
      "⚡ <search> — running…",
      "⚡ done — complete ✓",
    ]);
    expect(await page.locator(".log strong").allTextContents()).toEqual([
      "answer",
    ]);
    expect(
      await page
        .locator('.log [data-role="assistant"] > p')
        .first()
        .evaluate((p) => (p as HTMLElement).style.fontStyle),
    ).toBe("italic");
    expect(
      await page
        .locator('.log [data-role="assistant"] > p')
        .last()
        .evaluate((p) => (p as HTMLElement).style.color),
    ).toBe("var(--error)");
    await assistant(
      Array.from({ length: 80 }, (_, i) => `- line ${i}`).join("\n"),
    );
    expect(
      await page
        .locator(".log")
        .evaluate(
          (log) =>
            log.scrollTop > 0 &&
            Math.abs(log.scrollHeight - log.clientHeight - log.scrollTop) < 2,
        ),
    ).toBe(true);
  });

  it("opens running tool inputs, collapses results, and preserves manual disclosure across deltas", async () => {
    const states = await page.evaluate(() => {
      const chat = document.querySelector("habitat-chat") as HTMLElement & {
        renderTranscript(messages: ConversationMessage[]): void;
      };
      const messages: ConversationMessage[] = [
        {
          role: "assistant",
          streaming: true,
          parts: [
            {
              kind: "tool",
              name: "bash",
              input: { command: "echo '<img onerror=evil>'" },
            },
          ],
        },
      ];
      const tool = messages[0].parts[0];
      const draw = () => chat.renderTranscript(messages);
      const details = () => chat.querySelector("details")!;
      const states: boolean[] = [];
      draw();
      states.push(details().open);
      messages[0].parts.push({ kind: "text", text: "Still working…" });
      draw();
      states.push(details().open);
      tool.output = "<script>evil()</script>\n**literal output**";
      draw();
      states.push(details().open);
      details().querySelector("summary")!.click();
      states.push(details().open);
      draw();
      states.push(details().open);
      details().querySelector("summary")!.click();
      draw();
      states.push(details().open);
      return states;
    });
    expect(states).toEqual([true, true, false, true, true, false]);
    expect(await page.locator(".log details pre").allTextContents()).toEqual([
      '{\n  "command": "echo \'<img onerror=evil>\'"\n}',
      "<script>evil()</script>\n**literal output**",
    ]);
    expect(
      await page.locator(".log img, .log script, .log strong").count(),
    ).toBe(0);
    await render([
      {
        role: "assistant",
        streaming: false,
        parts: [
          { kind: "tool", name: "false-result", output: false },
          { kind: "tool", name: "null-result", output: null },
          { kind: "tool", name: "empty-result", output: "" },
          { kind: "tool", name: "interrupted" },
        ],
      },
    ]);
    expect(
      await page
        .locator(".log details")
        .evaluateAll((nodes) =>
          nodes.map((node) => (node as HTMLDetailsElement).open),
        ),
    ).toEqual([false, false, false, true]);
    expect(await page.locator(".log details").last().textContent()).toBe(
      "⚡ interrupted — no resultNo result received.",
    );
  });

  it("keeps long code and tool results inside the chat on a narrow viewport", async () => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await render([
      {
        role: "assistant",
        streaming: true,
        parts: [
          {
            kind: "text",
            text:
              "## Narrow preview\n\n```ts\nconst url = 'https://example.com/" +
              "long-path".repeat(25) +
              "';\n```",
          },
          {
            kind: "tool",
            name: "bash",
            input: { command: "echo " + "x".repeat(200) },
          },
        ],
      },
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".log pre")
        .evaluateAll((nodes) =>
          nodes.every((node) => node.scrollWidth <= node.clientWidth + 1),
        ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});
