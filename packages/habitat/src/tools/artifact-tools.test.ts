import { describe, it, expect } from "vitest";
import { toAbsoluteArtifactUrl } from "./artifact-tools.js";

// #194 / ADR 0005 — artifact metadata stores a relative `/files/...` path;
// we absolutize at egress against the resolved public origin.
describe("toAbsoluteArtifactUrl", () => {
  it("joins a relative artifact path onto the public origin", () => {
    expect(
      toAbsoluteArtifactUrl(
        "/files/artifacts/2026-x-foo.png",
        "https://agent.example.com",
      ),
    ).toBe("https://agent.example.com/files/artifacts/2026-x-foo.png");
  });

  it("origin-roots the path regardless of any path on the origin", () => {
    // WHATWG URL: a leading slash is origin-rooted (drops the origin's path).
    expect(
      toAbsoluteArtifactUrl(
        "/files/artifacts/a.png",
        "https://host.example.com/ignored/base",
      ),
    ).toBe("https://host.example.com/files/artifacts/a.png");
  });

  it("returns the URL unchanged when no origin is provided (local dev)", () => {
    expect(toAbsoluteArtifactUrl("/files/artifacts/a.png", undefined)).toBe(
      "/files/artifacts/a.png",
    );
  });

  it("never double-joins an already-absolute URL", () => {
    const abs = "https://cdn.example.com/files/artifacts/a.png";
    expect(toAbsoluteArtifactUrl(abs, "https://agent.example.com")).toBe(abs);
  });

  it("trims a trailing slash on the origin without doubling", () => {
    expect(
      toAbsoluteArtifactUrl("/files/artifacts/a.png", "https://agent.example.com/"),
    ).toBe("https://agent.example.com/files/artifacts/a.png");
  });
});
