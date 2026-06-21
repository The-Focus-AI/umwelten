/**
 * Reverse proxy — forwards requests from Gaia to habitat containers.
 * Injects the per-container HABITAT_API_KEY as Authorization header.
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GaiaHabitatEntry } from "./types.js";
import { containerName, CHILD_INTERNAL_PORT } from "./docker.js";

/**
 * Proxy a request to a running habitat container.
 * Handles both regular responses and SSE streaming.
 */
export async function proxyRequest(
  entry: GaiaHabitatEntry,
  targetPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!entry.containerPort) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Container not running or port unknown" }));
    return;
  }

  return new Promise<void>((resolve) => {
    // Read the incoming body
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);

      const childHost = containerName(entry.id);
      const proxyReq = http.request(
        {
          hostname: childHost,
          port: CHILD_INTERNAL_PORT,
          path: targetPath,
          method: req.method,
          headers: {
            ...req.headers,
            host: `${childHost}:${CHILD_INTERNAL_PORT}`,
            authorization: `Bearer ${entry.apiKey}`,
          },
        },
        (proxyRes) => {
          // Pass through status + headers
          res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
          proxyRes.pipe(res);
          proxyRes.on("end", resolve);
        },
      );

      proxyReq.on("error", (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
        }
        resolve();
      });

      if (body.length > 0) {
        proxyReq.write(body);
      }
      proxyReq.end();
    });
  });
}

/**
 * Fetch JSON from a container endpoint.
 */
export async function fetchFromContainer<T = unknown>(
  entry: GaiaHabitatEntry,
  path: string,
): Promise<T> {
  if (!entry.containerPort) {
    throw new Error(`Container ${entry.id} not running`);
  }

  return new Promise<T>((resolve, reject) => {
    const req = http.request(
      {
        hostname: containerName(entry.id),
        port: CHILD_INTERNAL_PORT,
        path,
        method: "GET",
        headers: {
          authorization: `Bearer ${entry.apiKey}`,
          accept: "application/json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Invalid JSON from ${entry.id}${path}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
