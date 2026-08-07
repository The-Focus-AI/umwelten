#!/usr/bin/env node
/**
 * The whole path, end to end: a habitat's model call reaching a Supplier
 * through the Exchange, metered and charged on the way.
 *
 *   umwelten Interaction
 *     → core's `exchange` provider (HTTP, imports nothing from the package)
 *       → the Exchange (auth, dispatch, metering, balances)
 *         → a mock Supplier
 *
 * This lives in `examples/` because it is the only place allowed to import both
 * `@umwelten/core` and `@umwelten/mycel`. Core sits at the root of the
 * dependency DAG — a test inside either package could not span the seam without
 * creating the repo's first cycle, which is exactly the constraint the seam
 * exists to enforce.
 *
 * Run:  pnpm tsx examples/mycel-e2e/run.ts
 */

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { createMycelProvider } from "@umwelten/core/providers/mycel.js";
import { MemoryStore } from "@umwelten/mycel/store/memory-store.js";
import { Operator } from "@umwelten/mycel/operator.js";
import { Balances, applicationOwner, endUserOwner } from "@umwelten/mycel/metering/balances.js";
import { createIdentityVerifier } from "@umwelten/mycel/auth/identity.js";
import { createExchangeServer } from "@umwelten/mycel/server.js";
import { startMockUpstream } from "@umwelten/mycel/testing/mock-upstream.js";

const log = (...parts: unknown[]) => console.log(parts.join(" "));
const MODEL = "gemma-4-26b";

async function main() {
  // ── A Supplier: a stand-in for a DGX behind a tunnel ────────────────
  const supplierBox = await startMockUpstream("ok");

  const store = new MemoryStore();
  await store.setup();

  const operator = new Operator(store);
  const { credential } = await operator.registerSupplier({
    id: "office-spark",
    displayName: "Office DGX Spark",
    baseUrl: supplierBox.baseUrl,
    grantedGuarantees: ["on-premise", "no-training"],
  });

  // ── An Application, with its own signing key ────────────────────────
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);

  // The Application publishes its keys; here we hand the Exchange a local key
  // set instead of standing up a JWKS endpoint for a demo.
  const keySet = createLocalJWKSet({ keys: [publicJwk] });

  await store.createClient({ id: "acme", name: "Acme" });
  await store.createApplication({
    id: "hairstyle-app",
    clientId: "acme",
    jwksUrl: "https://hairstyle.example/.well-known/jwks.json",
    requiredGuarantees: ["on-premise"],
    enabled: true,
    createdAt: new Date(),
  });

  const exchange = await createExchangeServer({
    store,
    port: 0,
    host: "127.0.0.1",
    verifyCaller: createIdentityVerifier({ store, makeKeySet: () => keySet }),
  });
  log(`Exchange listening at ${exchange.url}`);

  // ── The supplier agent publishes what it probed ─────────────────────
  const publish = await fetch(`${exchange.url}/suppliers/offers`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
    body: JSON.stringify({
      guarantees: ["on-premise"],
      offers: [
        {
          model: MODEL,
          capabilities: ["chat", "streaming", "tool-calling"],
          servingMode: "managed",
          contextTokens: 131072,
        },
      ],
    }),
  });
  log(`Published offers: ${publish.status}`, JSON.stringify(await publish.json()));

  // ── Fund an End User ────────────────────────────────────────────────
  const balances = new Balances(store);
  const owner = endUserOwner({
    application: (await store.getApplication("hairstyle-app"))!,
    subject: "user-1",
  });
  await balances.grant(owner, 10_000_000, "signup");
  log(`Granted user-1 ${(await balances.get(owner)).microDollars} micro-dollars`);

  // ── umwelten calls it, knowing nothing about Suppliers ──────────────
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer("hairstyle-app")
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const provider = createMycelProvider(token, exchange.url);

  const catalogue = await provider.listModels();
  log(`\nCatalogue: ${catalogue.map((m) => m.name).join(", ")}`);
  log(
    `  retail $${catalogue[0]?.costs?.promptTokens}/M prompt, ` +
      `$${catalogue[0]?.costs?.completionTokens}/M completion`,
  );

  const interaction = new Interaction(
    { name: MODEL, provider: "mycel" },
    new Stimulus({ role: "a helpful assistant" }),
  );
  // The provider registry resolves credentials from the environment.
  process.env.MYCEL_API_KEY = token;
  process.env.MYCEL_URL = exchange.url;
  interaction.addMessage({ role: "user", content: "Say something brief." });

  const response = await interaction.streamText();
  log(`\nResponse: ${JSON.stringify(response.content.slice(0, 80))}`);

  // ── What the Exchange recorded ──────────────────────────────────────
  const [record] = await store.listRequests();
  log(`\nRequest record:`);
  log(`  application  ${record.applicationId}  subject ${record.subject}`);
  log(`  served by    ${record.supplierId} (${record.model})`);
  log(`  tokens       ${record.promptTokens} prompt / ${record.completionTokens} completion`);
  log(`  cost         ${record.cost} micro-dollars (owned hardware)`);
  log(`  charge       ${record.charge} micro-dollars`);
  log(`  balance left ${(await balances.get(owner)).microDollars}`);

  // ── The other way in: a caller that cannot serve a JWKS ─────────────
  //
  // A habitat, a script, a small client. It presents a static credential and
  // states its End User in a header. What must hold is exactly what held for
  // the JWT — the Application is authenticated and the subject is scoped to it
  // — because the JWT never authenticated the End User either (ADR 0014).
  const habitat = await operator.createApplication({
    id: "help-habitat",
    clientId: "acme",
  });
  // Funding the Application is enough. A charge falls through End User →
  // Application → Client, stopping at the first that has ever had a ledger
  // entry, so a subject nobody has granted anything draws from the pool behind
  // it. Granting a subject directly is how you cap it instead.
  await balances.grant(applicationOwner("help-habitat"), 5_000_000, "stage-1 float");

  const direct = await fetch(`${exchange.url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${habitat.credential}`,
      "x-mycel-end-user": "operator",
    },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hi" }] }),
  });
  log(`
Static credential: HTTP ${direct.status}`);

  const forHabitat = (await store.listRequests()).filter(
    (r) => r.applicationId === "help-habitat",
  );
  log(`  attributed to  ${forHabitat[0]?.applicationId} / ${forHabitat[0]?.subject}`);
  log(`  charged        ${forHabitat[0]?.charge} micro-dollars`);

  // Without the header there is no subject, and no implicit fallback to the
  // Application's own id — otherwise a caller that forgot it would have its
  // whole estate attributed to one user and per-user caps would quietly stop
  // being per-user.
  const noSubject = await fetch(`${exchange.url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${habitat.credential}`,
    },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hi" }] }),
  });
  log(`  no end-user →  HTTP ${noSubject.status} (refused)`);

  await exchange.close();
  await supplierBox.close();
  // Local providers install a global undici dispatcher whose keep-alive sockets
  // hold the event loop open; everything above has already resolved.
  process.exit(0);
}

void main();
