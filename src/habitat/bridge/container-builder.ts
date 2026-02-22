/**
 * LLM-driven container builder using Dagger's dag.llm() with privileged env.
 *
 * The LLM reads the repo, picks a base image, installs deps, and produces
 * a container. We then add our fixed layers (Go binary, secrets, port, entrypoint).
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

const SYSTEM_PROMPT = `You are a container configuration expert. Your job is to read a project repository and build a working container for it.

Rules:
- Read the repo files to understand the project type
- Pick the most appropriate base image (e.g. node:20, python:3.11, ubuntu:22.04, rust:1.75, golang:1.22)
- Always install git via apt-get
- Install all project dependencies (npm install, pip install, cargo build, etc.)
- Set the working directory to /workspace
- Copy the repo contents to /workspace
- Do NOT configure any entrypoint or exposed ports — that will be done separately after you finish
- Do NOT start or run the project — just install dependencies so it's ready to run`;

function buildPrompt(previousProvisioning?: SavedProvisioning): string {
  let prompt =
    "Build a container for the project in the 'repo' directory input. Read the top-level files first (package.json, requirements.txt, Cargo.toml, go.mod, etc.) to understand the project type, then pick a base image and install all dependencies. Copy the repo to /workspace and set it as the working directory.";

  if (previousProvisioning) {
    prompt += `\n\nHint: A previous build used base image "${previousProvisioning.baseImage}" with these build steps: ${JSON.stringify(previousProvisioning.buildSteps)}. You may use this as a starting point or choose differently based on what you see in the repo.`;
  }

  return prompt;
}

/**
 * Build a container from a git repo using dag.llm() with privileged env.
 *
 * The LLM reads the repo, picks a base image, installs deps.
 * We then add our fixed layers: Go binary, secrets, port, entrypoint.
 */
export async function buildContainerWithLLM(
  repo: Directory,
  options: ContainerBuilderOptions,
): Promise<ContainerBuildResult> {
  const { secrets, port, goBinaryPath, previousProvisioning } = options;

  // Create privileged env with repo as input, Container as output
  const env = dag
    .env({ privileged: true })
    .withDirectoryInput(
      "repo",
      repo,
      "The project repository to containerize. Read its files to determine project type and dependencies.",
    )
    .withContainerOutput(
      "result",
      "The configured container with the correct base image, all dependencies installed, repo copied to /workspace, and working directory set to /workspace.",
    );

  // Run the LLM loop
  let llm = dag
    .llm()
    .withEnv(env)
    .withSystemPrompt(SYSTEM_PROMPT)
    .withPrompt(buildPrompt(previousProvisioning))
    .loop();

  // Extract the container from the env output
  const resultBinding = llm.env().output("result");
  let container = resultBinding.asContainer();

  // Get the LLM's reasoning for logging/saving
  const reply = await llm.lastReply();

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
    baseImage: "llm-selected", // We don't know the exact image, but it's in the reply
    buildSteps: ["LLM-built container via dag.llm()"],
    envVarNames: secrets.map((s) => s.name),
    reasoning: reply.slice(0, 1000),
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
