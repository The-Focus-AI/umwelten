import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Operator } from "../operator.js";
import type { ExchangeStore } from "../store/types.js";
import type { BuyerHandler } from "../buyer/handler.js";

const ROOT = "/api/customer";
const MAX_BODY_BYTES = 32_000;
const MAX_APPLICATIONS_PER_CLIENT = 20;
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_FUNDING_CENTS = 500;
const MAX_FUNDING_CENTS = 500_000;
const ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"];
const ADMIN_ROLE = "admin";

export interface CustomerIdentity {
  subject: string;
  /** Role copied from Clerk publicMetadata into the signed session token. */
  role?: string;
}

export interface CustomerHandlerOptions {
  store: ExchangeStore;
  verifyOperator?: (
    authorization: string | undefined,
  ) => Promise<CustomerIdentity>;
  clerkIssuer?: string;
  authorizedParties?: string[];
  /** Process-local entry into the normal buyer pipeline for the playground. */
  completeChat?: BuyerHandler["handleAs"];
  defaultCreditLimitMicroDollars?: number;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  publicOrigin?: string;
  fetch?: typeof fetch;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", (chunk: Buffer | string) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      resolve(raw);
    });
    req.on("error", reject);
  });
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  try {
    return JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
}

function requiredName(
  body: Record<string, unknown>,
  key: string,
  max: number,
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`invalid_${key}`);
  }
  return value.trim();
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  return normalized || "application";
}

function clientIdFor(subject: string): string {
  return `client-${createHash("sha256").update(subject).digest("hex").slice(0, 16)}`;
}

