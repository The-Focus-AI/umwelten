/**
 * The second seam: publishing behaviour, against a fake Exchange.
 */

import { describe, it, expect } from "vitest";
import http from "node:http";
import { ExchangeClient } from "./exchange-client.js";
import type { OfferDraft } from "./types.js";

const DRAFT: OfferDraft = {
  model: "gemma-4-26b",
  capabilities: ["chat"],
  servingMode: "managed",
  headroom: [],
};

async function fakeExchange(
  respond: (body: Record<string, unknown>, res: http.ServerResponse) => void,
): Promise<{ url: string; bodies: Record<string, unknown>[]; close: () => Promise<void> }> {
  const bodies: Record<string, unknown>[] = [];
  const server = http.createServer(async (req, res) => {
    const raw = await new Promise<string>((resolve) => {
      let acc = "";
      req.on("data", (c) => (acc += c));
      req.on("end", () => resolve(acc));
    });
    const body = JSON.parse(raw || "{}");
    bodies.push(body);
    respond(body, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    bodies,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function ok(guarantees: string[] = []) {
  return (body: Record<string, unknown>, res: http.ServerResponse) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        supplierId: "office-spark",
        offers: (body.offers as unknown[]).length,
        guarantees,
      }),
    );
  };
}

describe("ExchangeClient", () => {
  it("publishes offers with the credential", async () => {
    const exchange = await fakeExchange(ok(["on-premise"]));
    const client = new ExchangeClient({
      exchangeUrl: exchange.url,
      credential: "secret",
    });

    const result = await client.publish([DRAFT], ["on-premise"]);
    expect(result.ok).toBe(true);
    expect(result.offers).toBe(1);
    expect(exchange.bodies[0].guarantees).toEqual(["on-premise"]);
    await exchange.close();
  });

  it("reports back what the operator actually granted", async () => {
    // So an agent can confirm what it is offered under rather than assume its
    // own config was honored.
    const exchange = await fakeExchange(ok(["no-training"]));
    const client = new ExchangeClient({ exchangeUrl: exchange.url, credential: "s" });

    const result = await client.publish([DRAFT], ["no-training"]);
    expect(result.guarantees).toEqual(["no-training"]);
    await exchange.close();
  });

  it("surfaces a rejected guarantee rather than swallowing it", async () => {
    // A Supplier that believes it is on-premise and is not needs to hear.
    const exchange = await fakeExchange((_body, res) => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "guarantee_not_granted",
          guarantee: "fips-140",
          message: "Supplier is not granted the guarantee \"fips-140\".",
        }),
      );
    });
    const client = new ExchangeClient({ exchangeUrl: exchange.url, credential: "s" });

    const result = await client.publish([DRAFT], ["fips-140"]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toBe("guarantee_not_granted");
    expect(result.message).toContain("fips-140");
    await exchange.close();
  });

  it("reports an unreachable Exchange without throwing", async () => {
    // A machine whose Exchange is down should keep running and retry, not die.
    const client = new ExchangeClient({
      exchangeUrl: "http://127.0.0.1:1",
      credential: "s",
    });

    const result = await client.publish([DRAFT], []);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unreachable");
    await client.withdraw();
  });

  it("withdraws by publishing an empty set", async () => {
    // Publishing is total, so an empty set removes everything. A clean
    // shutdown says so immediately rather than leaving the Exchange to notice
    // a machine has gone quiet.
    const exchange = await fakeExchange(ok());
    const client = new ExchangeClient({ exchangeUrl: exchange.url, credential: "s" });

    await client.publish([DRAFT], []);
    await client.withdraw();

    expect(exchange.bodies).toHaveLength(2);
    expect(exchange.bodies[1].offers).toEqual([]);
    await exchange.close();
  });

  it("republishing sends the whole set, not a delta", async () => {
    const exchange = await fakeExchange(ok());
    const client = new ExchangeClient({ exchangeUrl: exchange.url, credential: "s" });

    await client.publish([DRAFT, { ...DRAFT, model: "other" }], []);
    await client.publish([DRAFT], []);

    expect((exchange.bodies[0].offers as unknown[]).length).toBe(2);
    expect((exchange.bodies[1].offers as unknown[]).length).toBe(1);
    await exchange.close();
  });

  it("tolerates a trailing slash on the Exchange URL", async () => {
    const exchange = await fakeExchange(ok());
    const client = new ExchangeClient({ exchangeUrl: `${exchange.url}/`, credential: "s" });

    const result = await client.publish([DRAFT], []);
    expect(result.ok).toBe(true);
    await exchange.close();
  });
});
