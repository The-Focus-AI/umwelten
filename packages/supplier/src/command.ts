/**
 * `umwelten supplier` — turn this machine into a Supplier.
 *
 * A CLI command rather than a separately installed binary: someone who already
 * has umwelten runs a command they already have, which is the difference
 * between onboarding hardware being a task and it being a decision.
 *
 * This package deliberately does **not** depend on `@umwelten/mycel`. It
 * talks to a running Exchange over HTTP, which keeps a database driver out of
 * every umwelten install for a command that never opens a database.
 */

import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { findLlamaSwapModels, type GgufModel } from "@umwelten/core/providers/llamaswap-config.js";
import { estimateCandidates } from "./candidates.js";
import { detectMachineResources } from "./candidates-node.js";
import { discoverRuntimes } from "./discover.js";
import { probeOffer } from "./probe.js";
import { findDuplicateModels, probeTargets, toOfferDrafts } from "./offers.js";
import { ExchangeClient } from "./exchange-client.js";
import { ManagedModeError, planManagedRuntime, verifyConcurrency } from "./managed.js";
import { ManagedRuntime, RuntimeStartError } from "./runtime.js";
import { HEADROOM_POLICY } from "./headroom.js";
import { defaultServiceKind, renderService, type ServiceKind } from "./service.js";
import { OfferSupervisor } from "./supervisor.js";
import { runServeLoop, type ServeEffects } from "./serve.js";
import { dialIn } from "./dial.js";
import { fingerprint, reprobeReason, type ProbeInputs } from "./fingerprint.js";
import {
  STATE_VERSION,
  clearRuntimePid,
  loadConfig,
  loadCredential,
  loadState,
  reapOrphanedRuntime,
  recordRuntimePid,
  saveConfig,
  saveCredential,
  saveState,
  supplierDir,
} from "./state.js";
import type {
  MachineState,
  ManagedOptions,
  ProbedOffer,
  ServingMode,
  SupplierConfig,
} from "./types.js";

interface CliOptions {
  mycel?: string;
  credential?: string;
  guarantees?: string;
  mode?: string;
  provider?: string;
  model?: string;
  concurrency?: string;
  noHeadroom?: boolean;
  // Managed mode
  serve?: string;
  ctxSize?: string;
  quant?: string;
  parallel?: string;
  port?: string;
  config?: string;
  binary?: string;
  // serve
  resume?: boolean;
  reprobeInterval?: string;
  healthInterval?: string;
  kind?: string;
  user?: string;
  // dial
  runtime?: string;
  runtimeKey?: string;
}

/**
 * The agent's own version, as a re-probe trigger.
 *
 * Bumped when a change to this package could plausibly change what a Model
 * appears able to do — a provider flag, a probe prompt, a parsing rule. That
 * has already happened twice: `supportsStructuredOutputs` and Ollama's `think`
 * parameter both changed probe results without any weights moving.
 */
const AGENT_VERSION = "1";

/**
 * The port the agent's own runtime listens on.
 *
 * Below 7440, where Gaia starts handing out ports to managed containers, and
 * clear of Mycel's 7438,
 * so an operator can run the Exchange and a supplier agent on one box.
 */
const DEFAULT_MANAGED_PORT = 7439;
const DEFAULT_MANAGED_CONFIG = path.join(os.homedir(), ".umwelten", "supplier", "llama-swap.yaml");

function resolveMode(opts: CliOptions): ServingMode {
  const mode = (opts.mode ?? "adapted") as ServingMode;
  if (mode !== "managed" && mode !== "adapted") {
    throw new Error(`Unknown serving mode "${mode}". Expected managed or adapted.`);
  }
  return mode;
}

/**
 * Managed mode's pins. Every one of them is a commitment the Offer then makes,
 * which is why none of them fall back to "whatever the machine was doing".
 */
function resolveManaged(opts: CliOptions): ManagedOptions | undefined {
  if (resolveMode(opts) !== "managed") return undefined;

  return {
    models: (opts.serve ?? "").split(",").map((m) => m.trim()).filter(Boolean),
    contextTokens: Number(opts.ctxSize ?? 32768),
    quantization: opts.quant,
    parallel: Number(opts.parallel ?? 4),
    port: Number(opts.port ?? DEFAULT_MANAGED_PORT),
    configPath: opts.config ?? DEFAULT_MANAGED_CONFIG,
    binaryPath: opts.binary,
  };
}

