// Static server for the dialogue-web example, plus one extra trick:
// POST /transcript saves the request body to transcripts/dialogue-<ts>.md.
// index.html POSTs the finished transcript there when opened with
// ?post=/transcript — which is how the webreel demo recording captures the
// debate text (headless Chrome silently drops file downloads).
//
//   node serve.mjs          # http://localhost:7439
//   PORT=8000 node serve.mjs
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 7439);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/transcript") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const dir = join(root, "transcripts");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `dialogue-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    await writeFile(file, Buffer.concat(chunks));
    console.log(`transcript saved: ${file}`);
    res.writeHead(204).end();
    return;
  }
  // newest exported transcript, as plain text (used by transcript.html)
  if (req.method === "GET" && req.url === "/transcript/latest") {
    try {
      const files = (await readdir(join(root, "transcripts"))).filter((f) => f.endsWith(".md")).sort();
      const name = files.at(-1);
      if (!name) throw new Error("none");
      const body = await readFile(join(root, "transcripts", name));
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "X-Transcript-Name": name }).end(body);
    } catch {
      res.writeHead(404).end("no transcripts yet");
    }
    return;
  }
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, path === "/" || path === "\\" ? "index.html" : path);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`dialogue-web on http://localhost:${port}`));
