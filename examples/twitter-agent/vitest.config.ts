import { defineConfig } from "vitest/config";

// Self-contained config so this example does not inherit the monorepo root
// vitest config (which only scans packages/*). Run: `pnpm test:run`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
