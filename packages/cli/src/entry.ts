#!/usr/bin/env node
import "@umwelten/pi";
import { program } from "./cli.js";

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
