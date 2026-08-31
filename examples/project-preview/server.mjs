import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4173);
const server = createServer((req, res) => {
  if (req.url === "/stream") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.write("first chunk\n");
    setTimeout(() => res.end("second chunk\n"), 750);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>Habitat project preview</title><h1>Project preview is live</h1><p><a href="/stream">Open a streaming response</a></p>`);
});

// Preview discovery deliberately rejects loopback-only services.
server.listen(port, "0.0.0.0", () => {
  console.log(`Example preview listening on 0.0.0.0:${port}`);
});
