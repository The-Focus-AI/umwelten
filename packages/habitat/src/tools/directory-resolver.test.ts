import { describe, expect, it, vi } from "vitest";
import {
	buildDirectoryResolver,
	directoryEntryToPeer,
	findDirectoryEntry,
} from "./directory-resolver.js";

const habitat = (secrets: Record<string, string> = {}) => ({
	getSecret: (name: string) => secrets[name],
});

function stubJson(body: unknown, status = 200) {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		}),
	);
}

describe("directoryEntryToPeer", () => {
	it("prefers a published hostname, which keeps working off-host", () => {
		expect(
			directoryEntryToPeer({
				id: "uh",
				hostname: "uh.example.com",
				containerPort: 7440,
			}),
		).toMatchObject({ endpoint: "https://uh.example.com" });
	});

	it("falls back to the loopback port", () => {
		expect(directoryEntryToPeer({ id: "uh", containerPort: 7440 })).toMatchObject({
			endpoint: "http://127.0.0.1:7440",
		});
	});

	it("carries the peer's own bearer when the directory holds one", () => {
		expect(
			directoryEntryToPeer({ id: "uh", containerPort: 7440, apiKey: "k" }),
		).toMatchObject({ apiKey: "k" });
	});

	it("is unaddressable when a habitat is neither published nor running", () => {
		expect(directoryEntryToPeer({ id: "uh" })).toBeUndefined();
	});
});

describe("findDirectoryEntry", () => {
	const entries = [
		{ id: "upperhand", name: "UpperHand" },
		{ id: "gaia", name: "Gaia" },
	];

	it("matches on id, case-insensitively", () => {
		expect(findDirectoryEntry(entries, "UPPERHAND")?.id).toBe("upperhand");
	});

	it("falls back to the display name", () => {
		expect(findDirectoryEntry(entries, "gaia")?.id).toBe("gaia");
	});

	it("prefers an id match over a name match", () => {
		const shadowed = [{ id: "a", name: "b" }, { id: "b", name: "z" }];
		expect(findDirectoryEntry(shadowed, "b")?.id).toBe("b");
	});

	it("returns nothing for an unknown peer", () => {
		expect(findDirectoryEntry(entries, "nope")).toBeUndefined();
	});
});

describe("buildDirectoryResolver", () => {
	it("returns no resolver when no directory is configured", () => {
		// Standalone and local runs keep the declared-peers-only behaviour.
		expect(buildDirectoryResolver(habitat(), { gaiaUrl: undefined })).toEqual({});
	});

	it("resolves a peer through the directory", async () => {
		const fetchImpl = stubJson([{ id: "uh", containerPort: 7440, apiKey: "k" }]);
		const { resolvePeer } = buildDirectoryResolver(habitat(), {
			gaiaUrl: "http://gaia:7420",
			apiKey: "mine",
			fetchImpl,
		});

		expect(await resolvePeer?.("uh")).toMatchObject({
			id: "uh",
			endpoint: "http://127.0.0.1:7440",
			apiKey: "k",
		});
	});

	it("authenticates with this habitat's own key", async () => {
		const fetchImpl = stubJson([]);
		const { resolvePeer } = buildDirectoryResolver(habitat(), {
			gaiaUrl: "http://gaia:7420",
			apiKey: "mine",
			fetchImpl,
		});
		await resolvePeer?.("uh");

		expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bearer mine");
	});

	it("reads the directory URL and key from habitat secrets", async () => {
		const fetchImpl = stubJson([]);
		const { resolvePeer } = buildDirectoryResolver(
			habitat({ GAIA_URL: "http://from-secret:7420", HABITAT_API_KEY: "sk" }),
			{ fetchImpl },
		);
		await resolvePeer?.("uh");

		expect(String(fetchImpl.mock.calls[0][0])).toContain("from-secret:7420");
		expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bearer sk");
	});

	it("tolerates a wrapped response shape as well as a bare array", async () => {
		const fetchImpl = stubJson({ habitats: [{ id: "uh", containerPort: 7440 }] });
		const { resolvePeer } = buildDirectoryResolver(habitat(), {
			gaiaUrl: "http://gaia:7420",
			fetchImpl,
		});
		// Guessing wrong on the envelope would read as "no such peer".
		expect(await resolvePeer?.("uh")).toMatchObject({ id: "uh" });
	});

	it("returns nothing for a peer the directory does not know", async () => {
		const fetchImpl = stubJson([{ id: "other", containerPort: 7441 }]);
		const { resolvePeer } = buildDirectoryResolver(habitat(), {
			gaiaUrl: "http://gaia:7420",
			fetchImpl,
		});
		expect(await resolvePeer?.("uh")).toBeUndefined();
	});

	it("throws on an error status so the caller can report it distinctly", async () => {
		const fetchImpl = stubJson({ error: "nope" }, 503);
		const { resolvePeer } = buildDirectoryResolver(habitat(), {
			gaiaUrl: "http://gaia:7420",
			fetchImpl,
		});
		await expect(resolvePeer?.("uh")).rejects.toThrow(/503/);
	});

	it("lists the ids the directory knows", async () => {
		const fetchImpl = stubJson([{ id: "a" }, { id: "b" }]);
		const { listPeers } = buildDirectoryResolver(habitat(), {
			gaiaUrl: "http://gaia:7420",
			fetchImpl,
		});
		expect(await listPeers?.()).toEqual(["a", "b"]);
	});
});
