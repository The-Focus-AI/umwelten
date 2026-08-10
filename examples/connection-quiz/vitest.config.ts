import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Self-contained so this example is not gated by the monorepo packages/* include.
// `root` is pinned to this directory so the config works from the repo root too:
//   pnpm vitest run --config examples/connection-quiz/vitest.config.ts
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ["*.test.ts"],
    environment: "node",
  },
});
