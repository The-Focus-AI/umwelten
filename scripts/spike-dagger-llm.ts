/**
 * Spike: Prove dag.llm() with privileged env can read a repo and build a container.
 *
 * Run with: dotenvx run -- npx tsx scripts/spike-dagger-llm.ts
 *
 * What we want to learn:
 * 1. Does dag.env({ privileged: true }) expose container-building tools?
 * 2. Does .loop() let the LLM call those tools iteratively?
 * 3. Can we extract a usable Container from the env output?
 * 4. How long does it take?
 */

import { dag, connection } from "@dagger.io/dagger";

const REPO_URL = "https://github.com/anthropics/anthropic-cookbook.git";

const SYSTEM_PROMPT = `You are a container configuration expert. Your job is to read a project repository and build a working container for it.

Rules:
- Read the repo files to understand the project type (package.json = Node, requirements.txt = Python, Cargo.toml = Rust, go.mod = Go, etc.)
- Pick the most appropriate base image
- Install all dependencies
- Set the working directory to /workspace
- Copy the repo contents to /workspace
- Do NOT configure any entrypoint or exposed ports — that will be done separately
- Do NOT run the project — just install dependencies`;

const PROMPT = `Build a container for the project in the "repo" directory input. Read the top-level files first to understand what kind of project it is, then pick a base image and install dependencies. Copy the repo to /workspace.`;

async function main() {
  console.log("=== Dagger LLM Container Builder Spike ===");
  console.log(`Repo: ${REPO_URL}`);
  console.log();

  const startTime = Date.now();

  await connection(
    async () => {
      // Get the repo as a Directory
      console.log("1. Fetching repo...");
      const repo = dag.git(REPO_URL).branch("main").tree();

      // List top-level files to verify the repo is accessible
      const entries = await repo.entries();
      console.log(`   Repo has ${entries.length} entries: ${entries.slice(0, 10).join(", ")}...`);

      // Create privileged env with repo as input, Container as output
      console.log("2. Creating privileged environment...");
      const env = dag
        .env({ privileged: true })
        .withDirectoryInput("repo", repo, "The project repository to containerize")
        .withContainerOutput("result", "The configured container with dependencies installed and repo at /workspace");

      // Create LLM with the env
      console.log("3. Creating LLM with environment...");
      let llm = dag
        .llm()
        .withEnv(env)
        .withSystemPrompt(SYSTEM_PROMPT)
        .withPrompt(PROMPT);

      // Print available tools
      const tools = await llm.tools();
      console.log("4. Available tools:");
      console.log(tools.slice(0, 2000));
      console.log();

      // Run the loop
      console.log("5. Running LLM loop (this may take a while)...");
      llm = llm.loop();

      // Get the reply
      const reply = await llm.lastReply();
      console.log("6. LLM reply:");
      console.log(reply);
      console.log();

      // Try to extract the container output
      console.log("7. Extracting container from env output...");
      try {
        const resultEnv = llm.env();
        const resultBinding = resultEnv.output("result");
        const container = resultBinding.asContainer();

        // Validate the container works
        console.log("8. Validating container...");
        const testOutput = await container
          .withExec(["ls", "-la", "/workspace"])
          .stdout();
        console.log("   /workspace contents:");
        console.log(testOutput);

        // Check what's installed
        const whichNode = await container
          .withExec(["sh", "-c", "which node 2>/dev/null || which python3 2>/dev/null || which cargo 2>/dev/null || echo 'no runtime found'"])
          .stdout();
        console.log(`   Runtime: ${whichNode.trim()}`);

        console.log("\n=== SUCCESS: Container built via dag.llm()! ===");
      } catch (err: any) {
        console.error("Failed to extract container:", err.message);
        console.log("\n=== FALLBACK NEEDED: dag.llm() couldn't produce a container ===");
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
