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
  credentialEnv?: string;
  displayName?: string;
  application?: string;
  reason?: string;
  ephemeral?: boolean;
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
    throw new MycelCliError(
      "No database. Pass --database or set MYCEL_DATABASE_URL.\n" +
        "  (--ephemeral runs against memory, which loses every balance on exit.)",
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

/** Run an action, reporting an operator error as a message rather than a stack. */
function action(run: (opts: CliOptions) => Promise<void>) {
  return async (opts: CliOptions) => {
    try {
      await run(opts);
    } catch (error) {
      if (error instanceof MycelCliError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  };
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
  .action(
    action(async (opts) => {
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
    }),
  );

// ── Demand ───────────────────────────────────────────────────────────────────

const client = mycelCommand.command("client").description("Clients you invoice");

client
  .command("create <id>")
  .description("Record a commercial relationship that already exists")
  .option("--name <name>", "Display name")
  .option("--database <url>")
  .action(async (id: string, opts: CliOptions) => {
    await action(async () => {
      const operator = new Operator(openStore(opts));
      const created = await operator.createClient(id, opts.name ?? id);
      console.log(`Created client ${created.id} (${created.name}).`);
      console.log("There is no signup — a Client is onboarded by contract (ADR 0012).");
    })(opts);
  });

const application = mycelCommand
  .command("application")
  .description("Products built on the Exchange");

application
  .command("create <id>")
  .description("Create an Application and issue its credential")
  .option("--client <id>", "Owning Client")
  .option("--jwks-url <url>", "Publish keys instead of holding a static credential")
  .option("--guarantees <names>", "Required on every request from this Application")
  .option("--models <names>", "Restrict to these Models")
  .option("--database <url>")
  .action(async (id: string, opts: CliOptions) => {
    await action(async () => {
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
    })(opts);
  });

application
  .command("rotate <id>")
  .description("Issue a new credential, invalidating the old one")
  .option("--database <url>")
  .action(async (id: string, opts: CliOptions) => {
    await action(async () => {
      const operator = new Operator(openStore(opts));
      const credential = await operator.rotateApplicationCredential(id);
      console.log(`\n  ${credential}\n`);
      console.log("The previous credential stopped working the moment this was issued.");
    })(opts);
  });

// ── Money ────────────────────────────────────────────────────────────────────

mycelCommand
  .command("grant <owner> <microDollars>")
  .description("Add credit to a Client or Application balance")
  .option("--application", "Treat <owner> as an Application rather than a Client")
  .option("--reason <text>", "Recorded on the ledger entry", "grant")
  .option("--database <url>")
  .action(async (owner: string, amount: string, opts: CliOptions & { application?: boolean }) => {
    await action(async () => {
      const operator = new Operator(openStore(opts));
      const micro = parseMicroDollars(amount);
      const balance = opts.application
        ? await operator.grantToApplication(owner, micro, opts.reason)
        : await operator.grantToClient(owner, micro, opts.reason);

      console.log(`Granted ${dollars(micro)} to ${balance.ownerKind} ${balance.ownerKey}.`);
      console.log(`Balance is now ${dollars(balance.microDollars)}.`);
    })(opts as CliOptions);
  });

mycelCommand
  .command("balance <owner>")
  .description("Show a balance and the entries that make it up")
  .option("--application", "Treat <owner> as an Application rather than a Client")
  .option("--database <url>")
  .action(async (owner: string, opts: CliOptions & { application?: boolean }) => {
    await action(async () => {
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
    })(opts as CliOptions);
  });

// ── Supply ───────────────────────────────────────────────────────────────────

const supplier = mycelCommand.command("supplier").description("Parties that produce tokens");

supplier
  .command("register <id>")
  .description("Register a Supplier and issue its publishing credential")
  .option("--display-name <name>")
  .option("--base-url <url>", "Where the Exchange sends work (OpenAI-compatible)")
  .option(
    "--credential-env <name>",
    "Name of the env var holding the key we present upstream — the NAME, never the key",
  )
  .option("--guarantees <names>", "Guarantees this Supplier may publish under")
  .option("--database <url>")
  .action(async (id: string, opts: CliOptions) => {
    await action(async () => {
      if (!opts.baseUrl) throw new MycelCliError("Where does work go? Pass --base-url.");
      const operator = new Operator(openStore(opts));
      const { supplier: created, credential } = await operator.registerSupplier({
        id,
        displayName: opts.displayName ?? id,
        baseUrl: opts.baseUrl,
        upstreamCredentialEnv: opts.credentialEnv,
        grantedGuarantees: list(opts.guarantees),
      });

      console.log(`Registered supplier ${created.id} → ${created.baseUrl}`);
      console.log(
        `Granted guarantees: ${created.grantedGuarantees.join(", ") || "none"}` +
          " — the operator is liable for these, so a Supplier claiming more is refused.",
      );
      console.log(`\n  ${credential}\n`);
      console.log("Shown once. The agent presents it when publishing Offers.");
    })(opts);
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

offers
  .command("sync <supplierId>")
  .description("Publish a vendor's Models as Offers, on its behalf")
  .option("--models <names>", "Models to resell, comma-separated")
  .option("--capabilities <names>", "Applied to every Model", DEFAULT_VENDOR_CAPABILITIES.join(","))
  .option(
    "--watch <minutes>",
    "Keep republishing. A vendor runs no agent, so this IS its heartbeat",
  )
  .option("--database <url>")
  .action(async (supplierId: string, opts: CliOptions & { capabilities?: string; watch?: string }) => {
    await action(async () => {
      const models = list(opts.models);
      if (models.length === 0) {
        throw new MycelCliError(
          "Which Models? Pass --models.\n" +
            "  A curated list, not a whole catalogue: every Offer is a claim, and these\n" +
            "  are declared rather than probed.",
        );
      }

      const operator = new Operator(openStore(opts));
      const capabilities = list(opts.capabilities) as PublishedOffer["capabilities"];

      const publish = async () => {
        await operator.publishOffersFor(
          supplierId,
          models.map((model) => ({ model, capabilities, servingMode: "adapted" as const })),
        );
      };

      await publish();
      console.log(`Published ${models.length} offer(s) for ${supplierId}: ${models.join(", ")}`);
      console.log(`Capabilities (declared, not probed): ${capabilities.join(", ")}`);

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
    })(opts);
  });
