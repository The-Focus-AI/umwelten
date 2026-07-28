/**
 * The supply surface, driven in-process.
 *
 * Assertions are on what a Supplier observes — status codes, bodies, and what
 * ends up dispatchable — never on how the handler got there. Prior art for the
 * fabricated request/response shape is `mcp-serve/mount.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MemoryStore } from "../store/memory-store.js";
import { createSupplyHandler, hashCredential, SUPPLY_PATH } from "./handler.js";
import { supplierFixture } from "../store/conformance.js";

const CREDENTIAL = "supplier-secret";

function fakeRes() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
    },
  } as unknown as ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    get json() {
      return body ? JSON.parse(body) : undefined;
    },
  };
}

/**
 * A real lazy Readable rather than an EventEmitter that fires on a timer.
 *
 * The handler authenticates before it reads the body, so anything that emits
 * eagerly has already fired `end` by the time the body listeners attach, and
 * the read hangs forever. `Readable.from` only produces once something reads.
 */
function fakeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: string,
): IncomingMessage {
  const req = Readable.from(body === undefined ? [] : [body]) as unknown as IncomingMessage;
  Object.assign(req, { method, url, headers });
  return req;
}

function publishBody(offers: unknown[]): string {
  return JSON.stringify({ offers });
}

const VALID_OFFER = {
  model: "gemma-4-26b",
  capabilities: ["chat", "streaming", "tool-calling"],
  servingMode: "managed",
  headroom: [{ concurrency: 1, ttftMs: 300, tokensPerSecond: 94, decodeTokensPerSecond: 114 }],
  contextTokens: 131072,
};

