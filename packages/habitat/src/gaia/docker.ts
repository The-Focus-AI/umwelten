/**
 * Docker Manager — manages habitat containers via the docker CLI.
 * No dockerode dependency — uses child_process.execFile directly.
 *
 * Port scheme (74xx block):
 *   7420 — Gaia orchestrator
 *   7421 — Legacy habitat web
 *   7430 — habitat serve (host-side)
 *   7440–7499 — Gaia-managed habitat containers (assigned sequentially)
 *   8080 — internal container port (never exposed directly)
 *
 * Storage: named Docker volumes (`gaia-<id>-data`), not bind mounts.
 */

import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ContainerStatus, GaiaHabitatEntry } from "./types.js";

const execFile = promisify(execFileCb);

/**
 * Run a command and pipe content to its stdin.
 * Node's execFile doesn't support `input` — only spawn does.
 */
function spawnWithStdin(
  command: string,
  args: string[],
  stdin: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

const NETWORK_NAME = "gaia-net";
const IMAGE_NAME = "habitat";
const CONTAINER_PREFIX = "gaia-";

/** First port in the habitat container range. */
const HABITAT_PORT_BASE = 7440;
/** Last port in the habitat container range (inclusive). */
const HABITAT_PORT_MAX = 7499;

function containerName(id: string): string {
  return `${CONTAINER_PREFIX}${id}`;
}

function volumeName(id: string): string {
  return `${CONTAINER_PREFIX}${id}-data`;
}

export class DockerManager {
  constructor(
    private readonly dataDir: string,
    private readonly projectRoot: string,
  ) {}

  /** Create the Docker network (idempotent). */
  async ensureNetwork(): Promise<void> {
    try {
      await execFile("docker", ["network", "create", NETWORK_NAME]);
    } catch (err: any) {
      // Network already exists — that's fine
      if (!err.stderr?.includes("already exists")) throw err;
    }
  }

  /** Build the habitat image from the project root. */
  async buildImage(): Promise<string> {
    const { stdout, stderr } = await execFile(
      "docker",
      ["build", "-t", IMAGE_NAME, "."],
      { cwd: this.projectRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout + stderr;
  }

  /**
   * Find the next available port in the 7440–7499 range.
   * Checks which ports are already bound by running containers.
   */
  private async findAvailablePort(entries: GaiaHabitatEntry[]): Promise<number> {
    const usedPorts = new Set(
      entries
        .filter((e) => e.containerPort)
        .map((e) => e.containerPort!),
    );
    for (let port = HABITAT_PORT_BASE; port <= HABITAT_PORT_MAX; port++) {
      if (!usedPorts.has(port)) return port;
    }
    throw new Error(`No available ports in range ${HABITAT_PORT_BASE}–${HABITAT_PORT_MAX}`);
  }

  /**
   * Start a container for a habitat entry.
   * Uses a named Docker volume and assigns a port from the 7440+ range.
   * Returns the assigned host port.
   */
  async startContainer(
    entry: GaiaHabitatEntry,
    _habitatDataDir: string,
    allEntries?: GaiaHabitatEntry[],
  ): Promise<number> {
    const name = containerName(entry.id);
    const volume = volumeName(entry.id);

    // Stop + remove if already exists
    await this.stopContainer(entry.id).catch(() => {});

    // Pick a port
    const hostPort = await this.findAvailablePort(allEntries ?? []);

    const args = [
      "run", "-d",
      "--name", name,
      "--network", NETWORK_NAME,
      "-v", `${volume}:/data`,
      "--env", `HABITAT_API_KEY=${entry.apiKey}`,
      "-p", `127.0.0.1:${hostPort}:8080`,
      IMAGE_NAME,
    ];

    await execFile("docker", args);
    return hostPort;
  }

  /**
   * Copy a file into a container's named volume.
   * Uses `docker cp` to write into the running container.
   */
  async copyToVolume(id: string, localPath: string, containerPath: string): Promise<void> {
    const name = containerName(id);
    await execFile("docker", ["cp", localPath, `${name}:${containerPath}`]);
  }

  /**
   * Write content directly into a container file via docker exec.
   */
  async writeToContainer(id: string, containerPath: string, content: string): Promise<void> {
    const name = containerName(id);
    await spawnWithStdin("docker", [
      "exec", "-i", name, "sh", "-c",
      `cat > '${containerPath}'`,
    ], content);
  }

  /**
   * Seed a named volume with config.json and secrets.json.
   * Uses a one-shot Alpine container to write files into the volume.
   */
  async seedVolume(
    id: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<void> {
    const volume = volumeName(id);

    // Ensure the volume exists
    try {
      await execFile("docker", ["volume", "create", volume]);
    } catch { /* may already exist */ }

    // Write each file using a one-shot container with stdin piped via spawn
    for (const file of files) {
      await spawnWithStdin("docker", [
        "run", "--rm", "-i",
        "-v", `${volume}:/data`,
        "alpine:3.20",
        "sh", "-c",
        `mkdir -p "$(dirname "/data/${file.path}")" && cat > "/data/${file.path}"`,
      ], file.content);
    }
  }

  /** Stop and remove a container (volume is preserved). */
  async stopContainer(id: string): Promise<void> {
    const name = containerName(id);
    try {
      await execFile("docker", ["stop", name], { timeout: 15000 });
    } catch { /* container may not exist */ }
    try {
      await execFile("docker", ["rm", name]);
    } catch { /* container may not exist */ }
  }

  /** Get the host port for a container. */
  async getContainerPort(id: string): Promise<number> {
    const name = containerName(id);
    const { stdout } = await execFile("docker", ["port", name, "8080"]);
    // Output like "127.0.0.1:7440" or "0.0.0.0:7440"
    const match = stdout.trim().match(/:(\d+)$/m);
    if (!match) throw new Error(`Could not determine port for container ${name}`);
    return parseInt(match[1], 10);
  }

  /** Get container status via docker inspect. */
  async getStatus(id: string): Promise<ContainerStatus> {
    const name = containerName(id);
    try {
      const { stdout } = await execFile("docker", [
        "inspect",
        "--format",
        "{{.State.Status}}",
        name,
      ]);
      return stdout.trim() as ContainerStatus;
    } catch {
      return "not-found";
    }
  }

  /** Get container logs. */
  async getLogs(id: string, tail = 100): Promise<string> {
    const name = containerName(id);
    try {
      const { stdout, stderr } = await execFile("docker", [
        "logs",
        "--tail",
        String(tail),
        name,
      ]);
      return stdout + stderr;
    } catch (err: any) {
      return `Error getting logs: ${err.message}`;
    }
  }

  /** Check if Docker is available. */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await execFile("docker", ["version", "--format", "{{.Server.Version}}"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Check if the habitat image exists. */
  async imageExists(): Promise<boolean> {
    try {
      await execFile("docker", ["image", "inspect", IMAGE_NAME]);
      return true;
    } catch {
      return false;
    }
  }

  /** Remove a named volume (data cleanup). */
  async removeVolume(id: string): Promise<void> {
    const volume = volumeName(id);
    try {
      await execFile("docker", ["volume", "rm", volume]);
    } catch { /* volume may not exist */ }
  }

  /** Check if a named volume exists. */
  async volumeExists(id: string): Promise<boolean> {
    const volume = volumeName(id);
    try {
      await execFile("docker", ["volume", "inspect", volume]);
      return true;
    } catch {
      return false;
    }
  }
}
