/**
 * Live catalogue check against a real vendor. Never imported by the entrypoint.
 *
 *   dotenvx run -- pnpm exec tsx packages/mycel/src/testing/probe-catalogue-model.ts inception/mercury-3
 *
 * Needs OPENROUTER_API_KEY. Optional OPENROUTER_BASE_URL (default
 * https://openrouter.ai/api/v1). Prints findings and exits 1 unless chat passed.
 */
import { MemoryStore } from "../store/memory-store.js";
import { createCatalogue } from "../customer/catalogue.js";

const model = process.argv[2]?.trim();
if (!model) {
  console.error(
    "Usage: dotenvx run -- pnpm exec tsx packages/mycel/src/testing/probe-catalogue-model.ts <model-id>",
  );
  process.exit(2);
}

const credential = process.env.OPENROUTER_API_KEY;
if (!credential) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(2);
}

const baseUrl = (
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"
).replace(/\/$/, "");

const store = new MemoryStore();
await store.createSupplier({
  id: "openrouter",
  displayName: "OpenRouter (live probe)",
  kind: "vendor",
  baseUrl,
  credentialHash: "live-probe-unused",
  upstreamCredentialEnv: "OPENROUTER_API_KEY",
  grantedGuarantees: [],
  enabled: true,
  createdAt: new Date(),
});

const catalogue = createCatalogue(store, {
  readCredential: (name) =>
    name === "OPENROUTER_API_KEY" ? credential : process.env[name],
});

console.log(`Checking ${model} via ${baseUrl} …`);
const started = Date.now();
try {
  const result = await catalogue.check({
    supplierId: "openrouter",
    model,
    confirmPaidProbe: true,
  });
  const offer = (await store.getOffer("openrouter", model)) ?? null;
  console.log(
    JSON.stringify(
      {
        elapsedMs: Date.now() - started,
        findings: result.findings,
        offer: offer
          ? {
              capabilities: offer.capabilities,
              enabled: offer.enabled,
              verifiedAt: offer.verifiedAt,
            }
          : null,
      },
      null,
      2,
    ),
  );
  const chat = result.findings?.find(
    (finding: { operation: string }) => finding.operation === "chat",
  );
  if (chat?.judgment !== "pass") {
    console.error("Chat did not pass.");
    process.exit(1);
  }
} catch (error) {
  const findings =
    error && typeof error === "object" && "findings" in error
      ? (error as { findings: unknown }).findings
      : undefined;
  console.error(
    JSON.stringify(
      {
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        findings,
        offer: await store.getOffer("openrouter", model),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
