import { tool } from "ai";
import { z } from "zod";

/**
 * Custom habitat tool, factory form.
 *
 * The habitat passes itself in as `context`, so a real tool can read secrets
 * (`habitat.getSecret(...)`) or call other habitat APIs. This one is a trivial
 * pure tool — it just shows the TOOL.md + handler.ts shape the loader expects.
 */
export default (_habitat: unknown) =>
  tool({
    description: "Flip a fair coin. Returns heads or tails.",
    parameters: z.object({}),
    execute: async () => {
      const result = Math.random() < 0.5 ? "heads" : "tails";
      return { result };
    },
  });
