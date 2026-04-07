import { describe, it, expect } from "vitest";
import { collectUnansweredUserTexts } from "./discord-backfill.js";

describe("collectUnansweredUserTexts", () => {
  it("returns null when empty", () => {
    expect(collectUnansweredUserTexts([])).toBeNull();
  });

  it("returns null when only bot messages", () => {
    expect(
      collectUnansweredUserTexts([
        { authorIsBot: true, content: "hi" },
        { authorIsBot: true, content: "again" },
      ]),
    ).toBeNull();
  });

  it("returns user text after last bot message", () => {
    expect(
      collectUnansweredUserTexts([
        { authorIsBot: false, content: "a" },
        { authorIsBot: true, content: "b" },
        { authorIsBot: false, content: "c" },
        { authorIsBot: false, content: "d" },
      ]),
    ).toBe("c\n\nd");
  });

  it("ignores whitespace-only user lines", () => {
    expect(
      collectUnansweredUserTexts([
        { authorIsBot: true, content: "b" },
        { authorIsBot: false, content: "   " },
        { authorIsBot: false, content: "ok" },
      ]),
    ).toBe("ok");
  });

  it("returns all users when no bot in window", () => {
    expect(
      collectUnansweredUserTexts([
        { authorIsBot: false, content: "first" },
        { authorIsBot: false, content: "second" },
      ]),
    ).toBe("first\n\nsecond");
  });
});
