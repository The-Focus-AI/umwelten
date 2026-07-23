/**
 * Backing-storage tools (habitats ADR 0005, decision 6).
 *
 * Drive-API tools over the habitat's provisioned Drive folder. No mounts,
 * no sync state: files a task needs are materialized on demand into a
 * size-capped scratch cache inside the work dir (where read_file/ripgrep/
 * coding runtimes see them), and results go back via resumable upload.
 * Bytes move inside the tools — only metadata enters model context.
 *
 * Inert by default (mirrors search-tools/connectors): registers nothing
 * unless a token source is configured. Two sources:
 *
 * - **Gaia relay** (production): `GAIA_URL` (or `GAIA_STORAGE_TOKEN_URL`)
 *   + the habitat's own `HABITAT_API_KEY` → `POST /storage/token`
 *   (umwelten#262). Tokens are cached until shortly before expiry and
 *   re-pulled on 401.
 * - **Direct** (dev/tests, pre-#262): `GOOGLE_DRIVE_ACCESS_TOKEN` +
 *   `GOOGLE_DRIVE_FOLDER_ID` (+ `GOOGLE_DRIVE_READ_ONLY=1` to drop write).
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import {
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, basename } from "node:path";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
/** Re-pull a relayed token this long before its stated expiry. */
const TOKEN_SLACK_MS = 5 * 60 * 1000;
const DEFAULT_CACHE_MAX_MB = 512;
const CACHE_DIR = "storage-cache";
const CHANGES_CURSOR_FILE = ".changes-cursor";

export interface StorageGrant {
	accessToken: string;
	folderId: string;
	scopes: { read: boolean; write: boolean };
}

export interface StorageTokenSource {
	/** Fresh-enough grant; `forceRefresh` bypasses any cache (after a 401). */
	grant(forceRefresh?: boolean): Promise<StorageGrant>;
	/** Human-readable label for error messages. */
	readonly label: string;
}

export interface StorageToolsContext {
	getWorkDir(): string;
	getSecret(name: string): string | undefined;
	/** Injectable for tests. */
	fetchImpl?: typeof fetch;
	now?: () => number;
}