function resolveConfig(opts: CliOptions): SupplierConfig {
  const exchangeUrl = opts.mycel ?? process.env.MYCEL_URL;
  const credential = opts.credential ?? process.env.SUPPLIER_CREDENTIAL;
  if (!exchangeUrl) throw new Error("No Mycel URL. Pass --mycel or set MYCEL_URL.");
  if (!credential) {
    throw new Error("No credential. Pass --credential or set SUPPLIER_CREDENTIAL.");
  }

  return {
    exchangeUrl,
    credential,
    guarantees: (opts.guarantees ?? "").split(",").map((g) => g.trim()).filter(Boolean),
    servingMode: resolveMode(opts),
    providers: opts.provider?.split(",").map((p) => p.trim()).filter(Boolean),
    modelFilter: opts.model,
    managed: resolveManaged(opts),
  };
}

/**
 * Decide what to serve when the operator did not say.
 *
 * The estimate never overrides an explicit list — it is not confident enough to
 * earn a veto, and someone who knows their machine better than this arithmetic
 * does should not have to argue with it.
 */
function resolveServeList(
  managed: ManagedOptions,
  weights: GgufModel[],
  onProgress: (line: string) => void,
): ManagedOptions {
  const set = estimateCandidates({
    resources: detectMachineResources(),
    weights,
    contextTokens: managed.contextTokens,
    explicit: managed.models,
  });

  if (set.source === "operator") return managed;

  const { accelerator } = set.resources;
  onProgress(`${accelerator.name} — ${accelerator.evidence}`);
  for (const c of set.candidates) {
    onProgress(
      `  candidate ${c.alias.padEnd(34)} ${c.quantization.padEnd(8)} ~${c.estimatedParamsB}B`,
    );
  }
  // Shown, not hidden: an operator surprised by a missing Model needs the
  // arithmetic that dropped it, not a shorter list.
  for (const e of set.excluded) onProgress(`  excluded  ${e.alias.padEnd(34)} ${e.reason}`);

  return { ...managed, models: set.candidates.map((c) => c.alias) };
}

/**
 * Rebuild the configuration from disk, so a reboot needs nobody at the keyboard.
 *
 * Flags still win where given — resuming should not make a machine impossible
 * to redirect at a different Exchange without deleting a file.
 */
function resumeConfig(opts: CliOptions): SupplierConfig {
  const saved = loadConfig();
  if (!saved) {
    throw new Error(
      `Nothing to resume: no saved configuration in ${supplierDir()}. ` +
        "Run serve once with --mycel and --credential.",
    );
  }
  const credential = opts.credential ?? loadCredential();
  if (!credential) {
    throw new Error(`Nothing to resume with: no credential in ${supplierDir()}.`);
  }
  return {
    exchangeUrl: opts.mycel ?? saved.exchangeUrl,
    credential,
    guarantees: saved.guarantees,
    servingMode: saved.servingMode,
    providers: saved.providers,
    modelFilter: saved.modelFilter,
    managed: saved.managed,
  };
}

/** Write what a restart needs. The credential goes in its own 0600 file. */
function persistForRestart(config: SupplierConfig): void {
  saveConfig({
    exchangeUrl: config.exchangeUrl,
    guarantees: config.guarantees,
    servingMode: config.servingMode,
    providers: config.providers,
    modelFilter: config.modelFilter,
    managed: config.managed,
  });
  saveCredential(config.credential);
}

/** Everything a probe result depends on that we can observe cheaply. */
function probeInputsFor(config: SupplierConfig, runtime?: ManagedRuntime): ProbeInputs {
  return {
    // Our own version, first-class. It is the layer nobody re-probes for and
    // the one measurement found dominating the result (ADR 0022).
    agentVersion: AGENT_VERSION,
    runtimeVersion: runtime ? `llama-swap@${runtime.plan.parallel}x` : undefined,
    weights: findLlamaSwapModels().map((w) => ({ path: w.path, sizeBytes: w.sizeBytes })),
    contextTokens: config.managed?.contextTokens,
    parallel: config.managed?.parallel,
    servingMode: config.servingMode,
  };
}

