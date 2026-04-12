#!/usr/bin/env npx tsx
/**
 * Spike 05: Test dag.llm() with a minimal repo to isolate LLM behavior.
 *
 * Instead of a complex repo with many scripts, this creates a tiny
 * in-memory directory to verify dag.llm() can configure a container
 * at all. This is the simplest possible test of the LLM container builder.
 *
 * Usage: npx tsx src/habitat/bridge/spikes/05-llm-simple-repo.ts
 */

import { dag, connection } from "@dagger.io/dagger";

console.log(`\n=== Spike 05: LLM with Simple Repo ===\n`);

await connection(async () => {
  // Create a minimal in-memory directory with one script
  console.log("1. Creating minimal test repo...");
  const repo = dag
    .directory()
    .withNewFile(
      "hello.sh",
      '#!/bin/bash\necho "Hello from container"\ncurl -s https://example.com > /dev/null && echo "curl works"\n',
    )
    .withNewFile("README.md", "# Test Project\n\nRequires: curl\n");

  const entries = await repo.entries();
  console.log(`   Files: ${entries.join(", ")}`);

  console.log("\n2. Setting up dag.llm() environment...");
  const env = dag
    .env()
    .withDirectoryInput(
      "repo",
      repo,
      "The project repository. List its entries, then read all scripts to find dependencies.",
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

  const prompt = `You are configuring a container to run a project.

STEP 1: List the files in $repo.
STEP 2: Read hello.sh to find what tools it needs.
STEP 3: Read README.md for additional requirements.
STEP 4: Configure $builder:
  - Run "apt-get update && apt-get install -y curl" (found in hello.sh)
  - Copy $repo into /workspace using withDirectory
  - Set working directory to /workspace

CRITICAL: You MUST configure $builder. Do NOT just read files — you must also modify the container.
Do NOT set an entrypoint or expose ports.`;

  console.log("3. Running dag.llm()...");
  const startTime = Date.now();

  const work = dag.llm().withEnv(env).withPrompt(prompt);

  // This triggers the LLM work
  const container = work.env().output("result").asContainer();
  const reply = await work.lastReply();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   LLM completed in ${elapsed}s`);
  console.log(`   Reply: ${(reply || "").slice(0, 200)}`);

  console.log("\n4. Validating container...");
  const output = await container
    .withExec([
      "sh",
      "-c",
      "echo '=== files ===' && ls /workspace/ && echo '=== curl ===' && which curl && echo 'curl: OK'",
    ])
    .stdout();
  console.log(output);

  console.log(`✅ dag.llm() works with simple repo! (${elapsed}s)\n`);
});
