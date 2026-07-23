import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, utimes, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createStorageTools,
	evictCache,
	resolveStorageTokenSource,
	type StorageToolsContext,
} from "./storage-tools.js";

const CALL_OPTS = { messages: [], toolCallId: "test" } as any;

function jsonResponse(status: number, body?: unknown, headers?: Record<string, string>): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function ctxWith(
	secrets: Record<string, string>,
	workDir: string,
	fetchImpl?: typeof fetch,
): StorageToolsContext {
	return {
		getWorkDir: () => workDir,
		getSecret: (name) => secrets[name],
		fetchImpl,
	};
}

let tempDir: string;
beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "storage-tools-"));
});
afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("resolveStorageTokenSource", () => {
	it("is null when nothing is configured (toolset registers nothing)", () => {
		expect(resolveStorageTokenSource(ctxWith({}, tempDir))).toBeNull();
		expect(createStorageTools(ctxWith({}, tempDir))).toEqual({});
	});

	it("direct source: read-only flag drops write", async () => {
		const source = resolveStorageTokenSource(
			ctxWith(
				{
					GOOGLE_DRIVE_ACCESS_TOKEN: "tok",
					GOOGLE_DRIVE_FOLDER_ID: "folder",
					GOOGLE_DRIVE_READ_ONLY: "1",
				},
				tempDir,
			),
		);
		expect(source).not.toBeNull();
		const grant = await source!.grant();
		expect(grant).toEqual({
			accessToken: "tok",
			folderId: "folder",
			scopes: { read: true, write: false },
		});
	});

	it("gaia source: pulls with the habitat key, caches, and force-refreshes", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse(200, {
				accessToken: "relayed",
				expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				folderId: "f1",
				scopes: { read: true, write: true },
			}),
		) as unknown as typeof fetch;
		const source = resolveStorageTokenSource(
			ctxWith(
				{ GAIA_URL: "http://gaia:7420/", HABITAT_API_KEY: "child-key" },
				tempDir,
				fetchImpl,
			),
		);
		expect(source).not.toBeNull();

		const g1 = await source!.grant();
		expect(g1.accessToken).toBe("relayed");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledWith(
			"http://gaia:7420/storage/token",
			expect.objectContaining({
				method: "POST",
				headers: { Authorization: "Bearer child-key" },
			}),
		);

		await source!.grant(); // cached — no second pull
		expect(fetchImpl).toHaveBeenCalledTimes(1);

		await source!.grant(true); // forced — re-pull
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});

