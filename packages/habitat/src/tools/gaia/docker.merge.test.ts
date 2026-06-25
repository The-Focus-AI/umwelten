import { describe, it, expect } from "vitest";
import { mergeSecretsJson } from "./docker.js";

const seed = JSON.stringify(
  { OPENROUTER_API_KEY: "new-key", TWITTER_CLIENT_ID: "cid" },
  null,
  2,
);

describe("mergeSecretsJson (re-seed preserves habitat-owned secrets)", () => {
  it("preserves per-user TOKEN:<sub> keys the seed doesn't manage", () => {
    const existing = JSON.stringify({
      OPENROUTER_API_KEY: "old-key",
      "TWITTER_REFRESH_TOKEN:user_abc": "rotated-per-user-token",
    });
    const out = JSON.parse(mergeSecretsJson(existing, seed));
    // per-user token survives the rebuild
    expect(out["TWITTER_REFRESH_TOKEN:user_abc"]).toBe("rotated-per-user-token");
    // operator-seeded key updates
    expect(out.OPENROUTER_API_KEY).toBe("new-key");
    expect(out.TWITTER_CLIENT_ID).toBe("cid");
  });

  it("returns the seed verbatim when the volume has no existing secrets", () => {
    expect(mergeSecretsJson("", seed)).toBe(seed);
    expect(mergeSecretsJson("   \n", seed)).toBe(seed);
  });

  it("falls back to the seed when existing content isn't valid JSON", () => {
    expect(mergeSecretsJson("not json{", seed)).toBe(seed);
  });

  it("operator seed wins on key conflict", () => {
    const existing = JSON.stringify({ OPENROUTER_API_KEY: "stale" });
    const out = JSON.parse(mergeSecretsJson(existing, seed));
    expect(out.OPENROUTER_API_KEY).toBe("new-key");
  });
});
