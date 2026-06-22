import { describe, it, expect } from "vitest";
import {
  parseSecretWritePrefixes,
  isSecretWriteAllowed,
} from "./secret-write.js";

describe("parseSecretWritePrefixes", () => {
  it("returns [] when unset/empty (endpoint disabled)", () => {
    expect(parseSecretWritePrefixes(undefined)).toEqual([]);
    expect(parseSecretWritePrefixes("")).toEqual([]);
    expect(parseSecretWritePrefixes("  ,  ")).toEqual([]);
  });
  it("splits + trims a comma list", () => {
    expect(parseSecretWritePrefixes("TWITTER_REFRESH_TOKEN:, FOO:")).toEqual([
      "TWITTER_REFRESH_TOKEN:",
      "FOO:",
    ]);
  });
});

describe("isSecretWriteAllowed", () => {
  const prefixes = ["TWITTER_REFRESH_TOKEN:"];

  it("allows a per-user key (prefix + sub suffix)", () => {
    expect(isSecretWriteAllowed("TWITTER_REFRESH_TOKEN:user-123", prefixes)).toBe(true);
  });
  it("rejects the bare prefix with no suffix", () => {
    expect(isSecretWriteAllowed("TWITTER_REFRESH_TOKEN:", prefixes)).toBe(false);
  });
  it("rejects an unrelated/global secret name", () => {
    expect(isSecretWriteAllowed("TWITTER_REFRESH_TOKEN", prefixes)).toBe(false);
    expect(isSecretWriteAllowed("OPENROUTER_API_KEY", prefixes)).toBe(false);
    expect(isSecretWriteAllowed("HABITAT_API_KEY", prefixes)).toBe(false);
  });
  it("rejects everything when no prefixes are configured (disabled)", () => {
    expect(isSecretWriteAllowed("TWITTER_REFRESH_TOKEN:user-123", [])).toBe(false);
  });
  it("supports multiple prefixes", () => {
    expect(isSecretWriteAllowed("FOO:bar", ["TWITTER_REFRESH_TOKEN:", "FOO:"])).toBe(true);
  });
});