/** Bind the serve loop to the real runtime, Exchange, and clock. */
function buildServeEffects(ctx: {
  config: SupplierConfig;
  client: ExchangeClient;
  runtime?: ManagedRuntime;
  opts: CliOptions;
  inputs: ProbeInputs;
}): ServeEffects {
  const { config, client, runtime, opts } = ctx;
  return {
    // With no runtime of our own there is nothing to watch die, and an adapted
    // Supplier reselling someone else's process should not claim otherwise.
    runtimeAlive: () => (runtime ? runtime.isAlive() : Promise.resolve(true)),

    async checkModel(model) {
      // Deliberately the cheapest thing that proves the Model still loads and
      // answers. A full re-probe every 30 seconds would be the load rather
      // than the check, and this runs against the live runtime so existing
      // Offers keep serving throughout.
      const provider = config.servingMode === "managed" ? "llamaswap" : (config.providers?.[0] ?? "ollama");
      const result = await probeOffer(provider, model, { skipHeadroom: true });
      if (result.failed) return { ok: false, reason: result.failed };
      const chat = result.capabilities.find((c) => c.name === "chat");
      return chat?.supported ? { ok: true } : { ok: false, reason: chat?.evidence ?? "no answer" };
    },

    async reprobe() {
      const { probed } = await probeMachine(
        config,
        opts,
        (l) => console.log(l),
        config.servingMode === "managed" ? config.managed?.models : undefined,
      );
      return {
        probed,
        drafts: toOfferDrafts(probed, { servingMode: config.servingMode }),
      };
    },

    async publish(offers) {
      const result = await client.publish(offers, config.guarantees);
      return { ok: result.ok, detail: result.message ?? result.error };
    },

    persist(probed, print) {
      saveState({
        version: STATE_VERSION,
        fingerprint: print,
        probedAt: new Date().toISOString(),
        probed,
        inputs: ctx.inputs as unknown as Record<string, unknown>,
      });
    },

    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
  };
}

function parseLevels(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  const levels = raw.split(",").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
  return levels.length ? levels : undefined;
}

/**
 * Start the runtime this agent owns, and arrange for probing to go through it.
 *
 * Pointing the provider at our own runtime is the whole point: a Capability is
 * evidence about a serving path (ADR 0015), so probing anything other than the
 * process we started would produce Offers describing a configuration we are
 * not serving.
 */
async function startManaged(
  config: SupplierConfig,
  onProgress: (line: string) => void,
): Promise<{ runtime: ManagedRuntime; quantization: Record<string, string>; models: string[] }> {
  const managed = config.managed!;
  const weights = findLlamaSwapModels();

  // Nothing named? Work it out. The estimate is arithmetic over file sizes and
  // installed memory — allowed to be wrong, and worth it only because probing
  // a Model that cannot load costs minutes to learn what this knew for free.
  const resolved = resolveServeList(managed, weights, onProgress);
  const plan = planManagedRuntime({ managed: resolved, available: weights });

  if (plan.missing.length > 0) {
    onProgress(`⚠ no weights found for: ${plan.missing.join(", ")}`);
  }
  if (plan.models.length === 0) {
    throw new ManagedModeError(
      "None of the requested Models have weights on this machine.",
      `Looked for: ${managed.models.join(", ")}`,
    );
  }

  for (const model of plan.models) {
    onProgress(`pinned ${model.alias.padEnd(38)} ${model.quantization} @ ${plan.contextTokens} ctx`);
  }

  // A power cut is not a shutdown we get to observe, and what it leaves behind
  // is a llama-server holding the GPU that we did not create and cannot use.
  const reaped = reapOrphanedRuntime();
  if (reaped) onProgress(`⚠ ${reaped}`);

  const runtime = await ManagedRuntime.start(plan, undefined, { onProgress });
  recordRuntimePid(runtime.pid);

  // The probe reaches llama-swap through the provider registry, which reads
  // this at model-resolution time.
  process.env.LLAMASWAP_HOST = runtime.baseUrl;

  return {
    runtime,
    quantization: Object.fromEntries(plan.models.map((m) => [m.alias, m.quantization])),
    models: plan.models.map((m) => m.alias),
  };
}

