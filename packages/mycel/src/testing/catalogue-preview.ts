/** Local-only review fixture. Never imported by the exchange entrypoint. */
import http from "node:http";
import { createAccountSurfaceHandler } from "../client-surface/serve.js";
import { createCustomerHandler } from "../customer/handler.js";
import { MemoryStore } from "../store/memory-store.js";
import { DEFAULT_PRICING } from "../types.js";

const store = new MemoryStore();
await store.createSupplier({
  id: "demo",
  displayName: "Demo vendor (simulated)",
  kind: "vendor",
  baseUrl: "https://demo.invalid/v1",
  credentialHash: "demo-unused",
  grantedGuarantees: [],
  enabled: true,
  createdAt: new Date(),
});
await store.createSupplier({
  id: "agent",
  displayName: "Office agent (offline)",
  kind: "agent",
  baseUrl: "",
  credentialHash: "agent-unused",
  grantedGuarantees: [],
  enabled: true,
  createdAt: new Date(),
});
await store.createClient({ id: "demo-client", name: "Local catalogue review" });
await store.linkClientOperator({
  subject: "demo-admin",
  clientId: "demo-client",
  role: "owner",
  createdAt: new Date(),
});
await store.saveAdminOffer(
  "demo",
  {
    model: "whisper-large-v3",
    capabilities: ["transcription"],
    servingMode: "adapted",
  },
  {
    ...DEFAULT_PRICING,
    operationPricing: {
      transcription: {
        inputUnit: "second",
        outputUnit: "token",
        wholesaleInputPerMillion: 100_000_000,
        wholesaleOutputPerMillion: 0,
        retailInputPerMillion: 130_000_000,
        retailOutputPerMillion: 0,
      },
    },
  },
  true,
  new Date(),
);
await store.saveAdminOffer(
  "demo",
  { model: "chat-small", capabilities: ["chat"], servingMode: "adapted" },
  DEFAULT_PRICING,
  false,
  new Date(),
);
const surface = createAccountSurfaceHandler();
const customer = createCustomerHandler({
  store,
  verifyOperator: async (authorization) => {
    if (authorization === "Bearer demo-admin")
      return { subject: "demo-admin", role: "admin" };
    if (authorization === "Bearer demo-member")
      return { subject: "demo-member", role: "member" };
    throw new Error("unauthorized");
  },
  // Every probe is simulated. No keys, real provider requests, database, or billing.
  fetch: async (_url, init) => {
    const model =
      init?.body instanceof FormData
        ? init.body.get("model")
        : JSON.parse(String(init?.body ?? "{}")).model;
    if (String(model).includes("fail"))
      return Response.json(
        { error: "Simulated unsupported model" },
        { status: 400 },
      );
    return Response.json({
      text: "",
      duration: 1,
      choices: [{ message: { content: "OK" } }],
      data: [{ embedding: [0.2, -0.7], b64_json: "ZGVtbw==" }],
    });
  },
});
const auth = `import { authKey } from "/account/components/account-services.js";
export default { name: "account-authentication", apply(ctx) {
  const role = new URLSearchParams(location.search).get("role") || "admin";
  const state = { loading: false, available: true, signedIn: role !== "anonymous" };
  ctx.provide(authKey, { snapshot: () => state, subscribe(fn) { fn(state); return () => {}; },
    getToken: async () => "demo-" + role, signIn: () => location.assign("?role=admin"), signUp: () => {},
    mountUserButton(el) { el.textContent = "LOCAL DEMO · " + role + " · no production data"; }, unmountUserButton() {} });
} };`;
http
  .createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: [] }));
      return;
    }
    if ((req.url ?? "").split("?")[0] === "/assets/account-authentication.js") {
      res.writeHead(200, { "content-type": "text/javascript" }).end(auth);
      return;
    }
    if (req.url === "/") {
      res.writeHead(302, { location: "/account/" }).end();
      return;
    }
    if ((await surface(req, res)) || (await customer(req, res))) return;
    res.writeHead(404).end();
  })
  .listen(Number(process.env.PORT ?? 7439), "0.0.0.0", () =>
    console.log("Local catalogue preview ready; all probes simulated."),
  );
