/**
 * Habitat Bridge Lifecycle Manager
 *
 * Manages Dagger container lifecycle for Habitat Bridge servers.
 * Handles creation, destruction, health monitoring, and iterative provisioning.
 */

import { dag, connection, Container, Service } from "@dagger.io/dagger";
import { HabitatBridgeClient } from "./client.js";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Logger utility for structured logging
function log(id: string, step: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    component: "BridgeLifecycle",
    id,
    step,
    message,
    data,
  };
  console.log(
    `[${timestamp}] [BridgeLifecycle:${id}] [${step}] ${message}`,
    data ? JSON.stringify(data) : "",
  );
  return logEntry;
}

export interface BridgeProvisioning {
  baseImage: string;
  aptPackages: string[];
  gitRepos: Array<{ name: string; url: string; path: string }>;
  secrets?: Array<{ name: string; value: string }>; // Secrets to inject securely
}

export interface BridgeInstance {
  id: string;
  client: HabitatBridgeClient;
  service: Service;
  port: number;
  provisioning: BridgeProvisioning;
  createdAt: Date;
}

export class BridgeLifecycle {
  private bridges = new Map<string, BridgeInstance>();
  private portCounter = 8080;

  /**
   * Create a new bridge instance with the specified provisioning
   */
  async createBridge(
    id: string,
    repoUrl: string,
    provisioning: BridgeProvisioning,
  ): Promise<BridgeInstance> {
    log(id, "INIT", "Creating bridge", {
      baseImage: provisioning.baseImage,
      aptPackages: provisioning.aptPackages.length,
      gitRepos: provisioning.gitRepos.length,
    });

    // Allocate port
    const port = this.allocatePort();
    log(id, "PORT", "Allocated port", { port });

    // Start worker thread to run Dagger service in background
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const workerPath = join(__dirname, "bridge-worker.ts");

    log(id, "WORKER", "Spawning worker thread", { workerPath });

    // Collect secrets from environment (by name)
    const secrets: Array<{ name: string; value: string }> = [];
    if (provisioning.secrets) {
      for (const secret of provisioning.secrets) {
        if (secret.value) {
          secrets.push(secret);
        }
      }
    }
    // Also check for common secrets
    if (process.env.GITHUB_TOKEN) {
      secrets.push({ name: "GITHUB_TOKEN", value: process.env.GITHUB_TOKEN });
    }

    const worker = new Worker(workerPath, {
      workerData: {
        id,
        repoUrl,
        baseImage: provisioning.baseImage,
        port,
        aptPackages: provisioning.aptPackages,
        secrets,
      },
      execArgv: ["-r", "tsx"], // Enable TypeScript support in worker
    });

    log(id, "WORKER", "Worker thread spawned, waiting for ready signal");

    // Wait for worker to signal ready or error (with timeout)
    const WORKER_TIMEOUT = 60000; // 60 seconds (increased for Dagger startup)
    log(id, "WAIT", "Waiting for worker ready", { timeoutMs: WORKER_TIMEOUT });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        log(id, "TIMEOUT", "Worker startup timeout - terminating");
        worker.terminate();
        reject(new Error(`Worker startup timed out after ${WORKER_TIMEOUT}ms`));
      }, WORKER_TIMEOUT);

      worker.on(
        "message",
        (msg: {
          type: string;
          port?: number;
          error?: string;
          message?: string;
          step?: string;
          data?: unknown;
        }) => {
          if (msg.type === "log") {
            // Forward structured worker logs
            console.log(
              `[${new Date().toISOString()}] [Worker:${id}] [${msg.step || "LOG"}] ${msg.message}`,
              msg.data ? JSON.stringify(msg.data) : "",
            );
            return;
          }

          clearTimeout(timeout);
          if (msg.type === "ready") {
            log(id, "READY", "Worker reports ready", { port: msg.port });
            resolve();
          } else if (msg.type === "error") {
            log(id, "ERROR", "Worker reported error", { error: msg.error });
            reject(new Error(msg.error || "Worker failed"));
          }
        },
      );

      worker.once("error", (err) => {
        log(id, "ERROR", "Worker error event", { error: err.message });
        clearTimeout(timeout);
        reject(err);
      });

      worker.once("exit", (code) => {
        log(id, "EXIT", "Worker exited", { code });
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    });

    // Create client
    log(id, "CLIENT", "Creating bridge client", {
      host: "localhost",
      port,
      timeout: 5000,
    });
    const client = new HabitatBridgeClient({
      host: "localhost",
      port,
      timeout: 5000,
      id, // Pass ID for logging
    });

    // Wait for service to be reachable (with retries)
    log(id, "HEALTH", "Waiting for service to be reachable", { port });
    await this.waitForServiceReady(client, id, port);

    log(id, "SUCCESS", "Bridge container ready", { port, provisioning });

    const instance: BridgeInstance = {
      id,
      client,
      service: null as any, // Service is managed by worker
      port,
      provisioning,
      createdAt: new Date(),
    };

    this.bridges.set(id, instance);
    log(id, "TRACK", "Bridge instance tracked", {
      totalBridges: this.bridges.size,
    });
    return instance;
  }

  /**
   * Destroy a bridge instance
   */
  async destroyBridge(id: string): Promise<void> {
    log(id, "DESTROY", "Destroying bridge");
    const instance = this.bridges.get(id);
    if (!instance) {
      log(id, "DESTROY", "Bridge not found, nothing to destroy");
      return;
    }

    // Disconnect client
    log(id, "DESTROY", "Disconnecting client");
    await instance.client.disconnect();

    // Stop service
    // Note: Dagger doesn't have a direct stop method, but the service will be garbage collected
    // when the container is destroyed
    log(id, "DESTROY", "Service will be garbage collected");

    // Remove from tracking
    this.bridges.delete(id);
    log(id, "DESTROY", "Bridge removed from tracking", {
      remainingBridges: this.bridges.size,
    });
  }

  /**
   * Check if a bridge is healthy
   */
  async isHealthy(id: string): Promise<boolean> {
    log(id, "HEALTH", "Checking bridge health");
    const instance = this.bridges.get(id);
    if (!instance) {
      log(id, "HEALTH", "Bridge not found");
      return false;
    }

    try {
      const health = await instance.client.health();
      const isHealthy = health.status === "healthy";
      log(
        id,
        "HEALTH",
        `Health check result: ${isHealthy ? "healthy" : "unhealthy"}`,
        { status: health.status },
      );
      return isHealthy;
    } catch (err: any) {
      log(id, "HEALTH", "Health check failed", { error: err.message });
      return false;
    }
  }

  /**
   * Get logs from a bridge
   */
  async getLogs(id: string, lines?: number): Promise<string[]> {
    log(id, "LOGS", "Getting bridge logs", { lines });
    const instance = this.bridges.get(id);
    if (!instance) {
      log(id, "LOGS", "Bridge not found");
      return [];
    }

    try {
      const logs = await instance.client.getLogs(lines);
      log(id, "LOGS", `Retrieved ${logs.length} log lines`);
      return logs;
    } catch {
      return [];
    }
  }

  /**
   * List all active bridges
   */
  listBridges(): BridgeInstance[] {
    return Array.from(this.bridges.values());
  }

  /**
   * Recreate a bridge with new provisioning
   */
  async recreateBridge(
    id: string,
    repoUrl: string,
    newProvisioning: BridgeProvisioning,
  ): Promise<BridgeInstance> {
    // Destroy old bridge
    await this.destroyBridge(id);

    // Create new bridge
    return this.createBridge(id, repoUrl, newProvisioning);
  }

  private allocatePort(): number {
    return this.portCounter++;
  }

  private async installGit(
    container: Container,
    baseImage: string,
  ): Promise<Container> {
    // Install git based on base image type (don't check first - just install)
    if (baseImage.includes("alpine")) {
      return container
        .withExec(["apk", "add", "--no-cache", "git"])
        .withExec(["apk", "add", "--no-cache", "nodejs", "npm"]);
    } else {
      // For ubuntu/debian, update and install
      return container.withExec([
        "bash",
        "-c",
        "apt-get update -qq && apt-get install -y -qq git curl ca-certificates && rm -rf /var/lib/apt/lists/*",
      ]);
    }
  }

  private async installAptPackages(
    container: Container,
    packages: string[],
    baseImage: string,
  ): Promise<Container> {
    // Install packages based on base image type
    if (baseImage.includes("alpine")) {
      return container.withExec(["apk", "add", "--no-cache", ...packages]);
    } else {
      // Assume apt-get for ubuntu/debian
      return container.withExec([
        "bash",
        "-c",
        `apt-get update -qq && apt-get install -y -qq ${packages.join(" ")} && rm -rf /var/lib/apt/lists/*`,
      ]);
    }
  }

  private async setupBridgeServer(
    container: Container,
    baseImage: string,
  ): Promise<Container> {
    // Check if this is a node base image - if so, git might need to be installed
    // If it's ubuntu/debian without node, we need to start with node image instead
    if (!baseImage.includes("node")) {
      console.log(
        `[BridgeLifecycle] Warning: Base image ${baseImage} doesn't include Node.js. Bridge server requires Node.`,
      );
      console.log(
        `[BridgeLifecycle] Consider using node:20 or similar as base image`,
      );
    }

    // For non-node images, we should have switched to node image by now
    // If we're here with ubuntu/etc, something went wrong in provisioning

    // Create bridge directory
    container = container.withExec(["mkdir", "-p", "/opt/bridge"]);

    // Copy bridge server code (in production, this would be a bundled file)
    // For now, we'll create a minimal setup
    // TODO: Replace with actual bundled bridge server
    const bridgeCode = `
const http = require('http');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);
const PORT = process.argv.includes('--port') ? parseInt(process.argv[process.argv.indexOf('--port') + 1], 10) : 8080;

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
`;

    container = container.withNewFile("/opt/bridge/server.js", bridgeCode);

    return container;
  }

  private async waitForBridge(
    client: HabitatBridgeClient,
    maxRetries: number,
    delayMs: number,
  ): Promise<void> {
    console.log(`[BridgeLifecycle] Waiting for bridge to be ready...`);
    for (let i = 0; i < maxRetries; i++) {
      console.log(
        `[BridgeLifecycle] Connection attempt ${i + 1}/${maxRetries}...`,
      );
      try {
        await client.connect();
        console.log(`[BridgeLifecycle] Client connected, checking health...`);
        const health = await client.health();
        console.log(`[BridgeLifecycle] Health status: ${health.status}`);
        if (health.status === "healthy") {
          console.log(`[BridgeLifecycle] Bridge is ready!`);
          return;
        }
      } catch (err: any) {
        console.log(
          `[BridgeLifecycle] Connection attempt failed: ${err.message || String(err)}`,
        );
      }

      console.log(`[BridgeLifecycle] Waiting ${delayMs}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error("Bridge failed to become ready after maximum retries");
  }

  private async waitForServiceReady(
    client: HabitatBridgeClient,
    id: string,
    port: number,
  ): Promise<void> {
    const maxRetries = 30;
    const delayMs = 1000; // Increased delay for Dagger service startup
    console.log(
      `[BridgeLifecycle:${id}] Waiting for service health check on port ${port}...`,
    );

    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(
          `[BridgeLifecycle:${id}] Health check attempt ${i + 1}/${maxRetries}...`,
        );
        await client.connect();
        console.log(
          `[BridgeLifecycle:${id}] Client connected, checking health...`,
        );
        const health = await client.health();
        console.log(`[BridgeLifecycle:${id}] Health status: ${health.status}`);
        if (health.status === "healthy") {
          console.log(`[BridgeLifecycle:${id}] Service is healthy!`);
          return;
        }
      } catch (err: any) {
        // Expected while service starts up
        console.log(
          `[BridgeLifecycle:${id}] Health check failed: ${err.message || String(err)}`,
        );
      }
      console.log(
        `[BridgeLifecycle:${id}] Waiting ${delayMs}ms before retry...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(
      `Bridge ${id} failed to become ready after ${maxRetries} retries`,
    );
  }
}
