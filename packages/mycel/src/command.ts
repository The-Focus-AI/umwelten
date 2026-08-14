/**
 * `umwelten mycel` — run the Exchange, and operate it.
 *
 * Two audiences in one command. `serve` is what the container runs; everything
 * else is the operator surface — onboarding a Client, issuing an Application its
 * credential, funding a balance, registering a Supplier.
 *
 * **There is no HTTP admin API, deliberately.** These operations run rarely, by
 * one person, and every one of them can move money or grant eligibility for
 * traffic the operator is liable for (ADR 0012). A CLI on the box is a smaller
 * surface than a route, and the operations are rare enough that the convenience
 * of a route is not worth what it costs to secure.
 */

import { Command } from "commander";
import { NeonStore } from "./store/neon-store.js";
import { MemoryStore } from "./store/memory-store.js";
import { Operator } from "./operator.js";
import { DEFAULT_PORT, createExchangeServer } from "./server.js";
import { Balances, applicationOwner, clientOwner } from "./metering/balances.js";
import type { ExchangeStore } from "./store/types.js";
import type { MicroDollars, PublishedOffer } from "./types.js";

interface CliOptions {
  port?: string;
  database?: string;
  name?: string;
  client?: string;
  jwksUrl?: string;
  guarantees?: string;
  models?: string;
  baseUrl?: string;
  kind?: string;
  credentialEnv?: string;
  displayName?: string;
  application?: string;
  reason?: string;
  ephemeral?: boolean;
  wholesalePrompt?: string;
  wholesaleCompletion?: string;
  retailPrompt?: string;
  retailCompletion?: string;
}

class MycelCliError extends Error {}

/**
 * Resolve the store.
 *
 * A missing database URL is an error rather than a silent fall back to memory:
 * an Exchange that starts with an empty in-memory ledger looks healthy, serves
 * traffic, and loses every balance when it restarts.
 */
function openStore(opts: CliOptions): ExchangeStore {
  if (opts.ephemeral) {
    // Only ever explicit. Useful for a smoke test against a throwaway process.
    return new MemoryStore();
  }
  const url = opts.database ?? process.env.MYCEL_DATABASE_URL;
  if (!url) {
    // Inside the container this has one overwhelmingly likely cause, and the
    // generic message sends you looking at the host's configuration instead —
    // which is fine, and not the problem. `MYCEL_SECRETS` set with nothing
    // resolved means the entrypoint never ran: `docker exec` starts a new
    // process and does not run the image's ENTRYPOINT, so the secrets resolved
    // at boot live only in the `serve` process.
    if (process.env.MYCEL_SECRETS) {
      throw new MycelCliError(
        "No database, but MYCEL_SECRETS is set — the entrypoint did not run.\n" +
          "  `docker exec` skips the image ENTRYPOINT, so nothing resolved the secrets.\n" +
          "  Run it through the entrypoint instead:\n" +
          "    docker compose --project-directory /opt/umwelten/deploy/mycel \\\n" +
          "      exec mycel /usr/local/bin/mycel-entrypoint node /app/mycel.js <command>\n" +
          "  (/etc/profile.d/mycel.sh defines a `mycel` function that does this.)",
      );
    }
    throw new MycelCliError(
      "No database. Pass --database or set MYCEL_DATABASE_URL.\n" +
        "  (`serve --ephemeral` runs against memory, which loses every balance on exit.)",
    );
  }
  return new NeonStore(url);
}

/** Money is integer micro-dollars everywhere. $1.00 is 1000000. */
function parseMicroDollars(raw: string): MicroDollars {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new MycelCliError(
      `"${raw}" is not an integer number of micro-dollars. $1.00 is 1000000.`,
    );
  }
  return value;
}

function dollars(microDollars: MicroDollars): string {
  return `$${(microDollars / 1_000_000).toFixed(4)}`;
}

