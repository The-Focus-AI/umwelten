/**
 * Bridge Worker Thread
 *
 * Runs the Dagger bridge service in a separate thread so it doesn't block the CLI.
 */

import { parentPort, workerData } from "worker_threads";
import { dag, connection } from "@dagger.io/dagger";

interface WorkerData {
  id: string;
  repoUrl: string;
  baseImage: string;
  port: number;
}

const { id, repoUrl, baseImage, port } = workerData as WorkerData;

// Send log messages to parent thread
const log = (msg: string) => {
  parentPort?.postMessage({ type: "log", message: msg });
  console.log(msg);
};

log(`[BridgeWorker:${id}] Starting bridge service on port ${port}...`);

connection(
  async () => {
    log(`[BridgeWorker:${id}] Building container from ${baseImage}...`);

    // Build container
    let container = dag.container().from(baseImage);

    // Setup bridge server (simplified version)
    container = container.withExec(["mkdir", "-p", "/opt/bridge"]).withNewFile(
      "/opt/bridge/server.js",
      `
const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);
const PORT = ${port};

const logBuffer = [];
function log(level, message) {
  const entry = { timestamp: new Date().toISOString(), level, message };
  logBuffer.push(entry);
  if (logBuffer.length > 1000) logBuffer.shift();
  console.error(\`[\${entry.timestamp}] \${level}: \${message}\`);
}

const tools = {
  'git/clone': async ({ repoUrl, path }) => {
    const targetPath = path || '/workspace';
    const env = process.env.GITHUB_TOKEN ? { ...process.env, GIT_ASKPASS: 'echo', GIT_USERNAME: 'token', GIT_PASSWORD: process.env.GITHUB_TOKEN } : process.env;
    const { stdout, stderr } = await execAsync(\`git clone --depth 1 "\${repoUrl}" "\${targetPath}"\`, { env, timeout: 60000 });
    return { content: [{ type: 'text', text: \`Successfully cloned \${repoUrl}\` }], metadata: { stdout, stderr } };
  },
  'fs/read': async ({ path: inputPath }) => {
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.join('/workspace', inputPath);
    if (!resolved.startsWith('/workspace') && !resolved.startsWith('/opt')) throw new Error('Access denied');
    const content = await fs.readFile(resolved, 'utf-8');
    return { content: [{ type: 'text', text: content }], metadata: { path: resolved, size: content.length } };
  },
  'fs/write': async ({ path: inputPath, content }) => {
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.join('/workspace', inputPath);
    if (!resolved.startsWith('/workspace') && !resolved.startsWith('/opt')) throw new Error('Access denied');
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
    return { content: [{ type: 'text', text: \`Wrote \${content.length} bytes\` }], metadata: { path: resolved, bytes: content.length } };
  },
  'fs/list': async ({ path: inputPath }) => {
    const resolved = path.isAbsolute(inputPath || '/workspace') ? (inputPath || '/workspace') : path.join('/workspace', inputPath || '/workspace');
    if (!resolved.startsWith('/workspace') && !resolved.startsWith('/opt')) throw new Error('Access denied');
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const formatted = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
    return { content: [{ type: 'text', text: formatted.map(e => \`\${e.type === 'directory' ? '[D]' : '[F]'} \${e.name}\`).join('\\n') }], metadata: { path: resolved, entries: formatted } };
  },
  'fs/exists': async ({ path: inputPath }) => {
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.join('/workspace', inputPath);
    if (!resolved.startsWith('/workspace') && !resolved.startsWith('/opt')) throw new Error('Access denied');
    try { await fs.access(resolved); return { content: [{ type: 'text', text: \`Exists: \${resolved}\` }], metadata: { exists: true, path: resolved } }; } catch { return { content: [{ type: 'text', text: \`Not found: \${resolved}\` }], metadata: { exists: false, path: resolved } }; }
  },
  'fs/stat': async ({ path: inputPath }) => {
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.join('/workspace', inputPath);
    if (!resolved.startsWith('/workspace') && !resolved.startsWith('/opt')) throw new Error('Access denied');
    const stats = await fs.stat(resolved);
    return { content: [{ type: 'text', text: \`\${resolved}: \${stats.size} bytes, \${stats.isDirectory() ? 'directory' : 'file'}\` }], metadata: { path: resolved, size: stats.size, isDirectory: stats.isDirectory(), isFile: stats.isFile(), modified: stats.mtime.toISOString(), created: stats.birthtime.toISOString() } };
  },
  'exec/run': async ({ command, cwd, timeout }) => {
    const workingDir = cwd || '/workspace';
    const resolvedCwd = path.isAbsolute(workingDir) ? workingDir : path.join('/workspace', workingDir);
    if (!resolvedCwd.startsWith('/workspace') && !resolvedCwd.startsWith('/opt')) throw new Error('Access denied');
    const { stdout, stderr } = await execAsync(command, { cwd: resolvedCwd, timeout: timeout || 60000, env: process.env });
    const content = [{ type: 'text', text: stdout || '(no stdout)' }];
    if (stderr) content.push({ type: 'text', text: \`STDERR:\n\${stderr}\` });
    return { content, metadata: { command, cwd: resolvedCwd } };
  },
  'bridge/health': async () => ({ content: [{ type: 'text', text: 'Bridge is healthy' }], metadata: { status: 'healthy', timestamp: new Date().toISOString(), uptime: process.uptime(), workspace: '/workspace' } }),
  'bridge/logs': async ({ lines }) => ({ content: [{ type: 'text', text: logBuffer.slice(-(lines || 100)).map(l => \`[\${l.timestamp}] \${l.level}: \${l.message}\`).join('\\n') }], metadata: { total: logBuffer.length } }),
};

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/mcp') { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { id, method, params } = JSON.parse(body);
      const handler = tools[method];
      if (!handler) { res.writeHead(200); res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: \`Method not found: \${method}\` } })); return; }
      const result = await handler(params || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    } catch (error) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 0, error: { code: -32000, message: error.message } }));
    }
  });
});

server.listen(PORT, () => log('info', \`Bridge server on port \${PORT}\`));
`,
    );

    // Clone the repo
    container = container.withExec([
      "git",
      "clone",
      "--depth",
      "1",
      repoUrl,
      "/workspace",
    ]);

    // Setup service
    container = container.withExposedPort(port);
    const service = container
      .withEntrypoint(["node", "/opt/bridge/server.js"])
      .asService();

    // Start service in background (non-blocking) so we can signal when ready
    log(`[BridgeWorker:${id}] Starting Dagger service...`);
    const servicePromise = service
      .up({ ports: [{ frontend: port, backend: port }] })
      .then(() => {
        log(`[BridgeWorker:${id}] service.up() completed (service stopped)`);
      })
      .catch((err: any) => {
        log(
          `[BridgeWorker:${id}] service.up() failed: ${err.message || String(err)}`,
        );
        parentPort?.postMessage({
          type: "error",
          error: err.message || String(err),
        });
      });

    // Wait a bit for the service to start and be reachable
    log(`[BridgeWorker:${id}] Waiting for service to be ready...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Now signal ready - service should be listening
    log(`[BridgeWorker:${id}] Signaling ready to parent on port ${port}...`);
    parentPort?.postMessage({ type: "ready", port });
    log(`[BridgeWorker:${id}] Ready message sent!`);

    // Keep worker alive by waiting for the service promise
    await servicePromise;
  },
  { LogOutput: process.stderr },
).catch((err: any) => {
  log(`[BridgeWorker:${id}] Failed: ${err.message || String(err)}`);
  parentPort?.postMessage({ type: "error", error: err.message || String(err) });
  process.exit(1);
});
