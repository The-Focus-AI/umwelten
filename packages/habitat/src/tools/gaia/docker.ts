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
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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

/**
 * Merge a freshly-built secrets.json seed with the volume's existing contents.
 * Operator-seeded keys win on conflict; existing-only keys (per-user
 * `TOKEN:<sub>` entries and runtime-rotated refresh tokens the habitat owns)
 * are preserved. Falls back to the raw seed when there's nothing to merge or
 * either side isn't valid JSON. Pure (no IO) so it's unit-testable.
 */
export function mergeSecretsJson(existingRaw: string, seed: string): string {
  if (!existingRaw.trim()) return seed;
  try {
    const existing = JSON.parse(existingRaw) as Record<string, unknown>;
    const incoming = JSON.parse(seed) as Record<string, unknown>;
    return JSON.stringify({ ...existing, ...incoming }, null, 2) + "\n";
  } catch {
    return seed;
  }
}

/** Default Docker network children attach to when none is configured. */
const DEFAULT_NETWORK_NAME = "gaia-net";
/**
 * Which Docker network spawned habitats join for reverse-proxy ingress.
 * Override with `GAIA_INGRESS_NETWORK` to reuse an existing caddy-docker-proxy
 * network (e.g. a host that already runs caddy on a network named `caddy` —
 * #170): set it to that network's name so the existing proxy sees the children
 * and routes their `caddy=` labels. The network must already exist (ensureNetwork
 * no-ops when it does); a missing default network is created.
 */
function resolveNetworkName(): string {
  return process.env.GAIA_INGRESS_NETWORK?.trim() || DEFAULT_NETWORK_NAME;
}
/** Default image every habitat runs unless its registry entry says otherwise. */
export const DEFAULT_IMAGE_NAME = "habitat";
const CONTAINER_PREFIX = "gaia-";

/** First port in the habitat container range. */
const HABITAT_PORT_BASE = 7440;
/** Last port in the habitat container range (inclusive). */
const HABITAT_PORT_MAX = 7499;

/** Internal port every habitat container listens on (never published publicly). */
export const CHILD_INTERNAL_PORT = 8080;

/** Container (and embedded-DNS) name for a habitat: `gaia-<id>`. */
export function containerName(id: string): string {
  return `${CONTAINER_PREFIX}${id}`;
}

/**
 * In-network base URL for reaching a habitat from Gaia (or any container on the
 * shared ingress network): `http://gaia-<id>:8080`. Gaia addresses children by
 * Docker embedded DNS over the shared network rather than via host loopback
 * ports, so Gaia no longer needs host networking (#170 follow-up).
 */
export function childBaseUrl(id: string): string {
  return `http://${containerName(id)}:${CHILD_INTERNAL_PORT}`;
}

function volumeName(id: string): string {
  return `${CONTAINER_PREFIX}${id}-data`;
}

/**
 * Choose the host port for a habitat container (pure; exported for tests).
 *
 * Ports recorded by OTHER entries are taken. The entry's own recorded port is
 * explicitly free — a restart/rebuild reclaims it, so the habitat stays at a
 * stable address instead of hopping ports on every rebuild (which broke
 * anything pinned to the old port and leaked the 7440–7499 range dry).
 */
export function pickHostPort(
  entries: GaiaHabitatEntry[],
  self?: Pick<GaiaHabitatEntry, "id" | "containerPort">,
): number {
  const usedPorts = new Set(
    entries
      .filter((e) => e.containerPort && e.id !== self?.id)
      .map((e) => e.containerPort!),
  );
  const preferred = self?.containerPort;
  if (
    preferred &&
    preferred >= HABITAT_PORT_BASE &&
    preferred <= HABITAT_PORT_MAX &&
    !usedPorts.has(preferred)
  ) {
    return preferred;
  }
  for (let port = HABITAT_PORT_BASE; port <= HABITAT_PORT_MAX; port++) {
    if (!usedPorts.has(port)) return port;
  }
  throw new Error(
    `No available ports in range ${HABITAT_PORT_BASE}–${HABITAT_PORT_MAX}`,
  );
}

/**
 * Public hostname a habitat is served at via the Caddy label proxy (#170).
 * Explicit `entry.hostname` wins; otherwise derive `<id>.$GAIA_BASE_DOMAIN`.
 * Returns undefined when neither is set — no Caddy label is emitted (local dev).
 */
