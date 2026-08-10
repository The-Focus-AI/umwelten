import { describe, expect, it } from "vitest";
import { parseMemoryContent } from "./partner.js";

const full = {
  aboutYou: ["Chose the paperclip inventor."],
  aboutThem: ["Finds small inventions charming."],
  connection: ["Both like overlooked history."],
};

describe("parseMemoryContent", () => {
  it("parses the JSON string generateObject actually returns", () => {
    expect(parseMemoryContent(JSON.stringify(full))).toEqual({
      you: full.aboutYou,
      them: full.aboutThem,
      connection: full.connection,
    });
  });

  it("accepts an already-parsed object", () => {
    expect(parseMemoryContent(full).you).toEqual(full.aboutYou);
  });

  it("defaults the buckets the model left out", () => {
    const parsed = parseMemoryContent(
      JSON.stringify({ aboutYou: ["Values directness."] }),
    );
    expect(parsed.you).toEqual(["Values directness."]);
    expect(parsed.them).toEqual([]);
    expect(parsed.connection).toEqual([]);
  });

  it("tolerates a fenced code block", () => {
    const parsed = parseMemoryContent(
      "```json\n" + JSON.stringify(full) + "\n```",
    );
    expect(parsed.them).toEqual(full.aboutThem);
  });

  it("throws on empty content rather than reporting nothing learned", () => {
    expect(() => parseMemoryContent("")).toThrow(/no content/);
    expect(() => parseMemoryContent("   ")).toThrow(/no content/);
  });

  it("throws when the model returned prose instead of JSON", () => {
    expect(() => parseMemoryContent("Sure! Here are some facts about you.")).toThrow(
      /not JSON/,
    );
  });

  it("throws when the shape is wrong", () => {
    expect(() => parseMemoryContent(JSON.stringify({ aboutYou: "a string" }))).toThrow(
      /did not match the schema/,
    );
  });
});
