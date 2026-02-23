/**
 * LLM-driven container builder using Dagger's dag.llm() with env.
 *
 * The LLM reads the repo, configures a base container (install deps, copy repo),
 * and produces a container. We then add our fixed layers (Go binary, secrets, port, entrypoint).
 *
 * If dag.llm() fails, falls back to a simple heuristic-based build.
 */

import { dag, type Container, type Directory } from "@dagger.io/dagger";
import type { SavedProvisioning } from "../types.js";

export interface ContainerBuilderOptions {
  repoUrl: string;
  secrets: Array<{ name: string; value: string }>;
  port: number;
  goBinaryPath: string;
  /** Previous build info passed as context hint to LLM */
  previousProvisioning?: SavedProvisioning;
}

export interface ContainerBuildResult {
  container: Container;
  provisioning: SavedProvisioning;
}

function buildPrompt(previousProvisioning?: SavedProvisioning): string {
  let prompt = `You are configuring a container to run a project.

STEP 1: List the top-level files in $repo using the entries tool.
STEP 2: Determine the project type from these rules (check in order):
  - package.json or package-lock.json → Node.js project
  - requirements.txt or pyproject.toml or setup.py → Python project
  - Cargo.toml → Rust project
  - go.mod → Go project
  - If NONE of the above files exist, this is a shell/script project. Do NOT install python or node.

STEP 3: Read the README.md (if it exists) to understand what the project does and what tools it needs.

STEP 4: Configure $builder:
  - Run "apt-get update" first
  - Install git via apt-get (always)
  - For Node.js: install nodejs and npm via apt-get, then run "npm install" in /workspace
  - For Python: install python3 and python3-pip via apt-get
  - For shell/script projects: install ONLY what the README or scripts explicitly mention (e.g. imagemagick, jq, curl)
  - Copy $repo into /workspace using withDirectory
  - Set working directory to /workspace

CRITICAL: Do NOT install python3 unless you found requirements.txt, pyproject.toml, or setup.py.
Do NOT install nodejs unless you found package.json.
Do NOT configure an entrypoint or expose ports.
Do NOT run the project — just install dependencies.`;

  if (
    previousProvisioning?.reasoning &&
    previousProvisioning.reasoning !== "" &&
    !previousProvisioning.reasoning.startsWith("Fallback build:")
  ) {
    prompt += `\n\nHint from a previous successful build: ${previousProvisioning.reasoning.slice(0, 500)}`;
  }

  return prompt;
}

/**
 * Build a container from a git repo using dag.llm() with env.
 *
 * The LLM reads the repo, configures a base container, installs deps.
 * We then add our fixed layers: Go binary, secrets, port, entrypoint.
 */
export async function buildContainerWithLLM(
  repo: Directory,
  options: ContainerBuilderOptions,
): Promise<ContainerBuildResult> {
  const { secrets, port, goBinaryPath, previousProvisioning } = options;

  // Create env following the documented pattern:
  // - Directory input for the repo (LLM reads it)
  // - Container input as base builder (LLM modifies it)
  // - Container output for the result
  const env = dag
    .env()
    .withDirectoryInput(
      "repo",
      repo,
      "The project repository. List its entries first to determine the project type.",
    )
    .withContainerInput(
      "builder",
      dag.container().from("ubuntu:22.04").withWorkdir("/workspace"),
      "The base container. Install dependencies and copy $repo to /workspace.",
    )
    .withContainerOutput(
      "result",
      "The configured container with dependencies installed and repo at /workspace.",
    );

  // Create LLM with env — extracting the output triggers the work implicitly
  const work = dag
    .llm()
    .withEnv(env)
    .withPrompt(buildPrompt(previousProvisioning));

  // Extract the container from the env output (this triggers the LLM loop)
  let container = work.env().output("result").asContainer();

  // Get the LLM's reasoning for logging/saving
  const reply = await work.lastReply();

  // Apply our fixed layers on top (these never change, LLM doesn't decide them)

  // 1. Mount Go MCP server binary
  const hostBinary = dag.host().file(goBinaryPath);
  container = container
    .withExec(["mkdir", "-p", "/opt/bridge"])
    .withFile("/opt/bridge/bridge-server", hostBinary, { permissions: 0o755 });

  // 2. Inject secrets
  if (secrets.length > 0) {
    for (const secret of secrets) {
      const secretVal = dag.setSecret(secret.name, secret.value);
      container = container.withSecretVariable(secret.name, secretVal);
    }
  }

  // 3. Expose port and set entrypoint
  container = container
    .withExposedPort(port)
    .withEntrypoint(["/opt/bridge/bridge-server", "--port", String(port)]);

  // Build provisioning record from what the LLM did
  const provisioning: SavedProvisioning = {
    baseImage: "llm-selected",
    buildSteps: ["LLM-built container via dag.llm()"],
    envVarNames: secrets.map((s) => s.name),
    reasoning: (reply || "").slice(0, 1000),
    analyzedAt: new Date().toISOString(),
  };

  return { container, provisioning };
}