export function resolveHabitatHostname(
  entry: Pick<GaiaHabitatEntry, "id" | "hostname">,
): string | undefined {
  if (entry.hostname) return entry.hostname;
  const base = process.env.GAIA_BASE_DOMAIN?.trim();
  return base ? `${entry.id}.${base}` : undefined;
}

export class DockerManager {
  constructor(
    private readonly dataDir: string,
    private readonly projectRoot: string,
  ) {}

  /** Create the Docker network (idempotent). */
  async ensureNetwork(): Promise<void> {
    try {
      await execFile("docker", ["network", "create", resolveNetworkName()]);
    } catch (err: any) {
      // Network already exists — that's fine (also the expected case when
      // reusing an externally-managed network via GAIA_INGRESS_NETWORK).
      if (!err.stderr?.includes("already exists")) throw err;
    }
  }

  /** Build the habitat image from the project root. */
  async buildImage(): Promise<string> {
    const { stdout, stderr } = await execFile(
      "docker",
      ["build", "-t", DEFAULT_IMAGE_NAME, "."],
      { cwd: this.projectRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout + stderr;
  }

  /**
   * Find the next available port in the 7440–7499 range.
   * Checks which ports are already bound by running containers.
   */
  private async findAvailablePort(
    entries: GaiaHabitatEntry[],
    self?: Pick<GaiaHabitatEntry, "id" | "containerPort">,
  ): Promise<number> {
    return pickHostPort(entries, self);
  }

  /**
   * Host path where a container's sessions are bind-mounted (#119) — one
   * subdirectory per habitat entry under the Gaia data dir, so host-side
   * introspection (`umwelten browse --sessions-dir`, the digester) sees
   * in-container sessions with configuration only.
   */
  hostSessionsDir(id: string): string {
    return join(this.dataDir, "sessions", id);
  }

  /**
   * Start a container for a habitat entry.
   * Uses a named Docker volume and assigns a port from the 7440+ range;
   * the sessions subdirectory is additionally bind-mounted to the host
   * (session egress, #119). Returns the assigned host port.
   */
  async startContainer(
    entry: GaiaHabitatEntry,
    _habitatDataDir: string,
    allEntries?: GaiaHabitatEntry[],
  ): Promise<number> {
    const name = containerName(entry.id);
    const volume = volumeName(entry.id);

    // Per-entry image: a missing custom image is a hard error, never a
    // silent fallback to the default.
    const image = entry.image ?? DEFAULT_IMAGE_NAME;
    if (entry.image && !(await this.imageExists(entry.image))) {
      throw new Error(
        `Image "${entry.image}" for habitat "${entry.id}" not found. ` +
          `Build or pull it first — the Gaia build task only builds the default "${DEFAULT_IMAGE_NAME}" image.`,
      );
    }

    // Stop + remove if already exists
    await this.stopContainer(entry.id).catch(() => {});

    // Pick a port — a restart/rebuild keeps the entry's existing port (its own
    // registry record must not count as "in use", or every rebuild would hop
    // to the next port and eventually exhaust the 7440–7499 range).
    const hostPort = await this.findAvailablePort(allEntries ?? [], entry);

    // Session egress (#119): the sessions subdir lives on the host so it
    // survives volume lifecycle and is readable by host-side introspection.
    // Never cleared here — stop/rebuild preserves session files.
    const sessionsHostDir = this.hostSessionsDir(entry.id);
    await mkdir(sessionsHostDir, { recursive: true });

    const args = [
      "run", "-d",
      "--name", name,
      "--network", resolveNetworkName(),
      "-v", `${volume}:/data`,
      "-v", `${sessionsHostDir}:/data/sessions`,
      "--env", `HABITAT_API_KEY=${entry.apiKey}`,
      "-p", `127.0.0.1:${hostPort}:8080`,
    ];

    // Caddy label-driven routing (#170): when a public hostname is configured,
    // stamp labels so caddy-docker-proxy publishes https://<hostname> → this
    // container's :8080 over gaia-net (the loopback -p binding above stays for
    // Gaia's own proxy; Caddy reaches the container by network DNS instead).
    // Identity is per-container, set at run time — never baked into the image.
    // No hostname / GAIA_BASE_DOMAIN ⇒ no labels (local dev is unaffected).
    const hostname = resolveHabitatHostname(entry);
    if (hostname) {
      args.push(
        "--label", `caddy=${hostname}`,
        "--label", "caddy.reverse_proxy={{upstreams 8080}}",
      );
      // Public origin for absolute artifact/asset URLs (#194). Gaia's proxy
      // does not set X-Forwarded-* and rewrites Host to the internal docker
      // name, so getPublicBaseUrl can't infer the public origin from headers
      // inside the child. BASE_URL (which it prefers when no X-Forwarded-* is
      // present) pins it to the Caddy-published https origin.
      args.push("--env", `BASE_URL=https://${hostname}`);
    }

    // Per-user identity (ADR 0003): when a JWKS is configured, spawn the child
    // in JWT-verify mode (audience = its own public URL, keys from the SaaS
    // JWKS). HABITAT_API_KEY above stays, so the habitat accepts a per-user JWT
    // (from the SaaS) OR the shared bearer (Gaia's relay) — dual-auth. Needs a
    // public hostname to form the audience; unset GAIA_JWKS_URL ⇒ bearer-only.
    const jwksUrl = process.env.GAIA_JWKS_URL?.trim();
    if (hostname && jwksUrl) {
      args.push(
        "--env", `HABITAT_AUTH_AUDIENCE=https://${hostname}`,
        "--env", `HABITAT_AUTH_JWKS_URL=${jwksUrl}`,
      );
    }

    // Per-user token delivery (#56): enable the narrow POST /api/secrets receiver
    // on spawned habitats when GAIA_SECRET_WRITE_PREFIXES is set (e.g.
    // "TWITTER_REFRESH_TOKEN:"), so the SaaS can push per-user X tokens. Unset ⇒
    // the endpoint stays disabled (404).
    const secretWritePrefixes = process.env.GAIA_SECRET_WRITE_PREFIXES?.trim();
    if (secretWritePrefixes) {
      args.push("--env", `HABITAT_SECRET_WRITE_PREFIXES=${secretWritePrefixes}`);
    }

    args.push(image);

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
      // secrets.json is owned partly by the operator (seeded bindings from
      // Gaia's vault) and partly by the running habitat (per-user
      // `TOKEN:<sub>` entries and single-use refresh tokens it rotates at
      // runtime). A blind overwrite on rebuild would wipe the habitat-owned
      // keys — which silently breaks per-user auth (e.g. Twitter) after every
      // rebuild. Merge instead: keep existing keys the seed doesn't manage,
      // let seeded keys update.
      let content = file.content;
      if (file.path === "secrets.json") {
        content = await this.mergeSecretsSeed(volume, file.content);
      }
      await spawnWithStdin("docker", [
        "run", "--rm", "-i",
        "-v", `${volume}:/data`,
        "alpine:3.20",
        "sh", "-c",
        `mkdir -p "$(dirname "/data/${file.path}")" && cat > "/data/${file.path}"`,
      ], content);
    }
  }

  /**
   * Merge a freshly-built secrets.json seed with whatever the volume already
   * holds, so habitat-rotated / per-user secrets survive a re-seed. Seeded
   * (operator) keys win on conflict; existing-only keys are preserved. Falls
   * back to the raw seed if either side isn't valid JSON (first-time seed,
   * corruption).
   */
  private async mergeSecretsSeed(
    volume: string,
    seed: string,
  ): Promise<string> {
    let existingRaw = "";
    try {
      const { stdout } = await execFile("docker", [
        "run", "--rm",
        "-v", `${volume}:/data`,
        "alpine:3.20",
        "sh", "-c",
        "cat /data/secrets.json 2>/dev/null || true",
      ]);
      existingRaw = stdout;
    } catch {
      /* volume may be empty / file absent — treat as no existing secrets */
    }
    return mergeSecretsJson(existingRaw, seed);
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

  /** Check if an image exists (default: the standard habitat image). */
  async imageExists(image: string = DEFAULT_IMAGE_NAME): Promise<boolean> {
    try {
      await execFile("docker", ["image", "inspect", image]);
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