function list(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Report an operator error as a message rather than a stack.
 *
 * Everything here is run by a person at a terminal, usually while something is
 * already wrong. A stack trace tells them nothing they can act on.
 */
async function guard(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof MycelCliError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

/** Every operator command needs the store, and they all reach it the same way. */
function withDatabase(command: Command): Command {
  return command.option(
    "--database <url>",
    "Postgres connection string (or MYCEL_DATABASE_URL)",
  );
}

export const mycelCommand = new Command("mycel")
  .description("Run and operate Mycel — the Exchange")
  .addHelpText(
    "after",
    `
Money is integer micro-dollars everywhere: $1.00 is 1000000. Never a float —
a Balance is a sum of these, and an amount that cannot be represented exactly
is an amount somebody eventually argues about.

Examples:
  umwelten mycel serve
  umwelten mycel client create acme --name "Acme"
  umwelten mycel application create hairstyle-app --client acme
  umwelten mycel grant acme 50000000
  umwelten mycel supplier register openrouter --base-url https://openrouter.ai/api/v1 \\
    --credential-env OPENROUTER_API_KEY
`,
  );

mycelCommand
  .command("serve")
  .description("Run the Exchange")
  .option("--port <port>", "Port to listen on", String(DEFAULT_PORT))
  .option("--database <url>", "Postgres connection string (or MYCEL_DATABASE_URL)")
  .option("--ephemeral", "Run against memory — loses every balance on exit")
  .action(async (opts: CliOptions) => {
    await guard(async () => {
      const store = openStore(opts);
      const port = Number(opts.port ?? DEFAULT_PORT);

      // setup() runs the schema DDL, so a bad database URL fails here rather
      // than on the first request that tries to charge someone.
      const exchange = await createExchangeServer({ store, port });
      console.log(`Mycel listening on ${exchange.url}`);
      if (opts.ephemeral) console.log("⚠ ephemeral store — balances are lost on exit");

      const stop = async () => {
        await exchange.close();
        process.exit(0);
      };
      process.once("SIGINT", () => void stop());
      process.once("SIGTERM", () => void stop());
    });
  });

// ── Demand ───────────────────────────────────────────────────────────────────

const client = mycelCommand.command("client").description("Clients you invoice");

withDatabase(client.command("create <id>"))
  .description("Record a commercial relationship that already exists")
  .option("--name <name>", "Display name")
  .action(async (id: string, opts: CliOptions) => {
    await guard(async () => {
      const operator = new Operator(openStore(opts));
      const created = await operator.createClient(id, opts.name ?? id);
      console.log(`Created client ${created.id} (${created.name}).`);
      console.log("There is no signup — a Client is onboarded by contract (ADR 0012).");
    });
  });

const application = mycelCommand
  .command("application")
  .description("Products built on the Exchange");

withDatabase(application.command("create <id>"))
  .description("Create an Application and issue its credential")
  .option("--client <id>", "Owning Client")
  .option("--jwks-url <url>", "Publish keys instead of holding a static credential")
  .option("--guarantees <names>", "Required on every request from this Application")
  .option("--models <names>", "Restrict to these Models")
  .action(async (id: string, opts: CliOptions) => {
    await guard(async () => {
      if (!opts.client) throw new MycelCliError("Which Client owns it? Pass --client.");
      const operator = new Operator(openStore(opts));
      const { application: app, credential } = await operator.createApplication({
        id,
        clientId: opts.client,
        jwksUrl: opts.jwksUrl,
        requiredGuarantees: list(opts.guarantees),
        allowedModels: opts.models ? list(opts.models) : undefined,
      });

      console.log(`Created application ${app.id} for client ${app.clientId}.`);
      if (app.requiredGuarantees.length) {
        console.log(`Every request requires: ${app.requiredGuarantees.join(", ")}`);
      }
      if (!credential) {
        console.log(`Authenticates by signing tokens verified against ${app.jwksUrl}`);
        return;
      }

      // Once. There is no path that recovers it, because only the hash is kept.
      console.log(`\n  ${credential}\n`);
      console.log("Shown once and never recoverable — store it now. Rotate if lost.");
      console.log("Callers send it as a bearer token, with the End User in a header:");
      console.log("  Authorization: Bearer <credential>");
      console.log("  X-Mycel-End-User: <your user id>");
    });
  });

withDatabase(application.command("rotate <id>"))
  .description("Issue a new credential, invalidating the old one")
  .action(async (id: string, opts: CliOptions) => {
    await guard(async () => {
      const operator = new Operator(openStore(opts));
      const credential = await operator.rotateApplicationCredential(id);
      console.log(`\n  ${credential}\n`);
      console.log("The previous credential stopped working the moment this was issued.");
    });
  });

// ── Money ────────────────────────────────────────────────────────────────────

withDatabase(mycelCommand.command("grant <owner> <microDollars>"))
  .description("Add credit to a Client or Application balance")
  .option("--application", "Treat <owner> as an Application rather than a Client")
  .option("--reason <text>", "Recorded on the ledger entry", "grant")
  .action(async (owner: string, amount: string, opts: CliOptions & { application?: boolean }) => {
    await guard(async () => {
      const operator = new Operator(openStore(opts));
      const micro = parseMicroDollars(amount);
      const balance = opts.application
        ? await operator.grantToApplication(owner, micro, opts.reason)
        : await operator.grantToClient(owner, micro, opts.reason);

      console.log(`Granted ${dollars(micro)} to ${balance.ownerKind} ${balance.ownerKey}.`);
      console.log(`Balance is now ${dollars(balance.microDollars)}.`);
    });
  });

withDatabase(mycelCommand.command("balance <owner>"))
  .description("Show a balance and the entries that make it up")
  .option("--application", "Treat <owner> as an Application rather than a Client")
  .action(async (owner: string, opts: CliOptions & { application?: boolean }) => {
    await guard(async () => {
      const balances = new Balances(openStore(opts));
      const which = opts.application ? applicationOwner(owner) : clientOwner(owner);
      const [balance, entries] = await Promise.all([
        balances.get(which),
        balances.entries(which),
      ]);

      console.log(`${balance.ownerKind} ${balance.ownerKey}: ${dollars(balance.microDollars)}`);
      // A Balance is the sum of its entries, never a stored total, so showing
      // both is the check as well as the report.
      for (const entry of entries) {
        console.log(
          `  ${entry.createdAt.toISOString()}  ${dollars(entry.microDollars).padStart(12)}  ` +
            `${entry.reason}${entry.requestId ? ` (${entry.requestId})` : ""}`,
        );
      }
    });
  });

// ── Supply ───────────────────────────────────────────────────────────────────

const supplier = mycelCommand.command("supplier").description("Parties that produce tokens");

withDatabase(supplier.command("register <id>"))
  .description("Register a Supplier and issue its publishing credential")
  .option("--display-name <name>")
  .option(
    "--kind <kind>",
    "agent (dials in and holds a Connection) or vendor (dialled out to)",
    "vendor",
  )
  .option("--base-url <url>", "Where the Exchange sends work (OpenAI-compatible; vendors only)")
  .option(
    "--credential-env <name>",
    "Name of the env var holding the key we present upstream — the NAME, never the key",
  )
  .option("--guarantees <names>", "Guarantees this Supplier may publish under")
  .action(async (id: string, opts: CliOptions) => {
    await guard(async () => {
      const kind = opts.kind ?? "vendor";
      if (kind !== "agent" && kind !== "vendor") {
        throw new MycelCliError(`Unknown kind "${kind}". Expected agent or vendor.`);
      }
      // A vendor is dialled out to, so it has to say where. An agent dials in
      // and has no address to register — requiring one would be asking for the
      // very thing ADR 0023 exists to stop needing.
      if (kind === "vendor" && !opts.baseUrl) {
        throw new MycelCliError("Where does work go? Pass --base-url.");
      }
      if (kind === "agent" && opts.baseUrl) {
        throw new MycelCliError(
          "An agent Supplier dials in; --base-url would never be used.\n" +
            "  Drop it, or register this as --kind vendor.",
        );
      }

      const operator = new Operator(openStore(opts));
      const { supplier: created, credential } = await operator.registerSupplier({
        id,
        displayName: opts.displayName ?? id,
        kind,
        baseUrl: opts.baseUrl,
        upstreamCredentialEnv: opts.credentialEnv,
        grantedGuarantees: list(opts.guarantees),
      });

      console.log(
        created.kind === "agent"
          ? `Registered supplier ${created.id} (agent — dials in, no address needed)`
          : `Registered supplier ${created.id} → ${created.baseUrl}`,
      );
      console.log(
        `Granted guarantees: ${created.grantedGuarantees.join(", ") || "none"}` +
          " — the operator is liable for these, so a Supplier claiming more is refused.",
      );
      console.log(`\n  ${credential}\n`);
      console.log("Shown once. The agent presents it when publishing Offers.");
    });
  });

withDatabase(supplier.command("rotate <id>"))
  .description("Issue a new credential, invalidating the old one")
  .action(async (id: string, opts: CliOptions) => {
    await guard(async () => {
      const operator = new Operator(openStore(opts));
      const credential = await operator.rotateCredential(id);

      console.log(`Rotated the credential for ${id}.\n`);
      console.log(`  ${credential}\n`);
      console.log("Shown once. Only its hash is stored.");
      // A machine holding a Connection authenticated with the old credential
      // keeps it: the check happens at the upgrade, not per frame. Saying so
      // avoids the opposite conclusion, which is that rotation did not work.
      console.log(
        "\nAn agent already connected stays connected — the credential is checked when\n" +
          "it dials, not per request. It will need the new one the next time it does.",
      );
    });
  });

withDatabase(supplier.command("connections [supplierId]"))
  .description("Show the history of machine Suppliers dialling in and out")
  .option("--limit <n>", "Show only the most recent N events")
  .action(async (supplierId: string | undefined, opts: CliOptions & { limit?: string }) => {
    await guard(async () => {
      const store = openStore(opts);
      const events = await store.listConnectionEvents(supplierId ? { supplierId } : undefined);

      if (events.length === 0) {
        // Says nothing about whether a machine is connected *now* — this is a
        // history, and the answer to "now" lives in one process's memory by
        // design (ADR 0023). An empty history means nothing ever dialled in.
        console.log(
          supplierId
            ? `No connection history for ${supplierId}. Has it ever dialled in?`
            : "No machine Supplier has ever dialled in.",
        );
        return;
      }

      const limit = opts.limit ? Number(opts.limit) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new MycelCliError(`--limit wants a positive whole number, got "${opts.limit}".`);
      }
      const shown = limit ? events.slice(-limit) : events;

      for (const event of shown) {
        // The reason is the point of writing these down. "Someone stopped the
        // agent" and "go and fix the network" are different problems, and an
        // undifferentiated disconnect cannot tell them apart.
        console.log(
          `${event.at.toISOString()}  ${event.supplierId.padEnd(16)}  ` +
            `${event.event}${event.reason ? ` (${event.reason})` : ""}`,
        );
      }
    });
  });

const offers = mycelCommand.command("offers").description("What a Supplier is selling");

/**
 * Default Capability set for a vendor Offer.
 *
 * Every mainstream hosted model does these. Anything narrower has to be stated,
 * and anything broader — tool calling, structured output, reasoning — is per
 * model and per vendor, so it is opt-in rather than assumed. Over-claiming here
 * has Dispatch route a tool-calling request somewhere that cannot serve it,
 * which is the failure ADR 0015 exists to prevent.
 */
const DEFAULT_VENDOR_CAPABILITIES = ["chat", "streaming"];

withDatabase(offers.command("sync <supplierId>"))
  .description("Publish a vendor's Models as Offers, on its behalf")
  .option("--models <names>", "Models to resell, comma-separated")
  .option("--capabilities <names>", "Applied to every Model", DEFAULT_VENDOR_CAPABILITIES.join(","))
  .option(
    "--context <tokens>",
    "Context this Offer actually accepts. Managed Offers only (ADR 0016)",
  )
  .option(
    "--quantization <name>",
    "How these weights are served, e.g. NVFP4. Managed Offers only (ADR 0016)",
  )
  .option(
    "--managed",
    "The operator controls this runtime — required to commit to context or quantization",
  )
  .option(
    "--watch <minutes>",
    "Keep republishing. A vendor runs no agent, so this IS its heartbeat",
  )
  .action(
    async (
      supplierId: string,
      opts: CliOptions & {
        capabilities?: string;
        watch?: string;
        context?: string;
        quantization?: string;
        managed?: boolean;
      },
    ) => {
    await guard(async () => {
      const models = list(opts.models);
      if (models.length === 0) {
        throw new MycelCliError(
          "Which Models? Pass --models.\n" +
            "  A curated list, not a whole catalogue: every Offer is a claim, and these\n" +
            "  are declared rather than probed.",
        );
      }

      const store = openStore(opts);
      const supplier = await store.getSupplier(supplierId);
      if (!supplier) throw new MycelCliError(`Unknown supplier "${supplierId}".`);

      const operator = new Operator(store);
      const capabilities = list(opts.capabilities) as PublishedOffer["capabilities"];

      // Only a runtime the operator controls can promise these. An adapted
      // Offer resells a configuration it does not own and cannot honestly
      // claim one — so this is refused rather than quietly dropped, which is
      // how a box ends up published as less than it is.
      const servingMode = opts.managed ? "managed" : "adapted";
      if (servingMode === "adapted" && (opts.context || opts.quantization)) {
        throw new MycelCliError(
          "--context and --quantization are commitments only a managed Offer can make.\n" +
            "  Add --managed if you control this runtime, or drop them (ADR 0016).",
        );
      }

      const contextTokens = opts.context ? Number(opts.context) : undefined;
      if (contextTokens !== undefined && (!Number.isInteger(contextTokens) || contextTokens <= 0)) {
        throw new MycelCliError(`"${opts.context}" is not a number of tokens.`);
      }

      const publish = async () => {
        await operator.publishOffersFor(
          supplierId,
          models.map((model) => ({
            model,
            capabilities,
            servingMode,
            contextTokens,
            quantization: opts.quantization,
          })),
        );
      };

      await publish();
      console.log(`Published ${models.length} offer(s) for ${supplierId}: ${models.join(", ")}`);
      console.log(`Capabilities (declared, not probed): ${capabilities.join(", ")}`);
      if (contextTokens) console.log(`Context: ${contextTokens} tokens`);
      if (opts.quantization) console.log(`Quantization: ${opts.quantization}`);

      // A machine's Offers do not expire, so telling its operator to schedule a
      // republish is not merely noise — it is instructions to build a service
      // that does nothing, for a mechanism ADR 0023 replaced.
      if (supplier.kind === "agent") {
        console.log(
          "\nThis Supplier dials in, so these do not expire: its Connection is its\n" +
            "availability. No --watch, no heartbeat, nothing to schedule (ADR 0023).",
        );
        return;
      }

      if (!opts.watch) {
        // Said plainly, because it is the first thing that will look like a bug:
        // Dispatch drops an Offer that has not been republished recently, and a
        // vendor has no agent heartbeating for it.
        console.log(
          "\n⚠ One-shot. Offers not republished within the staleness window stop being\n" +
            "  dispatched to. Run with --watch <minutes> as a service, or schedule this.",
        );
        return;
      }

      const minutes = Number(opts.watch);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new MycelCliError(`"${opts.watch}" is not a number of minutes.`);
      }
      console.log(`\nRepublishing every ${minutes}m. This is the heartbeat — if it stops,`);
      console.log("the Offers expire, which is correct: we no longer know the vendor's state.");

      const timer = setInterval(() => {
        void publish().catch((error) => {
          // Keep beating. One failed republish is survivable; giving up is not,
          // because the Offers then expire for a vendor that is probably fine.
          console.error(`republish failed: ${error instanceof Error ? error.message : error}`);
        });
      }, minutes * 60_000);

      await new Promise<void>((resolve) => {
        const stop = () => {
          clearInterval(timer);
          resolve();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
    });
  },
  );

withDatabase(mycelCommand.command("price <supplierId> <model>"))
  .description("Set what an Offer costs us and what it charges")
  .option("--wholesale-prompt <microDollars>", "Per million prompt tokens, what we owe")
  .option("--wholesale-completion <microDollars>", "Per million completion tokens, what we owe")
  .option("--retail-prompt <microDollars>", "Per million prompt tokens, what we charge")
  .option("--retail-completion <microDollars>", "Per million completion tokens, what we charge")
  .action(async (supplierId: string, model: string, opts: CliOptions) => {
    await guard(async () => {
      const required = {
        "--wholesale-prompt": opts.wholesalePrompt,
        "--wholesale-completion": opts.wholesaleCompletion,
        "--retail-prompt": opts.retailPrompt,
        "--retail-completion": opts.retailCompletion,
      };
      const missing = Object.entries(required)
        .filter(([, value]) => value === undefined)
        .map(([flag]) => flag);
      if (missing.length) {
        // All four or none. Setting two would leave the others at whatever they
        // were, which for a price is the kind of half-change nobody notices
        // until an invoice.
        throw new MycelCliError(`Missing ${missing.join(", ")}. Set all four together.`);
      }

      const operator = new Operator(openStore(opts));
      const pricing = {
        wholesalePromptPerMillion: parseMicroDollars(opts.wholesalePrompt!),
        wholesaleCompletionPerMillion: parseMicroDollars(opts.wholesaleCompletion!),
        retailPromptPerMillion: parseMicroDollars(opts.retailPrompt!),
        retailCompletionPerMillion: parseMicroDollars(opts.retailCompletion!),
      };
      await operator.setPricing(supplierId, model, pricing);

      console.log(`${supplierId} / ${model}`);
      console.log(
        `  wholesale  ${dollars(pricing.wholesalePromptPerMillion)} prompt / ` +
          `${dollars(pricing.wholesaleCompletionPerMillion)} completion, per million`,
      );
      console.log(
        `  retail     ${dollars(pricing.retailPromptPerMillion)} prompt / ` +
          `${dollars(pricing.retailCompletionPerMillion)} completion, per million`,
      );

      // Not a warning — retail is deliberately independent of wholesale
      // (ADR 0013), and selling below cost can be a deliberate choice. But it
      // should never be an accident.
      if (pricing.retailPromptPerMillion < pricing.wholesalePromptPerMillion ||
          pricing.retailCompletionPerMillion < pricing.wholesaleCompletionPerMillion) {
        console.log("\n  note: retail is below wholesale — this Offer loses money per token.");
      }
    });
  });
