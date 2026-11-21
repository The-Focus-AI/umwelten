import { createServer } from "node:http";
import { resolve } from "node:path";
import { Command } from "commander";
import { sessionsCommand } from "@umwelten/sessions";
import { supplierCommand } from "@umwelten/supplier";
import { mycelCommand } from "@umwelten/mycel/command.js";
import { HabitatHost } from "@umwelten/habitat";

export const habitatCommand = new Command("habitat").description(
  "Host-agnostic DurableHabitat & HabitatHost runtime (pi-durable + A2A 1.0)",
);

habitatCommand
  .command("serve")
  .description("Serve a multi-Habitat DurableHabitat host over HTTP (A2A 1.0 + /health)")
  .option("-d, --data-dir <dir>", "Directory storing per-Habitat SQLite databases", "./habitats-data")
  .option("-p, --port <port>", "HTTP listen port", process.env.PORT ?? "7430")
  .option("--host <host>", "HTTP listen host", "127.0.0.1")
  .option("--provider <provider>", "Default Pi provider id", "google")
  .option("--model <model>", "Default Pi model id", "gemini-3-flash-preview")
  .action(
    async (opts: {
      dataDir: string;
      port: string;
      host: string;
      provider: string;
      model: string;
    }) => {
      const port = parseInt(opts.port, 10) || 7430;
      const rootDir = resolve(opts.dataDir);
      const host = new HabitatHost({
        dataDir: rootDir,
        defaultModel: { provider: opts.provider, modelId: opts.model },
      });

      const handler = host.createHttpHandler((id: string) => ({
        publicOrigin: `http://${opts.host}:${port}/habitats/${encodeURIComponent(id)}`,
      }));

      const server = createServer((req, res) => {
        handler(req, res).catch((err: unknown) => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        });
      });

      await new Promise<void>((r) => server.listen(port, opts.host, r));
      console.log(
        `[habitat] HabitatHost listening on http://${opts.host}:${port} (data: ${rootDir})`,
      );

      const shutdown = async () => {
        server.close();
        await host.closeAll();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    },
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
