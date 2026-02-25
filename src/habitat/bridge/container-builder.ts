/**
 * LLM-driven container builder using Dagger's dag.llm() with env.
 *
 * The LLM reads the repo, configures a base container (install deps, copy repo),
 * and produces a container. We then add our fixed layers (Go binary, secrets, port, entrypoint).
 *
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

STEP 2: Read ALL shell scripts (.sh files at top level) AND list+read ALL files in bin/ directory.
  For every script you read, note which command-line tools it calls. Examples:
  - curl, wget → install curl or wget
  - jq → install jq
  - magick, convert → install imagemagick
  - python3, python → install python3
  - node, npx, npm → install nodejs npm
  - claude → install Claude CLI via: curl -fsSL https://claude.ai/install.sh | sh
  - bc → install bc
  - chromium, chromium-browser, google-chrome → install chromium-browser
  You MUST read the scripts — do not guess what tools are needed.

STEP 3: Read README.md and CLAUDE.md (if they exist) for additional tool requirements.
  Pay attention to "Prerequisites", "Requirements", "Install" sections.

STEP 4: Also check for standard project markers:
  - package.json → Node.js project: install nodejs npm, run "npm install" in /workspace
  - requirements.txt or pyproject.toml or setup.py → Python project: install python3 python3-pip
  - Cargo.toml → Rust project
  - go.mod → Go project

STEP 5: Configure $builder with EVERYTHING the project needs:
  - Run "apt-get update" first
  - Install git via apt-get (always needed)
  - Install ALL tools you discovered from reading scripts in steps 2-4
  - If Claude CLI is needed: run "curl -fsSL https://claude.ai/install.sh | sh"
  - If npx is needed but no package.json exists: install nodejs npm via apt-get
  - Copy $repo into /workspace using withDirectory
  - Set working directory to /workspace

CRITICAL RULES:
- You MUST read the actual script files to find what tools they use. Do NOT guess.
- Install a tool ONLY if you found it referenced in a script or documentation file.
- Do NOT configure an entrypoint or expose ports.
- Do NOT run the project — just install dependencies.`;

  if (
    previousProvisioning?.reasoning &&
    previousProvisioning.reasoning !== "" &&
    !previousProvisioning.reasoning.startsWith("Fallback build:")
  ) {
    prompt += `\n\nIMPORTANT — A previous successful build installed these tools. Use this as a strong starting point and install AT LEAST these same packages:\n${previousProvisioning.reasoning.slice(0, 500)}`;
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
      "The project repository. List its entries first, then read ALL scripts (.sh files and bin/ directory) to find tool dependencies.",
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
 * Build a container from a repo URL using dag.llm().
 */
export async function buildContainerFromRepo(
  options: ContainerBuilderOptions,
): Promise<ContainerBuildResult> {
  const repo = dag.git(options.repoUrl).head().tree();
  return await buildContainerWithLLM(repo, options);
}