describe("drive tools", () => {
	const DIRECT = {
		GOOGLE_DRIVE_ACCESS_TOKEN: "tok",
		GOOGLE_DRIVE_FOLDER_ID: "root-folder",
	};

	it("drive_list queries the attached folder and parses files", async () => {
		const fetchImpl = vi.fn(async (url: any) => {
			expect(String(url)).toContain("root-folder");
			return jsonResponse(200, {
				files: [
					{ id: "a", name: "notes.txt", mimeType: "text/plain", size: "12" },
				],
			});
		}) as unknown as typeof fetch;
		const tools = createStorageTools(ctxWith(DIRECT, tempDir, fetchImpl));
		const result: any = await (tools.drive_list as any).execute({}, CALL_OPTS);
		expect(result.files).toEqual([
			{ id: "a", name: "notes.txt", mimeType: "text/plain", sizeBytes: 12 },
		]);
	});

	it("retries once with a refreshed token on 401", async () => {
		let calls = 0;
		const fetchImpl = vi.fn(async (url: any, init: any) => {
			if (String(url).includes("/storage/token")) {
				return jsonResponse(200, {
					accessToken: `tok-${++calls}`,
					expiresAt: new Date(Date.now() + 3600_000).toISOString(),
					folderId: "f",
					scopes: { read: true, write: true },
				});
			}
			const auth = init?.headers?.Authorization;
			if (auth === "Bearer tok-1") return jsonResponse(401, {});
			return jsonResponse(200, { files: [] });
		}) as unknown as typeof fetch;

		const tools = createStorageTools(
			ctxWith(
				{ GAIA_URL: "http://gaia", HABITAT_API_KEY: "k" },
				tempDir,
				fetchImpl,
			),
		);
		const result: any = await (tools.drive_list as any).execute({}, CALL_OPTS);
		expect(result.error).toBeUndefined();
		expect(calls).toBe(2); // initial pull + forced refresh after 401
	});

	it("drive_put hard-refuses on read-only storage without touching the network", async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const tools = createStorageTools(
			ctxWith({ ...DIRECT, GOOGLE_DRIVE_READ_ONLY: "1" }, tempDir, fetchImpl),
		);
		const local = join(tempDir, "out.txt");
		await writeFile(local, "hello");
		const result: any = await (tools.drive_put as any).execute(
			{ localPath: local },
			CALL_OPTS,
		);
		expect(result.error).toContain("read-only");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("drive_put opens a resumable session parented to the folder, then uploads", async () => {
		const seen: string[] = [];
		const fetchImpl = vi.fn(async (url: any, init: any) => {
			seen.push(`${init?.method ?? "GET"} ${url}`);
			if (String(url).includes("uploadType=resumable")) {
				expect(JSON.parse(init.body).parents).toEqual(["root-folder"]);
				return jsonResponse(200, undefined, {
					location: "https://upload.example/session-1",
				});
			}
			if (String(url) === "https://upload.example/session-1") {
				return jsonResponse(200, {
					id: "new-id",
					name: "out.txt",
					mimeType: "text/plain",
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		}) as unknown as typeof fetch;

		const tools = createStorageTools(ctxWith(DIRECT, tempDir, fetchImpl));
		const local = join(tempDir, "out.txt");
		await writeFile(local, "hello");
		const result: any = await (tools.drive_put as any).execute(
			{ localPath: local },
			CALL_OPTS,
		);
		expect(result.uploaded).toBe(true);
		expect(result.file.id).toBe("new-id");
		expect(seen.some((s) => s.startsWith("PUT https://upload.example"))).toBe(true);
	});

	it("drive_fetch materializes into the scratch cache and evicts over the cap", async () => {
		const fetchImpl = vi.fn(async (url: any) => {
			if (String(url).includes("alt=media")) {
				return new Response("x".repeat(400), { status: 200 });
			}
			return jsonResponse(200, {
				id: "f1",
				name: "big.bin",
				mimeType: "application/octet-stream",
			});
		}) as unknown as typeof fetch;

		// Cap ≈ 0.0005 MB ≈ 524 bytes: the old file must be evicted.
		const ctx = ctxWith(
			{ ...DIRECT, STORAGE_CACHE_MAX_MB: "0.0005" },
			tempDir,
			fetchImpl,
		);
		const cacheDir = join(tempDir, "storage-cache");
		await mkdir(cacheDir, { recursive: true });
		const old = join(cacheDir, "old-file");
		await writeFile(old, "y".repeat(400));
		await utimes(old, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

		const tools = createStorageTools(ctx);
		const result: any = await (tools.drive_fetch as any).execute(
			{ fileId: "f1" },
			CALL_OPTS,
		);
		expect(result.localPath).toContain("f1-big.bin");
		const remaining = await readdir(cacheDir);
		expect(remaining).not.toContain("old-file");
		expect(remaining).toContain("f1-big.bin");
	});

	it("drive_changes initializes a cursor, then reports and advances", async () => {
		let stage = 0;
		const fetchImpl = vi.fn(async (url: any) => {
			if (String(url).includes("changes/startPageToken")) {
				return jsonResponse(200, { startPageToken: "cursor-1" });
			}
			stage++;
			return jsonResponse(200, {
				changes: [
					{
						fileId: "f9",
						file: { id: "f9", name: "new.txt", mimeType: "text/plain" },
					},
				],
				newStartPageToken: "cursor-2",
			});
		}) as unknown as typeof fetch;

		const tools = createStorageTools(ctxWith(DIRECT, tempDir, fetchImpl));
		const first: any = await (tools.drive_changes as any).execute({}, CALL_OPTS);
		expect(first.initialized).toBe(true);

		const second: any = await (tools.drive_changes as any).execute({}, CALL_OPTS);
		expect(second.changes).toHaveLength(1);
		expect(second.changes[0].fileId).toBe("f9");
		expect(stage).toBe(1);
	});
});

describe("evictCache", () => {
	it("removes oldest files first and never touches the cursor file", async () => {
		const dir = join(tempDir, "cache");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, ".changes-cursor"), "cursor");
		await writeFile(join(dir, "old"), "a".repeat(100));
		await writeFile(join(dir, "new"), "b".repeat(100));
		await utimes(join(dir, "old"), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

		const evicted = await evictCache(dir, 150);
		expect(evicted).toHaveLength(1);
		const remaining = await readdir(dir);
		expect(remaining).toContain(".changes-cursor");
		expect(remaining).toContain("new");
		expect(remaining).not.toContain("old");
	});
});
