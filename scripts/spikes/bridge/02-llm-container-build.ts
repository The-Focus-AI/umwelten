#!/usr/bin/env npx tsx
/**
 * Spike 02: Simplest possible dag.llm() container build.
 *
 * Usage: npx tsx src/habitat/bridge/spikes/02-llm-container-build.ts
 */

import { dag, connection } from "@dagger.io/dagger";

const logStep = (message: string) => {
  console.log(`[02-llm-container-build] ${message}`);
};

function withClaudeAuthEnv(
  container: ReturnType<typeof dag.container>,
): ReturnType<typeof dag.container> {
  let next = container;
  const authEnvNames = [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_API_KEY",
  ] as const;

  for (const envName of authEnvNames) {
    const value = process.env[envName];
    if (value && value.trim() !== "") {
      logStep(`Forwarding ${envName} into container as secret.`);
      next = next.withSecretVariable(envName, dag.setSecret(envName, value));
    }
  }

  return next;
}

// Force line-by-line Dagger progress output in terminals where the default
// renderer may not stream visibly.
process.env.DAGGER_PROGRESS ??= "plain";

try {
  await connection(
    async () => {
      logStep("Starting spike.");
      let container = dag
        .container()
        .from("node:lts")
        .withExec([
          "sh",
          "-lc",
          "node --version && npm --version",
        ]);
      container = withClaudeAuthEnv(container);

      logStep("Creating LLM environment with builder input and result output.");
      const env = dag
        .env()
        .withContainerInput(
          "builder",
          container,
          "The base container to configure. Keep node:lts and do not use apt-get.",
        )
        .withContainerOutput("result", "The configured container.");

      const prompt = [
        "Install Claude CLI in the builder container.",
        "Do NOT use ubuntu and do NOT run apt-get.",
        "Use this flow:",
        "- fetch install script using Node's fetch API and write /tmp/install-claude.sh",
        "- run: bash /tmp/install-claude.sh",
        "- if Claude is installed to ~/.local/bin/claude, make it available on PATH (e.g. symlink to /usr/local/bin/claude)",
        "Return the configured container in result.",
      ].join("\n");

      const work = dag.llm().withEnv(env).withPrompt(prompt);
      logStep("Fetching model reply.");
      const reply = await work.lastReply();
      console.log("[02-llm-container-build] Reply:", reply || "(no reply)");
      container = work.env().output("result").asContainer();

      logStep("Verifying node and executing claude.");
      const output = await container
        .withExec([
          "sh",
          "-c",
          "echo '=== node ===' && (node --version || echo 'node: MISSING') && echo '=== claude version ===' && (claude --version || /root/.local/bin/claude --version || /home/node/.local/bin/claude --version || echo 'claude: MISSING') && echo '=== claude current type ===' && (claude -p \"Reply with your current model/type in one short line.\" || /root/.local/bin/claude -p \"Reply with your current model/type in one short line.\" || /home/node/.local/bin/claude -p \"Reply with your current model/type in one short line.\" || echo 'claude prompt failed') && echo '=== claude date ===' && (claude -p \"What is today's date? Reply with just YYYY-MM-DD.\" || /root/.local/bin/claude -p \"What is today's date? Reply with just YYYY-MM-DD.\" || /home/node/.local/bin/claude -p \"What is today's date? Reply with just YYYY-MM-DD.\" || echo 'claude date failed') && echo '=== done ==='",
        ])
        .stdout();
      console.log("[02-llm-container-build] Output:", output);

      const isAuthenticated =
        !output.includes("Not logged in") && !output.includes("claude prompt failed");
      if (!isAuthenticated) {
        throw new Error(
          "Claude CLI is installed but not authenticated in container. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in host env before running.",
        );
      }

      logStep("Spike complete.");
    },
    { LogOutput: process.stderr },
  );
} catch (error) {
  logStep(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
