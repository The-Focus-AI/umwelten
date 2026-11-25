#!/usr/bin/env node
/**
 * End-to-End Multi-A2A Pi Verification Script.
 *
 * Boots two independent A2A 1.0 `DurableHabitat` servers on loopback ports
 * (with separate bearer tokens), writes an isolated temporary `agents.json`,
 * verifies endpoint discovery + fail-closed 401 auth, and drives both agents
 * through the real `pi` CLI using `@leocavalcante/pi-a2a/extension`.
 *
 * Run:
 *   pnpm run demo:multi-a2a
 *   pnpm run demo:multi-a2a -- --interactive
 *   pnpm run demo:multi-a2a -- --live --model google:gemini-4-hydrogen
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { DurableHabitat } from "@umwelten/habitat";
import {
  parseModelSpecString,
  resolvePiModel,
  type ResolvedPiInvocationTarget,
} from "@umwelten/pi";
import { discoverAgentEndpoint } from "@umwelten/protocols";

interface RunningAgentServer {
  id: string;
  url: string;
  token: string;
  habitat: DurableHabitat;
  server: Server;
  close: () => Promise<void>;
}

interface PiA2ADetails {
  ok: boolean;
  agent?: string;
  agents?: string[];
  messageId?: string;
  taskId?: string;
  contextId?: string;
  state?: string;
  text?: string;
  error?: { code?: string; message?: string };
}

interface PiJsonEvent {
  type?: string;
  message?: {
    customType?: string;
    details?: PiA2ADetails;
  };
}

function extractLastUserPrompt(ctx: TranscriptContext): string {
  for (let i = ctx.messages.length - 1; i >= 0; i--) {
    const msg = ctx.messages[i];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      const texts: string[] = [];
      for (const block of msg.content) {
        if (
          typeof block === "object" &&
          block !== null &&
          block.type === "text" &&
          typeof block.text === "string"
        ) {
          texts.push(block.text);
        }
      }
      if (texts.length > 0) return texts.join("\n");
    }
  }
  return "";
}

function createScriptedTarget(
  agentLabel: string,
  roleHint: string,
): ResolvedPiInvocationTarget {
  const modelId = `${agentLabel}-v1`;
  const faux = fauxProvider({ provider: "faux", models: [{ id: modelId }] });
  const step = (ctx: TranscriptContext) => {
    faux.appendResponses([step]);
    const prompt = extractLastUserPrompt(ctx).replace(/\s+/g, " ").trim();
    const preview = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
    return fauxAssistantMessage(
      `[${agentLabel}] ${roleHint} — handled request: "${preview}"`,
    );
  };
  faux.setResponses([step]);
  const models = createModels();
  models.setProvider(faux.provider);
  const piModel = models.getModel("faux", modelId);
  if (!piModel) {
    throw new Error(`Failed to register scripted faux model ${modelId}`);
  }
  return { models, piModel };
}

async function startA2AAgentServer(opts: {
  id: string;
  name: string;
  description: string;
  instructions: string;
  roleHint: string;
  baseWorkDir: string;
  token: string;
  liveTarget?: ResolvedPiInvocationTarget;
}): Promise<RunningAgentServer> {
  const target = opts.liveTarget ?? createScriptedTarget(opts.id, opts.roleHint);
  const workDir = join(opts.baseWorkDir, opts.id);
  await mkdir(workDir, { recursive: true });

  const habitat = await DurableHabitat.open({
    id: opts.id,
    name: opts.name,
    description: opts.description,
    instructions: opts.instructions,
    workDir,
    models: target.models,
    model: { provider: target.piModel.provider, modelId: target.piModel.id },
  });

  let httpHandler:
    | ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>)
    | undefined;

  const server = createServer((req, res) => {
    if (!httpHandler) {
      res.writeHead(503).end("Initializing");
      return;
    }
    void httpHandler(req, res).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404).end("Not found");
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  if (!port) {
    server.close();
    await habitat.close();
    throw new Error(`Failed to bind loopback port for ${opts.id}`);
  }

  const url = `http://127.0.0.1:${port}`;
  const surface = habitat.createA2ASurface({
    endpointUrl: `${url}/a2a`,
    bearerToken: opts.token,
  });
  httpHandler = surface.httpHandler;

  return {
    id: opts.id,
    url,
    token: opts.token,
    habitat,
    server,
    async close() {
      server.closeIdleConnections?.();
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
      await habitat.close();
    },
  };
}

function assertPiInstalled(): string {
  const res = spawnSync("pi", ["--version"], { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    throw new Error(
      `The \`pi\` CLI was not found on PATH.\n` +
        `Install it on a clean machine with:\n` +
        `  pnpm add -g @earendil-works/pi-coding-agent\n` +
        `or run:\n` +
        `  ./examples/multi-a2a/clean-machine.sh`,
    );
  }
  return res.stdout.trim();
}

async function spawnProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolveProc, rejectProc) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      rejectProc(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectProc(
          new Error(
            `Process timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      resolveProc({ status: code ?? 1, stdout, stderr });
    });
  });
}

async function runPiA2aCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  extPath: string,
): Promise<PiA2ADetails> {
  const res = await spawnProcess(
    "pi",
    [
      "-p",
      "--mode",
      "json",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-mcp",
      "--offline",
      "-e",
      extPath,
      command,
    ],
    env,
    60_000,
  );

  let found: PiA2ADetails | undefined;
  for (const rawLine of res.stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    try {
      const ev = JSON.parse(line) as PiJsonEvent;
      if (
        ev.type === "message_end" &&
        ev.message?.customType === "pi-a2a" &&
        ev.message.details
      ) {
        found = ev.message.details;
      }
    } catch {
      // Ignore non-JSON lines if any
    }
  }

  if (!found || res.status !== 0) {
    throw new Error(
      `Pi command failed (${command}) with exit=${res.status}.\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
    );
  }
  return found;
}

function printUsage(): void {
  console.log(`Usage: pnpm run demo:multi-a2a [-- [options]]

Starts two isolated A2A 1.0 DurableHabitat servers (researcher + reviewer),
verifies endpoint discovery + 401 auth fail-closed checks, and drives both
agents from the Pi CLI using @leocavalcante/pi-a2a.

Options:
  --interactive     Keep both A2A agents running and open an interactive Pi TUI
  --live            Back both agents with a real LLM and run a multi-agent Pi turn
  --model <spec>    Model spec for --live backend agents (default: google:gemini-4-hydrogen)
  --help, -h        Show this help message`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      interactive: { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      model: { type: "string", default: "google:gemini-4-hydrogen" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printUsage();
    return;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..");
  const req = createRequire(join(repoRoot, "packages", "protocols", "package.json"));
  const extPath = req.resolve("@leocavalcante/pi-a2a/extension");
  assert.ok(existsSync(extPath), `Extension entry not found at ${extPath}`);

  const piVersion = assertPiInstalled();
  const modeLabel = values.live ? `live (${values.model})` : "offline mock (fauxProvider)";
  console.log(`=== Multi-A2A Pi E2E Verification (${modeLabel}) ===`);
  console.log(`Pi CLI version: ${piVersion}`);
  console.log(`A2A Extension: ${extPath}`);

  let liveTarget: ResolvedPiInvocationTarget | undefined;
  if (values.live) {
    liveTarget = await resolvePiModel(parseModelSpecString(values.model));
  }

  const tmpRoot = await mkdtemp(join(tmpdir(), "umwelten-multi-a2a-"));
  const tokenA = randomBytes(16).toString("hex");
  const tokenB = randomBytes(16).toString("hex");

  let researcherServer: RunningAgentServer | undefined;
  let reviewerServer: RunningAgentServer | undefined;

  try {
    researcherServer = await startA2AAgentServer({
      id: "researcher",
      name: "Researcher Agent",
      description: "Investigates technical tradeoffs and summarizes findings.",
      instructions:
        "You are a concise architecture researcher. Answer technical questions in 2-3 tight bullets.",
      roleHint: "Analyzes architecture tradeoffs and risks",
      baseWorkDir: tmpRoot,
      token: tokenA,
      liveTarget,
    });

    reviewerServer = await startA2AAgentServer({
      id: "reviewer",
      name: "Security Reviewer Agent",
      description: "Audits proposals for security, auth, and operational risks.",
      instructions:
        "You are a concise security reviewer. Flag auth, credential, and blast-radius risks in 2-3 tight bullets.",
      roleHint: "Audits auth boundaries and failure modes",
      baseWorkDir: tmpRoot,
      token: tokenB,
      liveTarget,
    });

    console.log(`\n1. Started two isolated A2A 1.0 DurableHabitat servers:`);
    console.log(`   - researcher -> ${researcherServer.url}`);
    console.log(`   - reviewer   -> ${reviewerServer.url}`);

    const cardA = await discoverAgentEndpoint(researcherServer.url, {
      bearerToken: tokenA,
    });
    const cardB = await discoverAgentEndpoint(reviewerServer.url, {
      bearerToken: tokenB,
    });
    assert.ok(cardA && cardA.kind === "a2a", "Expected A2A card for researcher");
    assert.ok(cardB && cardB.kind === "a2a", "Expected A2A card for reviewer");
    assert.equal(cardA.streaming, true, "researcher should advertise streaming");
    assert.equal(cardB.streaming, true, "reviewer should advertise streaming");
    assert.equal(cardA.auth, "bearer", "researcher should advertise bearer auth");
    assert.equal(cardB.auth, "bearer", "reviewer should advertise bearer auth");

    const unauthRes = await fetch(`${researcherServer.url}/a2a`, {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "1.0" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "unauth-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "unauth-msg-1",
            role: "ROLE_USER",
            parts: [{ text: "Unauthorized ping" }],
          },
        },
      }),
    });
    assert.equal(
      unauthRes.status,
      401,
      `Expected 401 fail-closed without bearer token, got ${unauthRes.status}`,
    );
    console.log(`2. Verified Agent Card discovery + fail-closed 401 auth.`);

    const configPath = join(tmpRoot, "agents.json");
    const agentsConfig = {
      agents: {
        researcher: {
          url: researcherServer.url,
          allowHttpLoopback: true,
          bearerTokenEnv: "RESEARCHER_A2A_TOKEN",
        },
        reviewer: {
          url: reviewerServer.url,
          allowHttpLoopback: true,
          bearerTokenEnv: "REVIEWER_A2A_TOKEN",
        },
      },
    };
    await writeFile(configPath, `${JSON.stringify(agentsConfig, null, 2)}\n`, "utf8");
    console.log(`3. Wrote isolated A2A config: ${configPath}`);

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PI_A2A_CONFIG: configPath,
      RESEARCHER_A2A_TOKEN: tokenA,
      REVIEWER_A2A_TOKEN: tokenB,
    };

    if (values.interactive) {
      console.log("\nLaunching interactive Pi session with both agents connected.");
      console.log("Try inside Pi:");
      console.log("  /a2a list");
      console.log("  /a2a send researcher List two architectural tradeoffs of a shared cache.");
      console.log("  /a2a send reviewer Audit a shared cache for token leaks.");
      console.log('  Or prompt the model: "Ask researcher and reviewer to review Redis vs SQLite, then synthesize."');
      const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
        const child = spawn("pi", ["--no-session", "--no-extensions", "-e", extPath], {
          env: childEnv,
          stdio: "inherit",
        });
        child.once("error", rejectExit);
        child.once("exit", (code) => resolveExit(code ?? 0));
      });
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
      return;
    }

    console.log("\n4. Driving both A2A agents via real `pi` CLI:");

    const listReply = await runPiA2aCommand("/a2a list", childEnv, extPath);
    assert.equal(listReply.ok, true, "Expected /a2a list ok=true");
    assert.deepEqual(
      [...(listReply.agents ?? [])].sort(),
      ["researcher", "reviewer"],
      "Expected both researcher and reviewer in /a2a list",
    );
    console.log(`   - PASS /a2a list -> ${JSON.stringify(listReply.agents)}`);

    const sendResearcher = await runPiA2aCommand(
      "/a2a send researcher List two architectural risks of a shared cache.",
      childEnv,
      extPath,
    );
    assert.equal(sendResearcher.ok, true, "Expected researcher send ok=true");
    assert.ok(
      sendResearcher.state?.includes("COMPLETED"),
      `Expected COMPLETED state for researcher, got ${sendResearcher.state}`,
    );
    assert.ok(sendResearcher.taskId, "Expected researcher taskId");
    assert.ok(sendResearcher.contextId, "Expected researcher contextId");
    assert.ok(sendResearcher.text && sendResearcher.text.length > 0, "Expected non-empty researcher response");
    if (!values.live) {
      assert.ok(
        sendResearcher.text.includes("[researcher]"),
        `Expected scripted [researcher] marker, got: ${sendResearcher.text}`,
      );
    }
    console.log(`   - PASS /a2a send researcher -> ${sendResearcher.text}`);

    const sendReviewer = await runPiA2aCommand(
      "/a2a send reviewer Audit a shared cache for auth and token-leak risks.",
      childEnv,
      extPath,
    );
    assert.equal(sendReviewer.ok, true, "Expected reviewer send ok=true");
    assert.ok(
      sendReviewer.state?.includes("COMPLETED"),
      `Expected COMPLETED state for reviewer, got ${sendReviewer.state}`,
    );
    assert.ok(sendReviewer.taskId, "Expected reviewer taskId");
    assert.ok(sendReviewer.contextId, "Expected reviewer contextId");
    assert.ok(sendReviewer.text && sendReviewer.text.length > 0, "Expected non-empty reviewer response");
    if (!values.live) {
      assert.ok(
        sendReviewer.text.includes("[reviewer]"),
        `Expected scripted [reviewer] marker, got: ${sendReviewer.text}`,
      );
    }
    console.log(`   - PASS /a2a send reviewer   -> ${sendReviewer.text}`);

    const taskLookup = await runPiA2aCommand(
      `/a2a result researcher ${sendResearcher.taskId}`,
      childEnv,
      extPath,
    );
    assert.equal(taskLookup.ok, true, "Expected /a2a result researcher ok=true");
    assert.equal(taskLookup.taskId, sendResearcher.taskId, "Expected matching taskId");
    assert.ok(
      taskLookup.state?.includes("COMPLETED"),
      `Expected COMPLETED task lookup state, got ${taskLookup.state}`,
    );
    console.log(`   - PASS /a2a result researcher ${taskLookup.taskId} -> ${taskLookup.state}`);

    if (values.live) {
      console.log("\n5. Running LLM-orchestrated multi-agent turn via Pi model tools:");
      const llmRun = await spawnProcess(
        "pi",
        [
          "-p",
          "--no-session",
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--no-context-files",
          "--no-mcp",
          "--no-builtin-tools",
          "-e",
          extPath,
          "Use a2a_agents to list configured agents, call a2a_send on both researcher and reviewer, then summarize both responses in 3 bullets.",
        ],
        childEnv,
        120_000,
      );
      if (llmRun.status !== 0) {
        throw new Error(
          `LLM multi-agent turn failed (exit=${llmRun.status}):\n${llmRun.stdout}\n${llmRun.stderr}`,
        );
      }
      console.log(llmRun.stdout.trim());
    }

    console.log("\nALL MULTI-A2A PI CHECKS PASSED.");
  } finally {
    await Promise.allSettled([
      researcherServer ? researcherServer.close() : Promise.resolve(),
      reviewerServer ? reviewerServer.close() : Promise.resolve(),
    ]);
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("\nMulti-A2A E2E failed:", err);
  process.exit(1);
});
