/**
 * Spike: Iterate on dag.llm() container builder prompt.
 *
 * Run with: dotenvx run -- npx tsx scripts/spike-dagger-llm.ts [repo-url]
 *
 * Default repo: https://github.com/The-Focus-AI/trmnl-image-agent
 * (shell scripts + imagemagick project — no python, no node)
 */

import { dag, connection } from "@dagger.io/dagger";

const REPO_URL =
  process.argv[2] || "https://github.com/The-Focus-AI/trmnl-image-agent";

/**
 * The prompt we send to the Dagger LLM.
 *
 * Key requirements:
 * 1. MUST list top-level files first before deciding project type
 * 2. MUST read key files (README, setup scripts) to understand actual deps
 * 3. Must NOT guess project type from a single filename
 * 4. Shell-script projects should stay as ubuntu + apt packages, NOT get python/node
 */
const BUILDER_PROMPT = `You are configuring a container to run a project.

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

async function main() {
  console.log("=== Dagger LLM Container Builder Spike ===");
  console.log(`Repo: ${REPO_URL}`);
  console.log(`Prompt length: ${BUILDER_PROMPT.length} chars`);
  console.log();

  const startTime = Date.now();

  await connection(
    async () => {
      // Get the repo as a Directory
      console.log("1. Fetching repo...");
      const repo = dag.git(REPO_URL).head().tree();

      // List top-level files to verify the repo is accessible
      const entries = await repo.entries();
      console.log(
        `   Repo has ${entries.length} entries: ${entries.join(", ")}`,
      );

      // Create env
      console.log("2. Creating environment...");
      const environment = dag
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

      // Create LLM with the env
      console.log("3. Creating LLM with environment...");
      const work = dag.llm().withEnv(environment).withPrompt(BUILDER_PROMPT);

      // Extract the container from the env output — this triggers the loop implicitly
      console.log("4. Extracting container (this triggers the LLM work)...");
      try {
        const container = work.env().output("result").asContainer();

        // Validate the container works
        console.log("5. Validating container...");
        const testOutput = await container
          .withExec(["sh", "-c", "ls /workspace/ | head -10"])
          .stdout();
        console.log("   /workspace contents:");
        console.log(`   ${testOutput.trim()}`);

        // Check what's installed — this is the key test
        const checks = await container
          .withExec([
            "sh",
            "-c",
            [
              'echo "--- Checking installed tools ---"',
              'which python3 2>/dev/null && echo "FAIL: python3 installed (should NOT be for shell project)" || echo "OK: no python3"',
              'which node 2>/dev/null && echo "FAIL: node installed (should NOT be for shell project)" || echo "OK: no node"',
              'which git 2>/dev/null && echo "OK: git installed" || echo "FAIL: no git"',
              'which convert 2>/dev/null && echo "OK: imagemagick installed" || echo "NOTE: no imagemagick"',
              'which curl 2>/dev/null && echo "OK: curl installed" || echo "NOTE: no curl"',
              'which jq 2>/dev/null && echo "OK: jq installed" || echo "NOTE: no jq"',
            ].join(" && "),
          ])
          .stdout();
        console.log(checks.trim());

        // Get the LLM's reply for logging
        const reply = await work.lastReply();
        console.log("\n6. LLM reply:");
        console.log(reply || "(no reply)");

        console.log("\n=== SUCCESS: Container built via dag.llm()! ===");
      } catch (err: any) {
        console.error("Failed to extract/validate container:", err.message);

        // Try to get the LLM reply for debugging
        try {
          const reply = await work.lastReply();
          console.log("LLM reply (for debugging):", reply || "(no reply)");
        } catch {
          // ignore
        }

        console.log("\n=== FAILED: dag.llm() couldn't produce a container ===");
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\nTotal time: ${elapsed}s`);
    },
    { LogOutput: process.stderr },
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
