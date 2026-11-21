import { createServer } from "node:http";
import { resolve } from "node:path";
import { Command } from "commander";
import { sessionsCommand } from "@umwelten/sessions";
import { supplierCommand } from "@umwelten/supplier";
import { mycelCommand } from "@umwelten/mycel/command.js";
import { GaiaHost, parseBearerKeys } from "@umwelten/habitat";

export const habitatCommand = new Command("habitat").description(
  "Host-agnostic DurableHabitat & GaiaHost runtime (pi-durable + A2A 1.0)",
);

interface HostCliOptions {
  dataDir: string;
  port: string;
  host: string;
  provider: string;
  model: string;
  publicUrl?: string;
  baseDomain?: string;
  apiKey?: string;
  jwksUrl?: string;
  authAudience?: string;
}

async function runGaiaHostCommand(opts: HostCliOptions) {
  const port = parseInt(opts.port, 10) || 7420;
  const rootDir = resolve(opts.dataDir);
  const hostnameEnv = process.env.GAIA_HOSTNAME?.trim();
  const publicUrl =
    opts.publicUrl?.trim() ||
    (hostnameEnv ? `https://${hostnameEnv.replace(/^https?:\/\//, "")}` : undefined);

  const apiKeys = parseBearerKeys(
    opts.apiKey ?? process.env.GAIA_API_KEY ?? process.env.HABITAT_API_KEY,
  );
  const jwksUrl =
    opts.jwksUrl?.trim() ||
    process.env.GAIA_JWKS_URL?.trim() ||
    process.env.HABITAT_AUTH_JWKS_URL?.trim() ||
    undefined;
  const authAudience =
    opts.authAudience?.trim() ||
    process.env.GAIA_AUTH_AUDIENCE?.trim() ||
    process.env.HABITAT_AUTH_AUDIENCE?.trim() ||
    undefined;

  const gaia = await GaiaHost.open({
    dataDir: rootDir,
    defaultModel: { provider: opts.provider, modelId: opts.model },
    publicUrl,
    baseDomain: opts.baseDomain ?? process.env.GAIA_BASE_DOMAIN,
    apiKeys,
    jwksUrl,
    authAudiences: authAudience ? [authAudience] : undefined,
  });

  const server = createServer((req, res) => {
    gaia.handleRequest(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  });

  await new Promise<void>((r) => server.listen(port, opts.host, r));
  console.log(
    `[gaia] Gaia HabitatHost (pi-durable) listening on http://${opts.host}:${port} ` +
      `(data: ${rootDir}, model: ${opts.provider}/${opts.model}, auth: ${gaia.auth.mode})`,
  );

  const shutdown = async () => {
    server.close();
    await gaia.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function attachHostOptions(cmd: Command, defaultPort: string) {
  return cmd
    .option(
      "-d, --data-dir <dir>",
      "Directory storing habitats-registry.json and habitats/<id>/habitat.sqlite",
      process.env.HABITAT_WORK_DIR ?? "./habitats-data",
    )
    .option(
      "-p, --port <port>",
      "HTTP listen port",
      process.env.GAIA_PORT ?? process.env.PORT ?? defaultPort,
    )
    .option("--host <host>", "HTTP listen host", "0.0.0.0")
    .option(
      "--provider <provider>",
      "Default Pi provider id",
      process.env.GAIA_PROVIDER ?? "mycel",
    )
    .option(
      "--model <model>",
      "Default Pi model id",
      process.env.GAIA_MODEL ?? "default",
    )
    .option("--public-url <url>", "Public HTTPS origin for A2A Agent Cards")
    .option("--base-domain <domain>", "Optional wildcard domain for <id>.<domain> routing")
    .option("--api-key <keys>", "Comma-separated static bearer API keys")
    .option("--jwks-url <url>", "JWKS URL for per-speaker JWT verification")
    .option("--auth-audience <aud>", "Expected JWT audience")
    .action(runGaiaHostCommand);
}

attachHostOptions(
  habitatCommand
    .command("gaia")
    .description("Run the single-process Gaia HabitatHost (pi-durable + A2A 1.0 + /api/habitats)"),
  "7420",
);

attachHostOptions(
  habitatCommand
    .command("serve")
    .description("Serve a multi-Habitat GaiaHost over HTTP (alias of `habitat gaia`)"),
  "7430",
);

export const program = new Command("umwelten")
  .version("0.6.0")
  .description(
    "Model evaluations, cross-harness session sensemaking, DurableHabitats, and the Mycel Token Exchange — built on Pi and Pi Durable",
  );

program.addCommand(sessionsCommand);
program.addCommand(habitatCommand);
program.addCommand(supplierCommand);
program.addCommand(mycelCommand);