/**
 * Fallback: build container with simple heuristics when dag.llm() isn't available.
 * Uses the fluent Dagger API directly based on repo file detection.
 */
export async function buildContainerWithFallback(
  repo: Directory,
  options: ContainerBuilderOptions,
): Promise<ContainerBuildResult> {
  const { secrets, port, goBinaryPath } = options;

  // Read top-level entries to detect project type
  const entries = await repo.entries();

  let baseImage = "ubuntu:22.04";
  const buildSteps: string[] = [];

  if (entries.includes("package.json")) {
    baseImage = "node:20";
    buildSteps.push("npm install");
  } else if (
    entries.includes("requirements.txt") ||
    entries.includes("setup.py") ||
    entries.includes("pyproject.toml")
  ) {
    baseImage = "python:3.11";
    buildSteps.push("pip install -r requirements.txt");
  } else if (entries.includes("Cargo.toml")) {
    baseImage = "rust:1.75";
    buildSteps.push("cargo build");
  } else if (entries.includes("go.mod")) {
    baseImage = "golang:1.22";
    buildSteps.push("go mod download");
  }

  // Build the container
  let container = dag.container().from(baseImage);

  // Install git (always needed)
  container = container.withExec([
    "sh",
    "-c",
    "apt-get update && apt-get install -y git",
  ]);

  // Mount npm cache if node project
  if (baseImage.startsWith("node:")) {
    container = container.withMountedCache(
      "/root/.npm",
      dag.cacheVolume("bridge-npm-cache"),
    );
  }

  // Copy repo to /workspace
  container = container
    .withDirectory("/workspace", repo)
    .withWorkdir("/workspace");

  // Run build steps
  for (const step of buildSteps) {
    container = container.withExec(["sh", "-c", step]);
  }

  // Apply fixed layers (Go binary, secrets, port, entrypoint)
  const hostBinary = dag.host().file(goBinaryPath);
  container = container
    .withExec(["mkdir", "-p", "/opt/bridge"])
    .withFile("/opt/bridge/bridge-server", hostBinary, { permissions: 0o755 });

  if (secrets.length > 0) {
    for (const secret of secrets) {
      const secretVal = dag.setSecret(secret.name, secret.value);
      container = container.withSecretVariable(secret.name, secretVal);
    }
  }

  container = container
    .withExposedPort(port)
    .withEntrypoint(["/opt/bridge/bridge-server", "--port", String(port)]);

  const provisioning: SavedProvisioning = {
    baseImage,
    buildSteps,
    envVarNames: secrets.map((s) => s.name),
    reasoning: `Fallback build: detected ${baseImage} from repo file markers`,
    analyzedAt: new Date().toISOString(),
  };

  return { container, provisioning };
}

/**
 * Build a container from a repo URL. Tries dag.llm() first, falls back to heuristics.
 */
export async function buildContainerFromRepo(
  options: ContainerBuilderOptions,
): Promise<ContainerBuildResult> {
  const repo = dag.git(options.repoUrl).head().tree();

  try {
    return await buildContainerWithLLM(repo, options);
  } catch (err: any) {
    console.warn(
      `[container-builder] dag.llm() failed: ${err.message}. Falling back to heuristic build.`,
    );
    return await buildContainerWithFallback(repo, options);
  }
}
