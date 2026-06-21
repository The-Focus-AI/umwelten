/**
 * Gaia addresses children by Docker embedded DNS, not host loopback ports
 * (#170 follow-up). entryToEndpoint → gaia-<id>:8080; entryOpenUrl prefers the
 * public Caddy hostname.
 */
import { describe, it, expect, afterEach } from "vitest";
import { entryToEndpoint, entryOpenUrl } from "./context.js";
import type { GaiaHabitatEntry } from "../types.js";

function entry(over: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
  return {
    id: "twitter",
    name: "Twitter",
    config: { name: "Twitter", agents: [] },
    secretBindings: [],
    apiKey: "gaia_k",
    createdAt: "2026-06-19T00:00:00.000Z",
    containerPort: 7440,
    ...over,
  };
}

const prevBaseDomain = process.env.GAIA_BASE_DOMAIN;
afterEach(() => {
  if (prevBaseDomain === undefined) delete process.env.GAIA_BASE_DOMAIN;
  else process.env.GAIA_BASE_DOMAIN = prevBaseDomain;
});

describe("entryToEndpoint (children by DNS)", () => {
  it("addresses the container by name on the internal port, not 127.0.0.1", () => {
    const ep = entryToEndpoint(entry());
    expect(ep.host).toBe("gaia-twitter");
    expect(ep.port).toBe(8080);
    expect(ep.apiKey).toBe("gaia_k");
  });

  it("still requires the container to be running (containerPort set)", () => {
    expect(() => entryToEndpoint(entry({ containerPort: undefined }))).toThrow(
      /not running/,
    );
  });
});

describe("entryOpenUrl", () => {
  it("prefers the public Caddy hostname when GAIA_BASE_DOMAIN is set", () => {
    process.env.GAIA_BASE_DOMAIN = "habitats.example.com";
    expect(entryOpenUrl(entry())).toBe(
      "https://twitter.habitats.example.com/?token=gaia_k",
    );
  });

  it("prefers an explicit per-habitat hostname", () => {
    expect(entryOpenUrl(entry({ hostname: "bird.dev" }))).toBe(
      "https://bird.dev/?token=gaia_k",
    );
  });

  it("falls back to the loopback port when no hostname", () => {
    delete process.env.GAIA_BASE_DOMAIN;
    expect(entryOpenUrl(entry())).toBe("http://localhost:7440/?token=gaia_k");
  });

  it("uses an explicit port override (fresh start, registry not yet updated)", () => {
    delete process.env.GAIA_BASE_DOMAIN;
    expect(entryOpenUrl(entry({ containerPort: undefined }), 7441)).toBe(
      "http://localhost:7441/?token=gaia_k",
    );
  });

  it("returns null when neither hostname nor port is available", () => {
    delete process.env.GAIA_BASE_DOMAIN;
    expect(entryOpenUrl(entry({ containerPort: undefined }))).toBeNull();
  });
});
