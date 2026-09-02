import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

const PUBLIC_FILES = new Set(["llms.txt", "llms-full.txt", "openapi.json"]);

function defaultDirectory() {
  const besideBundle = join(dirname(fileURLToPath(import.meta.url)), "landing");
  return existsSync(join(besideBundle, "index.html"))
    ? besideBundle
    : resolve("apps/mycel-client/dist");
}

/** Serve only the separately built Mycel browser application. */
export function createLandingHandler(
  directory = defaultDirectory(),
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const path = decodeURIComponent((req.url ?? "/").split("?", 1)[0]);
    const file = path === "/" ? "index.html" : path.slice(1);
    if (
      file !== "index.html" &&
      !PUBLIC_FILES.has(file) &&
      !/^assets\/[\w.-]+$/.test(file)
    )
      return false;
    const type = TYPES.get(extname(file));
    if (!type) return false;
    try {
      const body = await readFile(join(directory, file));
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control":
          file === "index.html" ||
          PUBLIC_FILES.has(file) ||
          file === "assets/account-authentication.js"
            ? "no-cache"
            : "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
    return true;
  };
}
