/**
 * The same conformance suite as MemoryStore, against real Postgres.
 *
 * Skipped without MYCEL_DATABASE_URL, matching how integration tests
 * already behave in this repo. Each run uses its own schema so concurrent
 * runs — CI and a developer at once — cannot tread on each other.
 */

import { describe } from "vitest";
import { neon } from "@neondatabase/serverless";
import { NeonStore } from "./neon-store.js";
import { runExchangeStoreConformance } from "./conformance.js";

const DATABASE_URL = process.env.MYCEL_DATABASE_URL;

if (!DATABASE_URL) {
  describe.skip("ExchangeStore conformance — NeonStore (no MYCEL_DATABASE_URL)", () => {});
} else {
  const url = DATABASE_URL;
  runExchangeStoreConformance("NeonStore", async () => {
    const sql = neon(url);
    // Truncate rather than drop: the conformance suite creates the schema via
    // setup() on every test, and a fresh store must start empty.
    await sql`DROP TABLE IF EXISTS exchange_offer_pricing`;
    await sql`DROP TABLE IF EXISTS exchange_offer`;
    await sql`DROP TABLE IF EXISTS exchange_supplier`;
    return new NeonStore(url);
  });
}