/** Resolve the configured token source, or null (⇒ toolset registers nothing). */
export function resolveStorageTokenSource(
	ctx: StorageToolsContext,
): StorageTokenSource | null {
	const fetchImpl = ctx.fetchImpl ?? fetch;
	const now = ctx.now ?? Date.now;

	const directToken = ctx.getSecret("GOOGLE_DRIVE_ACCESS_TOKEN");
	const directFolder = ctx.getSecret("GOOGLE_DRIVE_FOLDER_ID");
	if (directToken && directFolder) {
		const write = ctx.getSecret("GOOGLE_DRIVE_READ_ONLY") !== "1";
		return {
			label: "direct token (GOOGLE_DRIVE_ACCESS_TOKEN)",
			grant: async () => ({
				accessToken: directToken,
				folderId: directFolder,
				scopes: { read: true, write },
			}),
		};
	}

	const explicitUrl = ctx.getSecret("GAIA_STORAGE_TOKEN_URL");
	const gaiaUrl = ctx.getSecret("GAIA_URL");
	const apiKey = ctx.getSecret("HABITAT_API_KEY");
	const tokenUrl =
		explicitUrl ??
		(gaiaUrl ? `${gaiaUrl.replace(/\/+$/, "")}/storage/token` : undefined);
	if (!tokenUrl || !apiKey) return null;

	let cached: { grant: StorageGrant; expiresAtMs: number } | null = null;
	return {
		label: `Gaia relay (${tokenUrl})`,
		grant: async (forceRefresh = false) => {
			if (
				!forceRefresh &&
				cached &&
				now() < cached.expiresAtMs - TOKEN_SLACK_MS
			) {
				return cached.grant;
			}
			const res = await fetchImpl(tokenUrl, {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}` },
			});
			if (!res.ok) {
				let detail = `${res.status}`;
				try {
					const body = (await res.json()) as { error?: string };
					if (body.error) detail = `${res.status}: ${body.error}`;
				} catch {
					// status alone
				}
				throw new Error(`Storage token pull failed (${detail})`);
			}
			const body = (await res.json()) as {
				accessToken: string;
				expiresAt: string;
				folderId: string;
				scopes: { read: boolean; write: boolean };
			};
			cached = {
				grant: {
					accessToken: body.accessToken,
					folderId: body.folderId,
					scopes: body.scopes,
				},
				expiresAtMs: Date.parse(body.expiresAt) || now() + TOKEN_SLACK_MS * 2,
			};
			return cached.grant;
		},
	};
}

// ── Scratch cache ────────────────────────────────────────────────

async function cacheDirFor(ctx: StorageToolsContext): Promise<string> {
	const dir = join(ctx.getWorkDir(), CACHE_DIR);
	await mkdir(dir, { recursive: true });
	return dir;
}

function cacheMaxBytes(ctx: StorageToolsContext): number {
	const raw = ctx.getSecret("STORAGE_CACHE_MAX_MB");
	const mb = raw ? Number(raw) : DEFAULT_CACHE_MAX_MB;
	return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_CACHE_MAX_MB) * 1024 * 1024;
}

/**
 * Enforce the cache cap: delete oldest-modified files until under the cap.
 * The cursor file is exempt — losing it would replay the whole change log.
 */
export async function evictCache(
	dir: string,
	maxBytes: number,
): Promise<string[]> {
	const entries = await readdir(dir).catch(() => [] as string[]);
	const files: { path: string; size: number; mtimeMs: number }[] = [];
	for (const name of entries) {
		if (name === CHANGES_CURSOR_FILE) continue;
		const path = join(dir, name);
		const s = await stat(path).catch(() => null);
		if (s?.isFile()) files.push({ path, size: s.size, mtimeMs: s.mtimeMs });
	}
	let total = files.reduce((sum, f) => sum + f.size, 0);
	const evicted: string[] = [];
	files.sort((a, b) => a.mtimeMs - b.mtimeMs);
	for (const f of files) {
		if (total <= maxBytes) break;
		await rm(f.path, { force: true });
		total -= f.size;
		evicted.push(f.path);
	}
	return evicted;
}

// ── Drive API plumbing ───────────────────────────────────────────

/** Fetch with auth; on 401 re-pull the token once and retry. */
async function driveFetch(
	source: StorageTokenSource,
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit = {},
): Promise<{ res: Response; grant: StorageGrant }> {
	let grant = await source.grant();
	const withAuth = (g: StorageGrant): RequestInit => ({
		...init,
		headers: {
			...(init.headers as Record<string, string> | undefined),
			Authorization: `Bearer ${g.accessToken}`,
		},
	});
	let res = await fetchImpl(url, withAuth(grant));
	if (res.status === 401) {
		grant = await source.grant(true);
		res = await fetchImpl(url, withAuth(grant));
	}
	return { res, grant };
}

async function driveError(res: Response, what: string): Promise<string> {
	let detail = `HTTP ${res.status}`;
	try {
		const body = (await res.json()) as { error?: { message?: string } };
		if (body.error?.message) detail = `${detail}: ${body.error.message}`;
	} catch {
		// status alone
	}
	if (res.status === 401 || res.status === 403) {
		return `${what} failed (${detail}). The storage grant may be broken — a member may need to re-provision backing storage.`;
	}
	return `${what} failed (${detail})`;
}

interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	size?: string;
	modifiedTime?: string;
	parents?: string[];
}

const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,parents";

function fileSummary(f: DriveFile) {
	return {
		id: f.id,
		name: f.name,
		mimeType: f.mimeType,
		...(f.size ? { sizeBytes: Number(f.size) } : {}),
		...(f.modifiedTime ? { modifiedTime: f.modifiedTime } : {}),
	};
}

const EXPORT_MIME: Record<string, { mime: string; ext: string }> = {
	md: { mime: "text/markdown", ext: "md" },
	csv: { mime: "text/csv", ext: "csv" },
	pdf: { mime: "application/pdf", ext: "pdf" },
	txt: { mime: "text/plain", ext: "txt" },
};

function sanitizeName(name: string): string {
	return basename(name).replace(/[^\w.\- ]+/g, "_");
}

// ── Tools ────────────────────────────────────────────────────────

export function createStorageTools(
	ctx: StorageToolsContext,
): Record<string, Tool> {
	const source = resolveStorageTokenSource(ctx);
	if (!source) return {};
	const fetchImpl = ctx.fetchImpl ?? fetch;

	const drive_list = tool({
		description:
			"List files in the habitat's backing-storage Drive folder (or a subfolder of it by id). Returns file ids, names, types, sizes.",
		inputSchema: z.object({
			folderId: z
				.string()
				.optional()
				.describe("Subfolder id to list; omit for the root of the attached folder"),
			pageToken: z.string().optional().describe("Continue a previous listing"),
		}),
		execute: async ({ folderId, pageToken }) => {
			const grant = await source.grant();
			const parent = folderId ?? grant.folderId;
			const params = new URLSearchParams({
				q: `'${parent.replace(/'/g, "\\'")}' in parents and trashed=false`,
				fields: `nextPageToken,files(${FILE_FIELDS})`,
				pageSize: "100",
			});
			if (pageToken) params.set("pageToken", pageToken);
			const { res } = await driveFetch(
				source,
				fetchImpl,
				`${DRIVE_API}/files?${params}`,
			);
			if (!res.ok) return { error: await driveError(res, "drive_list") };
			const body = (await res.json()) as {
				files?: DriveFile[];
				nextPageToken?: string;
			};
			return {
				folderId: parent,
				files: (body.files ?? []).map(fileSummary),
				...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}),
			};
		},
	});

	const drive_search = tool({
		description:
			"Full-text search the backing-storage folder server-side (Drive indexes file contents). Use this to find files without downloading anything.",
		inputSchema: z.object({
			query: z.string().min(1).describe("Full-text search query"),
		}),
		execute: async ({ query }) => {
			const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
			const params = new URLSearchParams({
				q: `fullText contains '${escaped}' and trashed=false`,
				fields: `files(${FILE_FIELDS})`,
				pageSize: "25",
			});
			const { res } = await driveFetch(
				source,
				fetchImpl,
				`${DRIVE_API}/files?${params}`,
			);
			if (!res.ok) return { error: await driveError(res, "drive_search") };
			const body = (await res.json()) as { files?: DriveFile[] };
			return { query, files: (body.files ?? []).map(fileSummary) };
		},
	});

	const drive_fetch = tool({
		description:
			"Download a file from backing storage into the local scratch cache and return its local path. Use read_file/ripgrep on the returned path afterwards. Google-native Docs/Sheets need drive_export instead.",
		inputSchema: z.object({
			fileId: z.string().describe("Drive file id (from drive_list/drive_search)"),
		}),
		execute: async ({ fileId }) => {
			const metaRes = await driveFetch(
				source,
				fetchImpl,
				`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`,
			);
			if (!metaRes.res.ok) {
				return { error: await driveError(metaRes.res, "drive_fetch") };
			}
			const meta = (await metaRes.res.json()) as DriveFile;
			if (meta.mimeType.startsWith("application/vnd.google-apps.")) {
				return {
					error: `"${meta.name}" is a Google-native ${meta.mimeType} — use drive_export with a format instead.`,
				};
			}
			const { res } = await driveFetch(
				source,
				fetchImpl,
				`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
			);
			if (!res.ok) return { error: await driveError(res, "drive_fetch") };

			const dir = await cacheDirFor(ctx);
			const localPath = join(dir, `${fileId}-${sanitizeName(meta.name)}`);
			if (res.body) {
				await pipeline(
					Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
					createWriteStream(localPath),
				);
			} else {
				await writeFile(localPath, Buffer.from(await res.arrayBuffer()));
			}
			const evicted = await evictCache(dir, cacheMaxBytes(ctx));
			const s = await stat(localPath).catch(() => null);
			return {
				localPath,
				name: meta.name,
				sizeBytes: s?.size ?? null,
				...(evicted.length ? { evictedFromCache: evicted.length } : {}),
			};
		},
	});

	const drive_put = tool({
		description:
			"Upload a local file from the workspace into the backing-storage folder (creates a new file, or updates one when fileId is given). Uses resumable upload; refused when storage is read-only.",
		inputSchema: z.object({
			localPath: z.string().describe("Path of the local file to upload"),
			name: z
				.string()
				.optional()
				.describe("Name in Drive (default: local basename)"),
			fileId: z
				.string()
				.optional()
				.describe("Existing Drive file id to update in place"),
			mimeType: z.string().optional().describe("MIME type (default: octet-stream)"),
		}),
		execute: async ({ localPath, name, fileId, mimeType }) => {
			const grant = await source.grant();
			if (!grant.scopes.write) {
				return {
					error:
						"Backing storage is read-only for this habitat — drive_put is not allowed.",
				};
			}
			let content: Buffer;
			try {
				content = await readFile(localPath);
			} catch (err) {
				return {
					error: `Cannot read local file "${localPath}": ${err instanceof Error ? err.message : err}`,
				};
			}
			const targetName = name ?? basename(localPath);
			const contentType = mimeType ?? "application/octet-stream";

			// Resumable protocol: open a session, then PUT the bytes (a single
			// PUT is valid — Drive treats it as one-chunk resumable).
			const sessionUrl = fileId
				? `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=resumable`
				: `${DRIVE_UPLOAD}/files?uploadType=resumable`;
			const open = await driveFetch(source, fetchImpl, sessionUrl, {
				method: fileId ? "PATCH" : "POST",
				headers: {
					"Content-Type": "application/json; charset=UTF-8",
					"X-Upload-Content-Type": contentType,
				},
				body: JSON.stringify(
					fileId
						? { name: targetName }
						: { name: targetName, parents: [grant.folderId] },
				),
			});
			if (!open.res.ok) {
				return { error: await driveError(open.res, "drive_put (open session)") };
			}
			const uploadUrl = open.res.headers.get("location");
			if (!uploadUrl) {
				return { error: "drive_put failed: no resumable session URL returned" };
			}
			const put = await fetchImpl(uploadUrl, {
				method: "PUT",
				headers: { "Content-Type": contentType },
				body: content,
			});
			if (!put.ok) return { error: await driveError(put, "drive_put (upload)") };
			const body = (await put.json()) as DriveFile;
			return { uploaded: true, file: fileSummary({ ...body, mimeType: body.mimeType ?? contentType }) };
		},
	});

	const drive_export = tool({
		description:
			"Export a Google-native Doc/Sheet from backing storage into the scratch cache as md, csv, txt, or pdf and return the local path.",
		inputSchema: z.object({
			fileId: z.string().describe("Drive file id of the Google Doc/Sheet"),
			format: z.enum(["md", "csv", "txt", "pdf"]).describe("Export format"),
		}),
		execute: async ({ fileId, format }) => {
			const target = EXPORT_MIME[format];
			const params = new URLSearchParams({ mimeType: target.mime });
			const { res } = await driveFetch(
				source,
				fetchImpl,
				`${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?${params}`,
			);
			if (!res.ok) return { error: await driveError(res, "drive_export") };
			const dir = await cacheDirFor(ctx);
			const localPath = join(dir, `${fileId}-export.${target.ext}`);
			await writeFile(localPath, Buffer.from(await res.arrayBuffer()));
			const evicted = await evictCache(dir, cacheMaxBytes(ctx));
			return {
				localPath,
				format,
				...(evicted.length ? { evictedFromCache: evicted.length } : {}),
			};
		},
	});

	const drive_changes = tool({
		description:
			"What changed in backing storage since the last call (new/modified/removed files). First call establishes the cursor and reports nothing.",
		inputSchema: z.object({}),
		execute: async () => {
			const dir = await cacheDirFor(ctx);
			const cursorPath = join(dir, CHANGES_CURSOR_FILE);
			const cursor = await readFile(cursorPath, "utf-8").catch(() => null);

			if (!cursor) {
				const { res } = await driveFetch(
					source,
					fetchImpl,
					`${DRIVE_API}/changes/startPageToken`,
				);
				if (!res.ok) return { error: await driveError(res, "drive_changes") };
				const body = (await res.json()) as { startPageToken: string };
				await writeFile(cursorPath, body.startPageToken, "utf-8");
				return {
					initialized: true,
					changes: [],
					note: "Change cursor established — future calls report changes from now on.",
				};
			}

			const changes: unknown[] = [];
			let pageToken: string | undefined = cursor.trim();
			let newCursor = pageToken;
			while (pageToken) {
				const params = new URLSearchParams({
					pageToken,
					fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
				});
				const { res } = await driveFetch(
					source,
					fetchImpl,
					`${DRIVE_API}/changes?${params}`,
				);
				if (!res.ok) return { error: await driveError(res, "drive_changes") };
				const body = (await res.json()) as {
					changes?: { fileId: string; removed?: boolean; file?: DriveFile }[];
					nextPageToken?: string;
					newStartPageToken?: string;
				};
				for (const c of body.changes ?? []) {
					changes.push({
						fileId: c.fileId,
						removed: c.removed === true,
						...(c.file ? { file: fileSummary(c.file) } : {}),
					});
				}
				if (body.newStartPageToken) newCursor = body.newStartPageToken;
				pageToken = body.nextPageToken;
			}
			await writeFile(cursorPath, newCursor, "utf-8");
			return { changes };
		},
	});

	return {
		drive_list,
		drive_search,
		drive_fetch,
		drive_put,
		drive_export,
		drive_changes,
	};
}
