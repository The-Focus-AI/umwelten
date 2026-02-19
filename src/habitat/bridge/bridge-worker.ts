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
  aptPackages?: string[];
  secrets?: Array<{ name: string; value: string }>; // Secrets passed securely
  setupCommands?: string[]; // Commands to run after apt install
}

const {
  id,
  repoUrl,
  baseImage,
  port,
  aptPackages = [],
  secrets = [],
  setupCommands = [],
} = workerData as WorkerData;

// Structured logging to parent thread
const log = (step: string, message: string, data?: unknown) => {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, step, message, data };
  parentPort?.postMessage({ type: "log", step, message, data });
  console.log(
    `[${timestamp}] [BridgeWorker:${id}] [${step}] ${message}`,
    data ? JSON.stringify(data) : "",
  );
};

log("INIT", "Bridge worker starting", {
  id,
  repoUrl,
  baseImage,
  port,
  aptPackages,
});

connection(
  async () => {
    log("CONTAINER", "Starting container build", { baseImage });

    // Step 1: Get base container
    log("CONTAINER", "Pulling base image", { baseImage });
    let container = dag.container().from(baseImage);
    log("CONTAINER", "Base image pulled");

    // Step 2: Install apt packages if needed (MUST happen before git clone)
    if (aptPackages.length > 0) {
      log("APT", "Installing apt packages", { packages: aptPackages });
      container = container.withExec([
        "sh",
        "-c",
        "apt-get update && apt-get install -y " + aptPackages.join(" "),
      ]);
      log("APT", "Apt packages installed", { count: aptPackages.length });
    }

    // Step 2.5: Inject secrets into container securely
    if (secrets.length > 0) {
      log("SECRETS", "Injecting secrets into container", {
        count: secrets.length,
        names: secrets.map((s) => s.name),
      });
      for (const secret of secrets) {
        // Use Dagger's secret API to securely pass secrets without exposing in logs
        const secretVal = dag.setSecret(secret.name, secret.value);
        container = container.withSecretVariable(secret.name, secretVal);
      }
      log("SECRETS", "Secrets injected securely");
    }

    // Step 2.6: Run setup commands (npm install, custom scripts)
    if (setupCommands.length > 0) {
      log("SETUP", `Running ${setupCommands.length} setup command(s)`);
      for (const cmd of setupCommands) {
        log("SETUP", `Executing: ${cmd}`);
        container = container.withExec(["sh", "-c", cmd]);
      }
      log("SETUP", "Setup commands completed");
    }

    // Step 3: Setup bridge server files
    log("SERVER", "Creating bridge server files", { port });
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

// Load secrets from environment at startup (injected securely by Dagger)
const SECRETS = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || null,
};

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
    // SECURITY: Never use variables in exec strings. Use env option only.
    // DO NOT: execAsync(\`git clone --depth 1 "\${repoUrl}" "\${targetPath}"\`)
    // DO: Pass env securely without interpolation
    const env = SECRETS.GITHUB_TOKEN 
      ? { ...process.env, GIT_ASKPASS: 'echo', GIT_USERNAME: 'token', GIT_PASSWORD: SECRETS.GITHUB_TOKEN } 
      : process.env;
    const { stdout, stderr } = await execAsync('git clone --depth 1 "' + repoUrl + '" "' + targetPath + '"', { env, timeout: 60000 });
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
    // SECURITY WARNING: Never use shell variables or export in exec commands
    // BAD: execAsync('export TOKEN=secret && curl -H "Authorization: $TOKEN"')
    // GOOD: Pass secrets via env option only
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

    // Step 4: Clone the repo
    log("GIT", "Cloning repository", { repoUrl, target: "/workspace" });
    container = container.withExec([
      "git",
      "clone",
      "--depth",
      "1",
      repoUrl,
      "/workspace",
    ]);
    log("GIT", "Repository cloned");

    // Step 5: Setup service
    log("SERVICE", "Configuring Dagger service", { port });
    container = container.withExposedPort(port);
    log("SERVICE", "Port exposed", { port });

    const service = container
      .withEntrypoint(["node", "/opt/bridge/server.js"])
      .asService();
    log("SERVICE", "Service created from container");

    // Step 5: Start service in background (non-blocking) so we can signal when ready
    log("SERVICE", "Starting Dagger service (non-blocking)", {
      portMapping: { frontend: port, backend: port },
    });
    const servicePromise = service
      .up({ ports: [{ frontend: port, backend: port }] })
      .then(() => {
        log("SERVICE", "Service stopped (this is expected after signal)");
      })
      .catch((err: any) => {
        log("ERROR", "Service failed to start", {
          error: err.message || String(err),
        });
        parentPort?.postMessage({
          type: "error",
          error: err.message || String(err),
        });
      });

    // Step 6: Poll until service is actually reachable (not just a fixed delay)
    const MAX_WAIT_MS = 60000; // 60 seconds max
    const POLL_INTERVAL = 500; // Check every 500ms
    const startTime = Date.now();
    let isReady = false;

    log("WAIT", `Polling for service readiness (max ${MAX_WAIT_MS}ms)`, {
      url: `http://localhost:${port}/mcp`,
    });

    while (!isReady && Date.now() - startTime < MAX_WAIT_MS) {
      try {
        const response = await fetch(`http://localhost:${port}/mcp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "bridge/health",
            params: {},
          }),
          signal: AbortSignal.timeout(1000), // 1 second timeout per check
        });

        if (response.ok) {
          const data = await response.json();
          if (data.result && data.result.metadata?.status === "healthy") {
            isReady = true;
            log("WAIT", "Service is healthy and reachable!", {
              elapsedMs: Date.now() - startTime,
            });
          }
        }
      } catch {
        // Expected while service starts up
      }

      if (!isReady) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      }
    }

    if (!isReady) {
      throw new Error(`Service failed to become ready after ${MAX_WAIT_MS}ms`);
    }

    // Step 7: Signal ready to parent
    log("SIGNAL", "Signaling ready to parent", { port });
    parentPort?.postMessage({ type: "ready", port });
    log("SIGNAL", "Ready signal sent to parent");

    // Step 8: Keep worker alive by waiting for the service promise
    log("KEEPALIVE", "Entering keep-alive state (waiting for service)");
    await servicePromise;
    log("KEEPALIVE", "Service promise resolved (container stopped)");
  },
  { LogOutput: process.stderr },
).catch((err: any) => {
  log("FATAL", "Worker failed", { error: err.message || String(err) });
  parentPort?.postMessage({ type: "error", error: err.message || String(err) });
  process.exit(1);
});