async function probeMachine(
  config: SupplierConfig,
  opts: CliOptions,
  onProgress: (line: string) => void,
  managedModels?: string[],
): Promise<{ machine: MachineState; probed: ProbedOffer[] }> {
  // In managed mode there is exactly one runtime worth asking: ours.
  const providers = managedModels ? ["llamaswap"] : config.providers;
  const runtimes = await discoverRuntimes(providers);
  const machine: MachineState = { runtimes };

  for (const runtime of runtimes) {
    onProgress(
      runtime.reachable
        ? `✓ ${runtime.provider.padEnd(11)} ${runtime.models.length} model(s)`
        : `✗ ${runtime.provider.padEnd(11)} unreachable — ${runtime.error}`,
    );
  }

  let targets = probeTargets(machine, { providers, modelFilter: config.modelFilter });
  if (managedModels) targets = targets.filter((t) => managedModels.includes(t.model));

  const concurrency = parseLevels(opts.concurrency);

  const probed: ProbedOffer[] = [];
  for (const [i, target] of targets.entries()) {
    onProgress(`[${i + 1}/${targets.length}] ${target.provider}:${target.model} …`);
    probed.push(
      await probeOffer(target.provider, target.model, {
        concurrency,
        skipHeadroom: opts.noHeadroom,
      }),
    );
  }

  return { machine, probed };
}

/** Report what a probe run left out, so a gap is never silent. */
function reportGaps(probed: ProbedOffer[], onProgress: (line: string) => void): void {
  const failed = probed.filter((p) => p.failed);
  if (failed.length) {
    // A failed probe produces no Offer rather than an Offer with a hole in it,
    // so an operator has to be told which Models fell out and why.
    onProgress(`\n${failed.length} model(s) produced no offer:`);
    for (const f of failed) onProgress(`  ${f.model} — ${f.failed}`);
  }

  const unmeasured = probed.filter((p) => !p.failed && p.headroomMeta?.failed);
  if (unmeasured.length) {
    // Published anyway, with the gap on the Offer. Dispatch can weigh
    // "throughput unknown"; it cannot weigh a Model nobody mentioned.
    onProgress(`\n${unmeasured.length} model(s) published without full Headroom:`);
    for (const p of unmeasured) onProgress(`  ${p.model} — ${p.headroomMeta?.failed}`);
  }
}

/**
 * A missing flag is not a crash.
 *
 * This command exists to be run by someone onboarding a machine for the first
 * time, and the first thing they will do is run it without enough arguments. A
 * stack trace tells them nothing they can act on.
 */
class ConfigError extends Error {}

function configured<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    throw error instanceof Error ? new ConfigError(error.message) : error;
  }
}

function reportManagedError(error: unknown): void {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (error instanceof ManagedModeError || error instanceof RuntimeStartError) {
    // Never a silent downgrade to adapted mode: an operator who asked for a
    // pinned configuration and got somebody else's would not find out until
    // the Offer under-delivered.
    console.error(`\nManaged mode failed: ${error.message}`);
    if (error.detail) console.error(`  ${error.detail}`);
    console.error("  No offers were published.");
    process.exitCode = 1;
    return;
  }
  throw error;
}

export const supplierCommand = new Command("supplier")
  .description("Turn this machine into a Supplier the Exchange can dispatch to")
  .addHelpText(
    "after",
    `
Serving modes:
  managed   The agent owns the runtime, pinning context size and quantization.
            Only managed Offers can commit to resource properties, which is why
            it is the default posture (ADR 0016). Without --serve the agent
            works out what this machine can load; see "supplier candidates".
  adapted   Resell a runtime already running on this machine. Costs the owner
            nothing to join, and carries no resource commitments — a lesser
            tier, priced as one.

Headroom is always measured, never declared. Sampling runs at ${HEADROOM_POLICY.levels.join(
      " and ",
    )} concurrent
requests within a ${HEADROOM_POLICY.maxSampleSeconds}s budget per Model (ADR 0021).

Examples:
  umwelten supplier candidates
  umwelten supplier probe --no-headroom
  umwelten supplier publish --mycel https://mycel.example --credential $KEY
  umwelten supplier publish --mode managed --serve gemma-4-26b,qwen-4-32b --ctx-size 32768
`,
  );