function applicationIdFor(name: string): string {
  return `${slug(name)}-${randomBytes(4).toString("hex")}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);
  const timestampSeconds = Number(timestamp);
  if (
    !timestamp ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(now / 1000 - timestampSeconds) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();
  return signatures.some((signature) => {
    try {
      const actual = Buffer.from(signature, "hex");
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    } catch {
      return false;
    }
  });
}

function bearer(authorization: string | undefined): string | null {
  const [scheme, token] = authorization?.split(" ", 2) ?? [];
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export function createClerkOperatorVerifier(opts: {
  issuer: string;
  authorizedParties: string[];
}): (authorization: string | undefined) => Promise<CustomerIdentity> {
  const issuer = opts.issuer.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const parties = new Set(opts.authorizedParties);
  return async (authorization) => {
    const token = bearer(authorization);
    if (!token) throw new Error("unauthorized");
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      algorithms: ALGORITHMS,
      clockTolerance: 5,
    });
    if (!payload.sub) throw new Error("unauthorized");
    const authorizedParty = payload.azp;
    if (
      parties.size > 0 &&
      (typeof authorizedParty !== "string" || !parties.has(authorizedParty))
    ) {
      throw new Error("unauthorized");
    }
    const metadata = payload.metadata;
    const role =
      metadata &&
      typeof metadata === "object" &&
      "role" in metadata &&
      typeof metadata.role === "string"
        ? metadata.role
        : undefined;
    return { subject: payload.sub, role };
  };
}

function publicApplication(
  application: Awaited<ReturnType<ExchangeStore["getApplication"]>>,
) {
  if (!application) return null;
  return {
    id: application.id,
    enabled: application.enabled,
    hasCredential: Boolean(application.credentialHash),
    createdAt: application.createdAt,
    requiredGuarantees: application.requiredGuarantees,
    allowedModels: application.allowedModels,
  };
}

export function createCustomerHandler(opts: CustomerHandlerOptions) {
  const { store } = opts;
  const operator = new Operator(store);
  const authorizedParties = (opts.authorizedParties ?? []).filter(Boolean);
  const verifyOperator =
    opts.verifyOperator ??
    (opts.clerkIssuer && authorizedParties.length > 0
      ? createClerkOperatorVerifier({
          issuer: opts.clerkIssuer,
          authorizedParties,
        })
      : null);
  const configuredCreditLimit = opts.defaultCreditLimitMicroDollars ?? 0;
  const defaultCreditLimit =
    Number.isSafeInteger(configuredCreditLimit) && configuredCreditLimit >= 0
      ? configuredCreditLimit
      : 0;
  const stripeConfigured = Boolean(
    opts.stripeSecretKey && opts.stripeWebhookSecret && opts.publicOrigin,
  );
  const fetchImpl = opts.fetch ?? fetch;

  async function identity(req: IncomingMessage, res: ServerResponse) {
    if (!verifyOperator) {
      sendJson(res, 503, { error: "customer_auth_not_configured" });
      return null;
    }
    try {
      return await verifyOperator(req.headers.authorization);
    } catch {
      sendJson(res, 401, { error: "unauthorized" });
      return null;
    }
  }

  async function ownedClient(subject: string) {
    const link = await store.getClientOperator(subject);
    return link ? store.getClient(link.clientId) : null;
  }

  async function callerLink(subject: string) {
    return store.getClientOperator(subject);
  }

  async function dashboard(subject: string, canAdminGrant = false) {
    const link = await callerLink(subject);
    const client = link ? await store.getClient(link.clientId) : null;
    if (!client || !link)
      return {
        onboarded: false,
        fundingConfigured: stripeConfigured,
        canAdminGrant,
      };
    const applications = (await store.listApplications()).filter(
      (application) => application.clientId === client.id,
    );
    const [
      balance,
      ledger,
      requestGroups,
      applicationBalances,
      operators,
      invitations,
    ] = await Promise.all([
      store.getBalance("client", client.id),
      store.listLedgerEntries("client", client.id),
      Promise.all(
        applications.map((application) =>
          store.listRequests({ applicationId: application.id }),
        ),
      ),
      Promise.all(
        applications.map((application) =>
          store.getBalance("application", application.id),
        ),
      ),
      store.listClientOperators(client.id),
      store.listClientInvitations(client.id),
    ]);
    const requests = requestGroups
      .flat()
      .sort(
        (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
      )
      .slice(0, 100)
      .map((request) => ({
        id: request.id,
        applicationId: request.applicationId,
        subject: request.subject,
        model: request.model,
        promptTokens: request.promptTokens,
        completionTokens: request.completionTokens,
        charge: request.charge,
        outcome: request.outcome,
        startedAt: request.startedAt,
        finishedAt: request.finishedAt,
      }));
    return {
      onboarded: true,
      client,
      operator: link,
      operators,
      invitations: invitations
        .filter((invitation) => invitation.expiresAt > new Date())
        .map(({ id, createdAt, expiresAt }) => ({ id, createdAt, expiresAt })),
      fundingConfigured: stripeConfigured,
      canAdminGrant,
      balance,
      ledger,
      applications: applications.map((application, index) => ({
        ...publicApplication(application),
        balance: applicationBalances[index],
      })),
      requests,
    };
  }

  return async function handleCustomer(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const path = (req.url ?? "").split("?", 1)[0];
    if (path !== ROOT && !path.startsWith(`${ROOT}/`)) return false;

    if (path === `${ROOT}/stripe/webhook` && req.method === "POST") {
      if (!opts.stripeWebhookSecret) {
        sendJson(res, 503, { error: "funding_not_configured" });
        return true;
      }
      try {
        const rawBody = await readBody(req);
        const signature = Array.isArray(req.headers["stripe-signature"])
          ? req.headers["stripe-signature"][0]
          : req.headers["stripe-signature"];
        if (
          !verifyStripeSignature(rawBody, signature, opts.stripeWebhookSecret)
        ) {
          sendJson(res, 400, { error: "invalid_signature" });
          return true;
        }
        const event = JSON.parse(rawBody) as {
          id?: unknown;
          type?: unknown;
          created?: unknown;
          data?: { object?: Record<string, unknown> };
        };
        if (
          event.type !== "checkout.session.completed" &&
          event.type !== "checkout.session.async_payment_succeeded"
        ) {
          sendJson(res, 200, { received: true });
          return true;
        }
        const session = event.data?.object;
        const metadata = session?.metadata as
          Record<string, unknown> | undefined;
        const clientId = metadata?.client_id;
        const cents = session?.amount_total;
        if (session?.payment_status !== "paid") {
          sendJson(res, 200, { received: true, credited: false });
          return true;
        }
        if (
          typeof event.id !== "string" ||
          typeof clientId !== "string" ||
          typeof cents !== "number" ||
          !Number.isSafeInteger(cents) ||
          cents < MIN_FUNDING_CENTS ||
          cents > MAX_FUNDING_CENTS ||
          !(await store.getClient(clientId))
        ) {
          sendJson(res, 400, { error: "invalid_payment_event" });
          return true;
        }
        const result = await store.creditClientPayment({
          provider: "stripe",
          eventId: event.id,
          clientId,
          microDollars: cents * 10_000,
          createdAt:
            typeof event.created === "number"
              ? new Date(event.created * 1000)
              : new Date(),
        });
        sendJson(res, 200, { received: true, credited: result.credited });
      } catch {
        sendJson(res, 400, { error: "invalid_payment_event" });
      }
      return true;
    }

    const caller = await identity(req, res);
    if (!caller) return true;

    if (path === ROOT && req.method === "GET") {
      sendJson(
        res,
        200,
        await dashboard(caller.subject, caller.role === ADMIN_ROLE),
      );
      return true;
    }

    const playground = path.match(
      /^\/api\/customer\/applications\/([^/]+)\/playground$/,
    );
    if (playground && req.method === "POST") {
      const client = await ownedClient(caller.subject);
      const application = await store.getApplication(
        decodeURIComponent(playground[1]),
      );
      if (!client || !application || application.clientId !== client.id) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      if (!application.enabled) {
        sendJson(res, 409, { error: "application_disabled" });
        return true;
      }
      if (!opts.completeChat) {
        sendJson(res, 503, { error: "playground_not_configured" });
        return true;
      }
      // The Clerk subject is stable within this Application and keeps
      // playground spend visible as its own End User. No Application
      // credential reaches or is recoverable by the browser.
      return opts.completeChat(
        { application, subject: `playground:${caller.subject}` },
        req,
        res,
      );
    }

    if (path === `${ROOT}/admin/grants` && req.method === "POST") {
      const link = await callerLink(caller.subject);
      if (caller.role !== ADMIN_ROLE) {
        sendJson(res, 403, { error: "admin_required" });
        return true;
      }
      if (!link) {
        sendJson(res, 409, { error: "onboarding_required" });
        return true;
      }
      try {
        const body = await readJson(req);
        const amountCents = body.amountCents;
        const reason = requiredName(body, "reason", 200);
        if (
          typeof amountCents !== "number" ||
          !Number.isSafeInteger(amountCents) ||
          amountCents < 1 ||
          amountCents > MAX_FUNDING_CENTS
        ) {
          sendJson(res, 400, { error: "invalid_amount" });
          return true;
        }
        await operator.grantToClient(
          link.clientId,
          amountCents * 10_000,
          `admin grant by ${caller.subject}: ${reason}`,
        );
        sendJson(res, 201, {
          dashboard: await dashboard(caller.subject, true),
        });
      } catch (error) {
        const invalid =
          error instanceof Error && error.message.startsWith("invalid_");
        sendJson(res, invalid ? 400 : 500, {
          error: invalid ? error.message : "grant_failed",
        });
      }
      return true;
    }

    if (path === `${ROOT}/onboard` && req.method === "POST") {
      if (await ownedClient(caller.subject)) {
        sendJson(res, 409, { error: "already_onboarded" });
        return true;
      }
      try {
        const body = await readJson(req);
        const clientName = requiredName(body, "clientName", 120);
        const applicationName = requiredName(body, "applicationName", 80);
        const clientId = clientIdFor(caller.subject);
        await store.createClient({
          id: clientId,
          name: clientName,
          creditLimitMicroDollars: defaultCreditLimit,
        });
        await store.linkClientOperator({
          subject: caller.subject,
          clientId,
          role: "owner",
          createdAt: new Date(),
        });
        const created = await operator.createApplication({
          id: applicationIdFor(applicationName),
          clientId,
        });
        sendJson(res, 201, {
          credential: created.credential,
          dashboard: await dashboard(
            caller.subject,
            caller.role === ADMIN_ROLE,
          ),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const invalidInput = message.startsWith("invalid_");
        sendJson(res, invalidInput ? 400 : 500, {
          error: invalidInput ? message : "onboarding_failed",
        });
      }
      return true;
    }

    if (path === `${ROOT}/invitations/accept` && req.method === "POST") {
      if (await callerLink(caller.subject)) {
        sendJson(res, 409, { error: "already_onboarded" });
        return true;
      }
      try {
        const token = requiredName(await readJson(req), "token", 256);
        const linked = await store.acceptClientInvitation(
          hash(token),
          caller.subject,
          new Date(),
        );
        if (!linked) {
          sendJson(res, 404, { error: "invitation_invalid_or_expired" });
          return true;
        }
        sendJson(res, 200, {
          dashboard: await dashboard(
            caller.subject,
            caller.role === ADMIN_ROLE,
          ),
        });
      } catch (error) {
        const invalid =
          error instanceof Error && error.message.startsWith("invalid_");
        sendJson(res, invalid ? 400 : 500, {
          error: invalid ? "invalid_token" : "invitation_acceptance_failed",
        });
      }
      return true;
    }

    if (path === `${ROOT}/invitations` && req.method === "POST") {
      const link = await callerLink(caller.subject);
      if (!link || link.role !== "owner") {
        sendJson(res, 403, { error: "owner_required" });
        return true;
      }
      const token = `invite-mycel-${randomBytes(24).toString("base64url")}`;
      const createdAt = new Date();
      const invitation = {
        id: `invite-${randomBytes(8).toString("hex")}`,
        clientId: link.clientId,
        tokenHash: hash(token),
        createdBySubject: caller.subject,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + INVITATION_TTL_MS),
      };
      await store.createClientInvitation(invitation);
      sendJson(res, 201, {
        invitation: {
          id: invitation.id,
          token,
          expiresAt: invitation.expiresAt,
        },
      });
      return true;
    }

    const memberRemoval = path.match(/^\/api\/customer\/operators\/([^/]+)$/);
    if (memberRemoval && req.method === "DELETE") {
      const link = await callerLink(caller.subject);
      const subject = decodeURIComponent(memberRemoval[1]);
      const target = await callerLink(subject);
      if (!link || link.role !== "owner") {
        sendJson(res, 403, { error: "owner_required" });
      } else if (!target || target.clientId !== link.clientId) {
        sendJson(res, 404, { error: "not_found" });
      } else if (target.role === "owner") {
        sendJson(res, 409, { error: "owner_cannot_be_removed" });
      } else {
        await store.unlinkClientOperator(subject);
        sendJson(res, 200, {
          dashboard: await dashboard(
            caller.subject,
            caller.role === ADMIN_ROLE,
          ),
        });
      }
      return true;
    }

    if (path === `${ROOT}/funding/checkout` && req.method === "POST") {
      const link = await callerLink(caller.subject);
      if (!link) {
        sendJson(res, 409, { error: "onboarding_required" });
        return true;
      }
      if (!stripeConfigured) {
        sendJson(res, 503, { error: "funding_not_configured" });
        return true;
      }
      try {
        const cents = (await readJson(req)).amountCents;
        if (
          typeof cents !== "number" ||
          !Number.isSafeInteger(cents) ||
          cents < MIN_FUNDING_CENTS ||
          cents > MAX_FUNDING_CENTS
        ) {
          sendJson(res, 400, { error: "invalid_amount" });
          return true;
        }
        const fields = new URLSearchParams({
          mode: "payment",
          success_url: `${opts.publicOrigin}/account/?funding=success`,
          cancel_url: `${opts.publicOrigin}/account/?funding=cancelled`,
          client_reference_id: link.clientId,
          "metadata[client_id]": link.clientId,
          "line_items[0][quantity]": "1",
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][unit_amount]": String(cents),
          "line_items[0][price_data][product_data][name]": "Mycel credits",
          "invoice_creation[enabled]": "true",
          customer_creation: "always",
        });
        const response = await fetchImpl(
          "https://api.stripe.com/v1/checkout/sessions",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${opts.stripeSecretKey}`,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: fields,
          },
        );
        const result = (await response.json()) as { url?: unknown };
        if (!response.ok || typeof result.url !== "string")
          throw new Error("checkout_failed");
        sendJson(res, 201, { url: result.url });
      } catch {
        sendJson(res, 502, { error: "checkout_failed" });
      }
      return true;
    }

    if (path === `${ROOT}/applications` && req.method === "POST") {
      const client = await ownedClient(caller.subject);
      if (!client) {
        sendJson(res, 409, { error: "onboarding_required" });
        return true;
      }
      const applicationCount = (await store.listApplications()).filter(
        (application) => application.clientId === client.id,
      ).length;
      if (applicationCount >= MAX_APPLICATIONS_PER_CLIENT) {
        sendJson(res, 409, { error: "application_limit_reached" });
        return true;
      }
      try {
        const body = await readJson(req);
        const applicationName = requiredName(body, "applicationName", 80);
        const created = await operator.createApplication({
          id: applicationIdFor(applicationName),
          clientId: client.id,
        });
        sendJson(res, 201, {
          application: publicApplication(created.application),
          credential: created.credential,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const invalidInput = message.startsWith("invalid_");
        sendJson(res, invalidInput ? 400 : 500, {
          error: invalidInput ? message : "application_creation_failed",
        });
      }
      return true;
    }

    const rotation = path.match(
      /^\/api\/customer\/applications\/([^/]+)\/rotate$/,
    );
    if (rotation && req.method === "POST") {
      const client = await ownedClient(caller.subject);
      const application = await store.getApplication(
        decodeURIComponent(rotation[1]),
      );
      if (!client || !application || application.clientId !== client.id) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      const credential = await operator.rotateApplicationCredential(
        application.id,
      );
      sendJson(res, 200, {
        application: publicApplication(application),
        credential,
      });
      return true;
    }

    const credentialRevocation = path.match(
      /^\/api\/customer\/applications\/([^/]+)\/revoke$/,
    );
    if (credentialRevocation && req.method === "POST") {
      const client = await ownedClient(caller.subject);
      const application = await store.getApplication(
        decodeURIComponent(credentialRevocation[1]),
      );
      if (!client || !application || application.clientId !== client.id) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      await store.setApplicationCredentialHash(application.id);
      sendJson(res, 200, {
        application: publicApplication({
          ...application,
          credentialHash: undefined,
        }),
      });
      return true;
    }

    const enabledUpdate = path.match(
      /^\/api\/customer\/applications\/([^/]+)\/enabled$/,
    );
    if (enabledUpdate && req.method === "POST") {
      const client = await ownedClient(caller.subject);
      const application = await store.getApplication(
        decodeURIComponent(enabledUpdate[1]),
      );
      if (!client || !application || application.clientId !== client.id) {
        sendJson(res, 404, { error: "not_found" });
        return true;
      }
      try {
        const enabled = (await readJson(req)).enabled;
        if (typeof enabled !== "boolean") throw new Error("invalid_enabled");
        await operator.setApplicationEnabled(application.id, enabled);
        sendJson(res, 200, {
          application: publicApplication({ ...application, enabled }),
        });
      } catch {
        sendJson(res, 400, { error: "invalid_enabled" });
      }
      return true;
    }

    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  };
}
