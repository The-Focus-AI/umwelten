/**
 * `umwelten supplier` — turn this machine into a Supplier.
 *
 * A CLI command rather than a separately installed binary: someone who already
 * has umwelten runs a command they already have, which is the difference
 * between onboarding hardware being a task and it being a decision.
 *
 * This package deliberately does **not** depend on `@umwelten/exchange`. It
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
import type {
  MachineState,
  ManagedOptions,
  ProbedOffer,
  ServingMode,
  SupplierConfig,
} from "./types.js";

interface CliOptions {
  exchange?: string;
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
}

const DEFAULT_MANAGED_PORT = 7450;
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
  const exchangeUrl = opts.exchange ?? process.env.EXCHANGE_URL;
  const credential = opts.credential ?? process.env.SUPPLIER_CREDENTIAL;
  if (!exchangeUrl) throw new Error("No Exchange URL. Pass --exchange or set EXCHANGE_URL.");
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

  const runtime = await ManagedRuntime.start(plan, undefined, { onProgress });

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

function reportManagedError(error: unknown): void {
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
  umwelten supplier publish --exchange https://exchange.example --credential $KEY
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
    .option("--exchange <url>", "Exchange base URL (or EXCHANGE_URL)")
    .option("--credential <token>", "Supplier credential (or SUPPLIER_CREDENTIAL)")
    .option("--guarantees <names>", "Guarantees to claim, comma-separated"),
).action(async (opts: CliOptions) => {
  const config = resolveConfig(opts);

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

supplierCommand
  .command("withdraw")
  .description("Remove this machine's Offers from the Exchange")
  .option("--exchange <url>", "Exchange base URL (or EXCHANGE_URL)")
  .option("--credential <token>", "Supplier credential (or SUPPLIER_CREDENTIAL)")
  .action(async (opts: CliOptions) => {
    const config = resolveConfig({ ...opts, mode: "adapted" });
    const client = new ExchangeClient({
      exchangeUrl: config.exchangeUrl,
      credential: config.credential,
    });
    const result = await client.withdraw();
    console.log(result.ok ? "Withdrawn." : `Withdraw failed (${result.status}).`);
    if (!result.ok) process.exitCode = 1;
  });
