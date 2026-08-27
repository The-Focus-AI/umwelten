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
const prevSaasUrl = process.env.HABITATS_SAAS_URL;
const prevRegistryUrl = process.env.HABITATS_SAAS_REGISTRY_URL;
afterEach(() => {
  if (prevBaseDomain === undefined) delete process.env.GAIA_BASE_DOMAIN;
  else process.env.GAIA_BASE_DOMAIN = prevBaseDomain;
  if (prevSaasUrl === undefined) delete process.env.HABITATS_SAAS_URL;
  else process.env.HABITATS_SAAS_URL = prevSaasUrl;
  if (prevRegistryUrl === undefined) delete process.env.HABITATS_SAAS_REGISTRY_URL;
  else process.env.HABITATS_SAAS_REGISTRY_URL = prevRegistryUrl;
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
    process.env.HABITATS_SAAS_URL = "https://habitats.thefocus.ai";
    expect(entryOpenUrl(entry())).toBe(
      "https://habitats.thefocus.ai/auth/handoff?habitat_id=twitter&return_to=%2Fshell%2F",
    );
  });

  it("uses a clean child URL when the SaaS handoff is not configured", () => {
    expect(entryOpenUrl(entry({ hostname: "bird.dev" }))).toBe(
      "https://bird.dev/shell/",
    );
  });

  it("derives the handoff origin from the registry endpoint", () => {
    process.env.HABITATS_SAAS_REGISTRY_URL =
      "https://habitats.example/api/admin/umwelten/register";
    expect(entryOpenUrl(entry({ hostname: "bird.dev" }))).toBe(
      "https://habitats.example/auth/handoff?habitat_id=twitter&return_to=%2Fshell%2F",
    );
  });

  it("falls back to the loopback port when no hostname", () => {
    delete process.env.GAIA_BASE_DOMAIN;
    expect(entryOpenUrl(entry())).toBe("http://localhost:7440/shell/");
  });

  it("uses an explicit port override (fresh start, registry not yet updated)", () => {
    delete process.env.GAIA_BASE_DOMAIN;
    expect(entryOpenUrl(entry({ containerPort: undefined }), 7441)).toBe(
      "http://localhost:7441/shell/",
    );
  });

  it("returns null when neither hostname nor port is available", () => {
    delete process.env.GAIA_BASE_DOMAIN;
    expect(entryOpenUrl(entry({ containerPort: undefined }))).toBeNull();
  });
});
