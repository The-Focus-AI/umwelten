import { describe, expect, it, vi } from "vitest";
import {
	announceHabitat,
	buildAnnouncement,
	resolveSaasRegistryConfig,
} from "./saas-registry.js";
import type { GaiaHabitatEntry } from "./types.js";

function entry(over: Partial<GaiaHabitatEntry> = {}): GaiaHabitatEntry {
	return {
		id: "operations",
		name: "Operations",
		apiKey: "gaia_secret_key",
		config: {},
		secretBindings: [],
		createdAt: "2026-08-05T00:00:00Z",
		...over,
	} as GaiaHabitatEntry;
}

const CONFIG = {
	url: "https://habitats.thefocus.ai/api/admin/umwelten/register",
	secret: "shh",
	workspace: "the-focus-ai",
};

describe("resolveSaasRegistryConfig", () => {
	it("is null when nothing is configured, so announcing is opt-in", () => {
		expect(resolveSaasRegistryConfig({})).toBeNull();
	});

	/**
	 * Either half alone is a half-configured integration that could only ever
	 * produce failing calls — better to stay inert than to retry forever.
	 */
	it("is null when only the URL or only the secret is set", () => {
		expect(resolveSaasRegistryConfig({ HABITATS_SAAS_REGISTRY_URL: "u" })).toBeNull();
		expect(
			resolveSaasRegistryConfig({ HABITATS_SAAS_REGISTRY_SECRET: "s" }),
		).toBeNull();
	});

	it("reads url, secret and optional workspace", () => {
		expect(
			resolveSaasRegistryConfig({
				HABITATS_SAAS_REGISTRY_URL: " https://x/register ",
				HABITATS_SAAS_REGISTRY_SECRET: " s ",
				HABITATS_SAAS_REGISTRY_WORKSPACE: " ws ",
			}),
		).toEqual({ url: "https://x/register", secret: "s", workspace: "ws" });
	});

	it("omits the workspace when unset, leaving the receiver to default it", () => {
		const c = resolveSaasRegistryConfig({
			HABITATS_SAAS_REGISTRY_URL: "u",
			HABITATS_SAAS_REGISTRY_SECRET: "s",
		});
		expect(c).not.toBeNull();
		expect(c && "workspace" in c).toBe(false);
	});
});

describe("buildAnnouncement", () => {
	it("announces the public https address", () => {
		const p = buildAnnouncement(
			entry({ hostname: "operations.habitats.thefocus.ai" }),
			CONFIG,
		);
		expect(p?.endpoint).toBe("https://operations.habitats.thefocus.ai");
		expect(p?.habitatId).toBe("operations");
		expect(p?.workspaceSlug).toBe("the-focus-ai");
	});

	/**
	 * The token travels as a field, not in the URL: the receiver logs endpoints,
	 * and a credential in a logged URL is a credential in the logs.
	 */
	it("keeps the token out of the endpoint", () => {
		const p = buildAnnouncement(
			entry({ hostname: "operations.habitats.thefocus.ai" }),
			CONFIG,
		);
		expect(p?.endpoint).not.toContain("token");
		expect(p?.token).toBe("gaia_secret_key");
	});

	/**
	 * A habitat reachable only on host loopback could never be dispatched to
	 * from Vercel; recording it would put a row in the product that looks
	 * attached and can never answer.
	 */
	it("returns null for a habitat with no public hostname", () => {
		expect(buildAnnouncement(entry({ containerPort: 7450 }), CONFIG)).toBeNull();
	});
});

describe("announceHabitat", () => {
	it("posts the payload with the shared secret as a bearer", async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ created: true, agentKey: "gaia-operations" }),
		});
		const out = await announceHabitat(
			entry({ hostname: "operations.habitats.thefocus.ai" }),
			CONFIG,
			{ fetch: fetch as unknown as typeof globalThis.fetch },
		);

		expect(out).toMatchObject({ ok: true, created: true, agentKey: "gaia-operations" });
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe(CONFIG.url);
		expect(init.headers.authorization).toBe("Bearer shh");
		expect(JSON.parse(init.body)).toMatchObject({
			habitatId: "operations",
			workspaceSlug: "the-focus-ai",
		});
	});

	it("reports a non-2xx as a reason rather than throwing", async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			text: async () => "forbidden",
		});
		const out = await announceHabitat(
			entry({ hostname: "h.example.com" }),
			CONFIG,
			{ fetch: fetch as unknown as typeof globalThis.fetch },
		);
		expect(out).toEqual({ ok: false, reason: "HTTP 403 forbidden" });
	});

	/** The caller is a start path; a network fault must never surface as a throw. */
	it("reports a network failure rather than throwing", async () => {
		const fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const out = await announceHabitat(
			entry({ hostname: "h.example.com" }),
			CONFIG,
			{ fetch: fetch as unknown as typeof globalThis.fetch },
		);
		expect(out).toEqual({ ok: false, reason: "ECONNREFUSED" });
	});

	it("skips, without calling out, when there is no public hostname", async () => {
		const fetch = vi.fn();
		const out = await announceHabitat(entry(), CONFIG, {
			fetch: fetch as unknown as typeof globalThis.fetch,
		});
		expect(out).toMatchObject({ ok: "skipped" });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("bounds the request so a hanging SaaS cannot stall a start", async () => {
		const fetch = vi.fn(
			(_u: unknown, init: { signal: AbortSignal }) =>
				new Promise((_res, rej) =>
					init.signal.addEventListener("abort", () => rej(new Error("aborted"))),
				),
		);
		const out = await announceHabitat(
			entry({ hostname: "h.example.com" }),
			CONFIG,
			{ fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 10 },
		);
		expect(out).toMatchObject({ ok: false });
	});
});
