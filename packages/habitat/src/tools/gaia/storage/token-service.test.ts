import { describe, it, expect, vi } from "vitest";
import {
	createStorageTokenService,
	deriveStorageScope,
	resolveStorageRelayConfig,
	type StorageRelayConfig,
} from "./token-service.js";

const CFG: StorageRelayConfig = {
	tokenUrl: "https://saas.example/api/gaia/storage/token",
	saasKey: "gaia-key",
};

function jsonResponse(status: number, body?: unknown): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const GOOD_BODY = {
	accessToken: "ya29.token",
	expiresAt: "2026-07-23T13:00:00.000Z",
	folderId: "folder-123",
	scopes: { read: true, write: true },
};

describe("resolveStorageRelayConfig", () => {
	it("returns null unless both env vars are set", () => {
		expect(resolveStorageRelayConfig({})).toBeNull();
		expect(
			resolveStorageRelayConfig({ HABITATS_STORAGE_TOKEN_URL: "x" }),
		).toBeNull();
		expect(
			resolveStorageRelayConfig({
				HABITATS_STORAGE_TOKEN_URL: " https://u ",
				HABITATS_STORAGE_TOKEN_KEY: " k ",
			}),
		).toEqual({ tokenUrl: "https://u", saasKey: "k" });
	});
});

describe("deriveStorageScope", () => {
	it("null when nothing declared", () => {
		expect(deriveStorageScope({ id: "h" })).toBeNull();
	});
	it("read defaults on for declared storage; write is opt-in", () => {
		expect(deriveStorageScope({ storage: { kind: "google-drive" } })).toEqual({
			read: true,
			write: false,
		});
		expect(
			deriveStorageScope({ storage: { kind: "google-drive", write: true } }),
		).toEqual({ read: true, write: true });
	});
	it("null when both read and write are off", () => {
		expect(
			deriveStorageScope({
				storage: { kind: "google-drive", read: false, write: false },
			}),
		).toBeNull();
	});
});

describe("createStorageTokenService", () => {
	const entry = {
		id: "jeeves",
		storage: { kind: "google-drive" as const, write: true },
	};

	it("is disabled and refuses when unconfigured", async () => {
		const service = createStorageTokenService(null);
		expect(service.enabled).toBe(false);
		const result = await service.tokenFor(entry);
		expect(result).toMatchObject({ ok: false, status: "upstream_error" });
	});

	it("refuses declaration-less entries without calling the SaaS", async () => {
		const fetchImpl = vi.fn();
		const service = createStorageTokenService(CFG, { fetchImpl });
		const result = await service.tokenFor({ id: "bare" });
		expect(result).toMatchObject({ ok: false, status: "not_provisioned" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("relays a token and posts the habitat id with bearer auth", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(200, GOOD_BODY));
		const service = createStorageTokenService(CFG, { fetchImpl });
		const result = await service.tokenFor(entry);
		expect(result).toEqual({ ok: true, token: GOOD_BODY });

		expect(fetchImpl).toHaveBeenCalledWith(
			CFG.tokenUrl,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer gaia-key",
				}),
				body: JSON.stringify({ habitatId: "jeeves" }),
			}),
		);
	});

	it("declaration narrows SaaS scopes: read-only entry never gets write", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(200, GOOD_BODY));
		const service = createStorageTokenService(CFG, { fetchImpl });
		const result = await service.tokenFor({
			id: "reader",
			storage: { kind: "google-drive" as const },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.token.scopes).toEqual({ read: true, write: false });
		}
	});

	it("maps 404 to not_provisioned and 409 to needs_reprovision", async () => {
		const service404 = createStorageTokenService(CFG, {
			fetchImpl: vi.fn(async () => jsonResponse(404)),
		});
		expect(await service404.tokenFor(entry)).toMatchObject({
			ok: false,
			status: "not_provisioned",
		});

		const service409 = createStorageTokenService(CFG, {
			fetchImpl: vi.fn(async () => jsonResponse(409)),
		});
		expect(await service409.tokenFor(entry)).toMatchObject({
			ok: false,
			status: "needs_reprovision",
		});
	});

	it("maps network failure, 5xx, and malformed bodies to upstream_error", async () => {
		const down = createStorageTokenService(CFG, {
			fetchImpl: vi.fn(async () => {
				throw new Error("ECONNREFUSED");
			}),
		});
		expect(await down.tokenFor(entry)).toMatchObject({
			ok: false,
			status: "upstream_error",
			message: expect.stringContaining("ECONNREFUSED"),
		});

		const err500 = createStorageTokenService(CFG, {
			fetchImpl: vi.fn(async () => jsonResponse(500, {})),
		});
		expect(await err500.tokenFor(entry)).toMatchObject({
			ok: false,
			status: "upstream_error",
		});

		const missingFields = createStorageTokenService(CFG, {
			fetchImpl: vi.fn(async () => jsonResponse(200, { accessToken: "x" })),
		});
		expect(await missingFields.tokenFor(entry)).toMatchObject({
			ok: false,
			status: "upstream_error",
			message: expect.stringContaining("missing"),
		});
	});
});
