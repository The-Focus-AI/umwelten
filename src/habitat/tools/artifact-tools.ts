/**
 * Artifact tools — publish files as named, timestamped artifacts
 * with metadata and session association.
 *
 * Artifacts live at {workDir}/artifacts/{timestamp}-{slug}.{ext}
 * with a sibling .meta.json for each one.
 *
 * They're served via /files/artifacts/* in the container server.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import { join, extname, basename } from "node:path";
import { copyFile, mkdir, writeFile, readdir, readFile } from "node:fs/promises";

// ── Types ────────────────────────────────────────────────────────────

export interface ArtifactMeta {
  /** Original source path inside the container. */
  sourcePath: string;
  /** Published artifact path (inside /data/artifacts/). */
  artifactPath: string;
  /** Human-readable name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** MIME type. */
  mimeType: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Session ID that produced this artifact. */
  sessionId?: string;
  /** Public URL path (/files/artifacts/...). */
  url: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".ts": "text/plain",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".xml": "text/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/plain",
  ".py": "text/plain",
  ".sh": "text/plain",
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function guessMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function formatTimestamp(): string {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ── Tool context ─────────────────────────────────────────────────────

export interface ArtifactToolsContext {
  getWorkDir(): string;
  getSessionId?(): string | undefined;
}

// ── List artifacts helper (used by API endpoint too) ─────────────────

export async function listArtifacts(
  workDir: string,
): Promise<ArtifactMeta[]> {
  const dir = join(workDir, "artifacts");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const metas: ArtifactMeta[] = [];
  for (const f of files) {
    if (!f.endsWith(".meta.json")) continue;
    try {
      const raw = await readFile(join(dir, f), "utf-8");
      metas.push(JSON.parse(raw));
    } catch {
      // skip malformed
    }
  }

  // Sort newest first
  metas.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return metas;
}

// ── Tool factory ─────────────────────────────────────────────────────

export function createArtifactTools(
  ctx: ArtifactToolsContext,
): Record<string, Tool> {
  const publishArtifact = tool({
    description:
      "Publish a file as a named artifact. Copies the file to /data/artifacts/ with metadata " +
      "(timestamp, description, session). Returns the public /files/ URL. " +
      "Use this whenever you produce an output the user should be able to see or download.",
    parameters: z.object({
      path: z
        .string()
        .describe(
          "Absolute path to the file inside the container (e.g. /data/project/output/latest.png)",
        ),
      name: z
        .string()
        .optional()
        .describe("Human-readable name for the artifact (e.g. 'TRMNL Dashboard Image'). Defaults to the filename."),
      description: z
        .string()
        .optional()
        .describe("Optional description of what the artifact is"),
    }),
    execute: async ({ path: sourcePath, name: rawName, description }) => {
      const name = rawName || basename(sourcePath, extname(sourcePath));
      const workDir = ctx.getWorkDir();
      const artifactsDir = join(workDir, "artifacts");
      await mkdir(artifactsDir, { recursive: true });

      const ext = extname(sourcePath);
      const ts = formatTimestamp();
      const slug = slugify(name);
      const artifactFilename = `${ts}-${slug}${ext}`;
      const artifactPath = join(artifactsDir, artifactFilename);

      // Copy the file
      await copyFile(sourcePath, artifactPath);

      const mimeType = guessMime(sourcePath);
      const sessionId = ctx.getSessionId?.();
      const url = `/files/artifacts/${artifactFilename}`;

      const meta: ArtifactMeta = {
        sourcePath,
        artifactPath,
        name,
        description,
        mimeType,
        timestamp: new Date().toISOString(),
        sessionId,
        url,
      };

      // Write metadata
      const metaPath = join(
        artifactsDir,
        `${ts}-${slug}.meta.json`,
      );
      await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

      return {
        published: true,
        name,
        url,
        mimeType,
        artifactPath,
        sessionId,
      };
    },
  });

  const listArtifactsTool = tool({
    description:
      "List all published artifacts with their metadata (name, URL, timestamp, session).",
    parameters: z.object({}),
    execute: async () => {
      const metas = await listArtifacts(ctx.getWorkDir());
      return {
        count: metas.length,
        artifacts: metas.map((m) => ({
          name: m.name,
          url: m.url,
          mimeType: m.mimeType,
          timestamp: m.timestamp,
          sessionId: m.sessionId,
          description: m.description,
        })),
      };
    },
  });

  return {
    publish_artifact: publishArtifact,
    list_artifacts: listArtifactsTool,
  };
}