supplierCommand
  .command("candidates")
  .description("Show which Models this machine could load, and what was ruled out")
  .option("--ctx-size <tokens>", "Context length to estimate against", "32768")
  .action((opts: CliOptions) => {
    // Deliberately cheap: no runtime, no probe, no network. An operator sizing
    // up a new machine should be able to ask this before committing to
    // anything, and get an answer in milliseconds.
    const contextTokens = Number(opts.ctxSize ?? 32768);
    const set = estimateCandidates({
      resources: detectMachineResources(),
      weights: findLlamaSwapModels(),
      contextTokens,
    });

    const { accelerator, totalMemoryBytes } = set.resources;
    const gib = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GiB`;
    console.log(`${accelerator.name}`);
    console.log(`  ${accelerator.evidence}`);
    console.log(`  ${gib(accelerator.usableBytes)} usable of ${gib(totalMemoryBytes)} installed`);
    console.log(`  estimating at ${contextTokens} context tokens\n`);

    console.log(`${set.candidates.length} candidate(s):`);
    for (const c of set.candidates) {
      console.log(
        `  ${c.alias.padEnd(38)} ${c.quantization.padEnd(8)} ~${c.estimatedParamsB}B  ` +
          `needs ~${gib(c.estimatedLoadBytes)}`,
      );
    }

    if (set.excluded.length) {
      console.log(`\n${set.excluded.length} excluded:`);
      for (const e of set.excluded) console.log(`  ${e.alias.padEnd(38)} ${e.reason}`);
    }

    // The honesty note. This is arithmetic, not evidence, and an operator who
    // treats it as a capability list will be surprised by the probe.
    console.log(
      "\nThis is an estimate from file sizes and installed memory. It never ran a\n" +
        "model, so nothing here is a Capability — those come only from probing.",
    );
  });

function addProbeOptions(command: Command): Command {
  return command
    .option("--provider <names>", "Restrict to these runtimes (comma-separated)")
    .option("--model <substring>", "Restrict to Models matching this")
    .option("--concurrency <levels>", "Headroom sample levels, e.g. 1,4")
    .option("--no-headroom", "Capabilities only — much faster")
    .option("--mode <mode>", "managed or adapted", "adapted")
    .option("--serve <models>", "Models the agent should serve (managed mode)")
    .option("--ctx-size <tokens>", "Context length to pin (managed mode)", "32768")
    .option("--quant <name>", "Quantization to pin, e.g. Q4_K_M (managed mode)")
    .option("--parallel <n>", "Concurrent slots the runtime is configured for", "4")
    .option("--port <port>", "Port the agent's runtime listens on", String(DEFAULT_MANAGED_PORT))
    .option("--config <path>", "Where to write the generated serving config")
    .option("--binary <path>", "Path to llama-server, when not on PATH");
}

addProbeOptions(
  supplierCommand
    .command("probe")
    .description("Show what this machine can do, without publishing anything"),
).action(async (opts: CliOptions) => {
  // A dry run needs no Exchange: an operator inspecting a new machine should
  // not have to register it first.
  const config: SupplierConfig = {
    exchangeUrl: "",
    credential: "",
    guarantees: [],
    servingMode: resolveMode(opts),
    providers: opts.provider?.split(",").map((p) => p.trim()).filter(Boolean),
    modelFilter: opts.model,
    managed: resolveManaged(opts),
  };

  let runtime: ManagedRuntime | undefined;
  try {
    let quantization: Record<string, string> | undefined;
    let managedModels: string[] | undefined;

    if (config.servingMode === "managed") {
      const started = await startManaged(config, (line) => console.log(line));
      runtime = started.runtime;
      quantization = started.quantization;
      managedModels = started.models;
    }

    const { probed } = await probeMachine(config, opts, (l) => console.log(l), managedModels);
    const drafts = toOfferDrafts(probed, { servingMode: config.servingMode, quantization });

    console.log(`\nWould publish ${drafts.length} offer(s):`);
    for (const draft of drafts) {
      console.log(`  ${draft.model.padEnd(46)} ${draft.capabilities.join(", ") || "none"}`);
    }

    reportGaps(probed, (l) => console.log(l));

    const duplicates = findDuplicateModels(drafts);
    if (duplicates.length) {
      console.log(
        `\n⚠ Published twice, and the Exchange keys on (Supplier, Model) — ` +
          `one will overwrite the other: ${duplicates.join(", ")}`,
      );
    }
  } catch (error) {
    reportManagedError(error);
  } finally {
    await runtime?.stop();
  }
});

addProbeOptions(
  supplierCommand
    .command("publish")
    .description("Probe this machine and publish its Offers to the Exchange")
    .option("--mycel <url>", "Mycel base URL (or MYCEL_URL)")
    .option("--credential <token>", "Supplier credential (or SUPPLIER_CREDENTIAL)")
    .option("--guarantees <names>", "Guarantees to claim, comma-separated"),
).action(async (opts: CliOptions) => {
  let config: SupplierConfig;
  try {
    config = configured(() => resolveConfig(opts));
  } catch (error) {
    reportManagedError(error);
    return;
  }

  let runtime: ManagedRuntime | undefined;
  try {
    let quantization: Record<string, string> | undefined;
    let managedModels: string[] | undefined;

    if (config.servingMode === "managed") {
      const started = await startManaged(config, (line) => console.log(line));
      runtime = started.runtime;
      quantization = started.quantization;
      managedModels = started.models;
    }

    const { probed } = await probeMachine(config, opts, (l) => console.log(l), managedModels);

    // A runtime that batches on paper and serializes on this box would be
    // published as an Offer that cannot take a second customer. The table says
    // llama-swap batches; this checks that this build, with this --parallel,
    // actually does.
    if (config.servingMode === "managed" && !opts.noHeadroom) {
      const measured = probed.find((p) => !p.failed && p.headroomMeta);
      const verdict = verifyConcurrency(measured?.headroomMeta?.saturation ?? "inconclusive");
      if (!verdict.ok) {
        throw new ManagedModeError("The runtime does not serve concurrent work.", verdict.reason);
      }
    }

    const drafts = toOfferDrafts(probed, { servingMode: config.servingMode, quantization });
    reportGaps(probed, (l) => console.log(l));

    const client = new ExchangeClient({
      exchangeUrl: config.exchangeUrl,
      credential: config.credential,
    });
    const result = await client.publish(drafts, config.guarantees);

    if (result.ok) {
      console.log(`\nPublished ${result.offers} offer(s).`);
      console.log(`Offered under: ${(result.guarantees ?? []).join(", ") || "no guarantees"}`);
      return;
    }

    // Surfaced, never swallowed. A Supplier that believes it is on-premise and
    // is not needs to hear about it.
    console.error(`\nPublish failed (${result.status}): ${result.error ?? "unknown"}`);
    if (result.message) console.error(`  ${result.message}`);
    process.exitCode = 1;
  } catch (error) {
    reportManagedError(error);
  } finally {
    // Managed mode owns the runtime, so managed mode takes it down — including
    // on the failure paths, which is where orphans come from.
    await runtime?.stop();
  }
});

addProbeOptions(
  supplierCommand
    .command("serve")
    .description("Stay running: publish, watch, withdraw what breaks, re-probe when stale")
    .option("--mycel <url>", "Mycel base URL (or MYCEL_URL)")
    .option("--credential <token>", "Supplier credential (or SUPPLIER_CREDENTIAL)")
    .option("--guarantees <names>", "Guarantees to claim, comma-separated")
    .option("--reprobe-interval <hours>", "Backstop re-probe interval", "24")
    .option("--health-interval <seconds>", "How often to check what we published", "30")
    .option("--resume", "Reuse the saved configuration and credential"),
).action(async (opts: CliOptions) => {
  // Resume first: a machine coming back from a reboot has nobody at the
  // keyboard to re-enter a credential.
  let config: SupplierConfig;
  try {
    config = configured(() => (opts.resume ? resumeConfig(opts) : resolveConfig(opts)));
    if (!opts.resume) persistForRestart(config);
  } catch (error) {
    reportManagedError(error);
    return;
  }

  const abort = new AbortController();
  let runtime: ManagedRuntime | undefined;
  let quantization: Record<string, string> | undefined;
  let managedModels: string[] | undefined;

  const client = new ExchangeClient({
    exchangeUrl: config.exchangeUrl,
    credential: config.credential,
  });

  const shutdown = async () => {
    abort.abort();
    // Withdrawing on the way out is the machine's owner getting it back. A
    // machine somebody else owns is lent, not given, so stopping has to be
    // immediate and complete rather than leaving the Exchange to notice.
    console.log("\nwithdrawing offers and releasing the machine…");
    await client.withdraw().catch(() => undefined);
    await runtime?.stop();
    clearRuntimePid();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  try {
    if (config.servingMode === "managed") {
      const started = await startManaged(config, (line) => console.log(line));
      runtime = started.runtime;
      quantization = started.quantization;
      managedModels = started.models;
    }

    const inputs = probeInputsFor(config, runtime);
    const previous = loadState();
    // Always probe on start. A restart that republishes a snapshot from before
    // a reboot is publishing a claim about a machine that no longer exists.
    const reason =
      reprobeReason({
        previous: previous && {
          fingerprint: previous.fingerprint,
          probedAt: previous.probedAt,
          inputs: previous.inputs as Partial<ProbeInputs> | undefined,
        },
        current: inputs,
        now: Date.now(),
        intervalMs: Number(opts.reprobeInterval ?? 24) * 3_600_000,
      }) ?? "resuming a probe from this same machine";
    console.log(`\nprobing: ${reason}`);

    const { probed } = await probeMachine(config, opts, (l) => console.log(l), managedModels);
    const drafts = toOfferDrafts(probed, { servingMode: config.servingMode, quantization });
    reportGaps(probed, (l) => console.log(l));
    saveState({
      version: STATE_VERSION,
      fingerprint: fingerprint(inputs),
      probedAt: new Date().toISOString(),
      probed,
      inputs: inputs as unknown as Record<string, unknown>,
    });

    const supervisor = new OfferSupervisor(drafts);
    const published = await client.publish(supervisor.live(), config.guarantees);
    console.log(
      published.ok
        ? `published ${published.offers} offer(s); watching`
        : `publish failed (${published.status}): ${published.error ?? "unknown"}`,
    );

    await runServeLoop(supervisor, buildServeEffects({ config, client, runtime, opts, inputs }), {
      healthIntervalMs: Number(opts.healthInterval ?? 30) * 1_000,
      reprobeIntervalMs: Number(opts.reprobeInterval ?? 24) * 3_600_000,
      // The Exchange expires a quiet Supplier. Staying audible is what makes
      // that expiry mean "gone" rather than "has not changed lately".
      signal: abort.signal,
      probeInputs: inputs,
      previous: {
        fingerprint: fingerprint(inputs),
        probedAt: new Date().toISOString(),
        inputs,
      },
    });
  } catch (error) {
    reportManagedError(error);
    await runtime?.stop();
    clearRuntimePid();
  }
});

supplierCommand
  .command("install-service")
  .description("Print a service unit so the agent comes back after a reboot")
  .option("--kind <kind>", "systemd or launchd (default: this platform)")
  .option("--user <name>", "Run the service as this user (systemd)")
  .action((opts: CliOptions) => {
    const kind = (opts.kind as ServiceKind | undefined) ?? defaultServiceKind(process.platform);
    if (!kind) {
      console.error(`No service format for ${process.platform}. Pass --kind systemd or launchd.`);
      process.exitCode = 1;
      return;
    }
    // Nothing inside a process can restart that process, so the agent does not
    // pretend to. This hands the job to the thing the operating system already
    // has for it.
    console.log(
      renderService(kind, {
        command: process.argv[1]?.endsWith("umwelten") ? process.argv[1] : "umwelten",
        supplierDir: supplierDir(),
        user: opts.user,
      }),
    );
  });

supplierCommand
  .command("dial")
  .description("Hold a Connection open to the Exchange and serve over it (ADR 0023)")
  .option("--mycel <url>", "Mycel base URL (or MYCEL_URL)")
  .option("--credential <token>", "Supplier credential (or SUPPLIER_CREDENTIAL)")
  .option(
    "--runtime <url>",
    "Local OpenAI-compatible runtime to serve from, e.g. http://localhost:4000/v1",
  )
  .option("--runtime-key <token>", "Key the local runtime expects (or RUNTIME_API_KEY)")
  .action(async (opts: CliOptions) => {
    const exchangeUrl = opts.mycel ?? process.env.MYCEL_URL;
    const credential = opts.credential ?? process.env.SUPPLIER_CREDENTIAL;
    if (!exchangeUrl || !credential) {
      console.error("Need both --mycel and --credential (or MYCEL_URL / SUPPLIER_CREDENTIAL).");
      process.exitCode = 1;
      return;
    }

    // Nothing listens on this machine. The Connection is outbound and held —
    // no tunnel, no ACL, no DNS, no firewall rule (ADR 0023).
    const abort = new AbortController();
    const stop = () => {
      console.log("\nhanging up; the Exchange will see this machine leave immediately");
      abort.abort();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    const runtimeUrl = opts.runtime;
    if (!runtimeUrl) {
      // Holding the Connection without serving is legitimate — it is how you
      // check reachability — but it is not a Supplier anyone can buy from, and
      // silence about that reads like success.
      console.log("no --runtime: holding the Connection, serving nothing");
    }

    // The catalogue comes from the last probe, not a fresh one. Re-probing on
    // every reconnect would make a flapping link expensive, and the fingerprint
    // is what decides when a measurement is actually stale.
    const cached = loadState();
    const config = (() => {
      try {
        return resolveConfig(opts);
      } catch {
        // Dialling only needs a URL and a credential, both of which can come
        // from flags. A machine with no saved config can still connect; it
        // just has nothing of its own to publish.
        return undefined;
      }
    })();

    const offers =
      cached && config
        ? toOfferDrafts(cached.probed, { servingMode: config.servingMode })
        : undefined;

    if (offers) {
      console.log(
        `publishing ${offers.length} offer(s) from the probe of ${cached!.probedAt}` +
          " — re-probe with `umwelten supplier probe` if the machine changed",
      );
    } else {
      // Said out loud, because the alternative reading is that dialling in
      // wiped a catalogue the operator published by hand. It does not: an
      // absent offer set means "do not touch mine".
      console.log("no cached probe: leaving whatever Offers the Exchange already has");
    }

    console.log(`dialling ${exchangeUrl} …`);
    await dialIn({
      exchangeUrl,
      credential,
      agentVersion: AGENT_VERSION,
      signal: abort.signal,
      runtimeUrl,
      runtimeCredential: opts.runtimeKey ?? process.env.RUNTIME_API_KEY,
      offers,
      guarantees: config?.guarantees,
      onServeEvent: (event) => {
        switch (event.type) {
          case "request-started":
            console.log(`  → ${event.id.slice(0, 8)} ${event.model ?? ""}`);
            break;
          case "request-finished":
            console.log(`  ← ${event.id.slice(0, 8)} ${event.bytes}b`);
            break;
          case "request-cancelled":
            console.log(`  ✕ ${event.id.slice(0, 8)} cancelled`);
            break;
          case "request-failed":
            console.error(`  ! ${event.id.slice(0, 8)} ${event.message}`);
            break;
        }
      },
      onEvent: (event) => {
        switch (event.type) {
          case "connecting":
            if (event.attempt > 1) console.log(`  reconnecting (attempt ${event.attempt})`);
            break;
          case "connected":
            // Connected is available. There is no heartbeat to schedule and no
            // staleness window to wait out.
            console.log("connected — this machine is now dispatchable");
            break;
          case "disconnected":
            console.log(`disconnected${event.code ? ` (${event.code})` : ""}`);
            break;
          case "refused":
            console.error(`refused: ${event.reason}`);
            break;
          case "retrying":
            console.log(`  retrying in ${Math.round(event.inMs / 1000)}s`);
            break;
        }
      },
    });
  });

supplierCommand
  .command("status")
  .description("Show the saved configuration and the last probe")
  .action(() => {
    const config = loadConfig();
    const state = loadState();
    if (!config) {
      console.log(`No saved configuration in ${supplierDir()}.`);
      console.log("Run `umwelten supplier serve --mycel … --credential …` once.");
      return;
    }

    console.log(`Exchange:   ${config.exchangeUrl}`);
    console.log(`Mode:       ${config.servingMode}`);
    console.log(`Guarantees: ${config.guarantees.join(", ") || "none claimed"}`);
    console.log(`Credential: ${loadCredential() ? "present" : "MISSING"}`);

    if (!state) {
      console.log("\nNo saved probe — the next start will probe from scratch.");
      return;
    }
    console.log(`\nLast probed ${state.probedAt} (fingerprint ${state.fingerprint})`);
    for (const offer of state.probed) {
      const caps = offer.capabilities.filter((c) => c.supported).map((c) => c.name);
      console.log(`  ${offer.model.padEnd(38)} ${offer.failed ?? (caps.join(", ") || "none")}`);
    }
  });

supplierCommand
  .command("withdraw")
  .description("Remove this machine's Offers from the Exchange")
  .option("--mycel <url>", "Mycel base URL (or MYCEL_URL)")
  .option("--credential <token>", "Supplier credential (or SUPPLIER_CREDENTIAL)")
  .action(async (opts: CliOptions) => {
    let config: SupplierConfig;
    try {
      config = configured(() => resolveConfig({ ...opts, mode: "adapted" }));
    } catch (error) {
      reportManagedError(error);
      return;
    }
    const client = new ExchangeClient({
      exchangeUrl: config.exchangeUrl,
      credential: config.credential,
    });
    const result = await client.withdraw();
    console.log(result.ok ? "Withdrawn." : `Withdraw failed (${result.status}).`);
    if (!result.ok) process.exitCode = 1;
  });