describe("supply surface", () => {
  let store: MemoryStore;
  let handle: ReturnType<typeof createSupplyHandler>;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.setup();
    await store.createSupplier(
      supplierFixture({ credentialHash: hashCredential(CREDENTIAL) }),
    );
    handle = createSupplyHandler({ store });
  });

  async function publish(
    body: string,
    credential: string | null = CREDENTIAL,
  ): Promise<ReturnType<typeof fakeRes>> {
    const out = fakeRes();
    const headers: Record<string, string> = credential
      ? { authorization: `Bearer ${credential}` }
      : {};
    await handle(fakeReq("POST", SUPPLY_PATH, headers, body), out.res);
    return out;
  }

  describe("routing", () => {
    it("does not consume requests for other paths", async () => {
      const out = fakeRes();
      const consumed = await handle(fakeReq("POST", "/v1/chat/completions"), out.res);
      expect(consumed).toBe(false);
    });

    it("refuses a non-POST on its own path", async () => {
      const out = fakeRes();
      await handle(fakeReq("GET", SUPPLY_PATH), out.res);
      expect(out.status).toBe(405);
    });
  });

  describe("authentication", () => {
    it("accepts a valid credential", async () => {
      const out = await publish(publishBody([VALID_OFFER]));
      expect(out.status).toBe(200);
      expect(out.json).toEqual({ supplierId: "office-spark", offers: 1 });
    });

    it("refuses a missing credential", async () => {
      const out = await publish(publishBody([VALID_OFFER]), null);
      expect(out.status).toBe(401);
      expect(await store.listOffers()).toEqual([]);
    });

    it("refuses an unknown credential", async () => {
      const out = await publish(publishBody([VALID_OFFER]), "not-the-secret");
      expect(out.status).toBe(401);
      expect(await store.listOffers()).toEqual([]);
    });

    it("tells a disabled supplier apart from a wrong credential", async () => {
      // An operator debugging a machine that has gone quiet needs to
      // distinguish "your key is wrong" from "I took you out of rotation".
      await store.setSupplierEnabled("office-spark", false);
      const out = await publish(publishBody([VALID_OFFER]));
      expect(out.status).toBe(403);
      expect(out.json.error).toBe("supplier_disabled");
    });
  });

  describe("publishing", () => {
    it("makes published offers dispatchable", async () => {
      await publish(publishBody([VALID_OFFER]));

      const offers = await store.listOffers();
      expect(offers).toHaveLength(1);
      expect(offers[0].model).toBe("gemma-4-26b");
      expect(offers[0].capabilities).toEqual(["chat", "streaming", "tool-calling"]);
      expect(offers[0].servingMode).toBe("managed");
      expect(offers[0].headroom[0].tokensPerSecond).toBe(94);
    });

    it("replaces rather than accumulates on republish", async () => {
      await publish(publishBody([VALID_OFFER, { ...VALID_OFFER, model: "gemma-4-31b" }]));
      await publish(publishBody([VALID_OFFER]));

      const offers = await store.listOffers();
      expect(offers.map((o) => o.model)).toEqual(["gemma-4-26b"]);
    });

    it("accepts an empty publish as a full withdrawal", async () => {
      await publish(publishBody([VALID_OFFER]));
      const out = await publish(publishBody([]));

      expect(out.status).toBe(200);
      expect(await store.listOffers()).toEqual([]);
    });

    it("does not disturb another supplier", async () => {
      await store.createSupplier(
        supplierFixture({ id: "vendor", credentialHash: hashCredential("vendor-secret") }),
      );
      await publish(publishBody([{ ...VALID_OFFER, model: "gpt-5-nano" }]), "vendor-secret");
      await publish(publishBody([VALID_OFFER]));

      const offers = await store.listOffers();
      expect(offers.map((o) => `${o.supplierId}:${o.model}`)).toEqual([
        "office-spark:gemma-4-26b",
        "vendor:gpt-5-nano",
      ]);
    });
  });

  describe("suppliers do not set prices", () => {
    // ADR 0007: price is the Exchange's routing lever. Rejecting rather than
    // ignoring matters — a silently dropped field lets a Supplier believe its
    // price was honored.
    it.each(["retailPromptPerMillion", "wholesaleCompletionPerMillion", "price", "costPerToken"])(
      "refuses a published offer carrying %s",
      async (field) => {
        const out = await publish(publishBody([{ ...VALID_OFFER, [field]: 1 }]));
        expect(out.status).toBe(400);
        expect(out.json.error).toBe("price_not_accepted");
        expect(await store.listOffers()).toEqual([]);
      },
    );

    it("applies default pricing to what it accepts", async () => {
      await publish(publishBody([VALID_OFFER]));
      const offers = await store.listOffers();
      expect(offers[0].wholesalePromptPerMillion).toBe(0);
      expect(offers[0].retailPromptPerMillion).toBeGreaterThan(0);
    });
  });

  describe("payload validation", () => {
    it("refuses invalid JSON", async () => {
      const out = await publish("{ not json");
      expect(out.status).toBe(400);
      expect(out.json.error).toBe("invalid_json");
    });

    it("refuses a body with no offers array", async () => {
      const out = await publish(JSON.stringify({ suppliers: [] }));
      expect(out.status).toBe(400);
      expect(out.json.error).toBe("invalid_body");
    });

    it("refuses an offer with no model", async () => {
      const out = await publish(publishBody([{ ...VALID_OFFER, model: undefined }]));
      expect(out.status).toBe(400);
    });

    it("refuses an unknown serving mode", async () => {
      const out = await publish(publishBody([{ ...VALID_OFFER, servingMode: "somehow" }]));
      expect(out.status).toBe(400);
    });

    it("refuses an unknown capability rather than storing it", async () => {
      // Capabilities are a closed set that Dispatch filters on. An unrecognised
      // one is either a probe bug or a version skew, and both want to be loud.
      const out = await publish(
        publishBody([{ ...VALID_OFFER, capabilities: ["chat", "telepathy"] }]),
      );
      expect(out.status).toBe(400);
      expect(out.json.error).toBe("unknown_capability");
    });

    it("leaves the previous offer set intact when a publish is rejected", async () => {
      await publish(publishBody([VALID_OFFER]));
      await publish(publishBody([{ ...VALID_OFFER, servingMode: "somehow" }]));

      const offers = await store.listOffers();
      expect(offers.map((o) => o.model)).toEqual(["gemma-4-26b"]);
    });
  });
});
