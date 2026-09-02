import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Operator } from "../operator.js";
import type { ExchangeStore } from "../store/types.js";

const ROOT = "/api/customer";
const MAX_BODY_BYTES = 32_000;
const MAX_APPLICATIONS_PER_CLIENT = 20;
const ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"];

export interface CustomerIdentity {
  subject: string;
}

export interface CustomerHandlerOptions {
  store: ExchangeStore;
  verifyOperator?: (
    authorization: string | undefined,
  ) => Promise<CustomerIdentity>;
  clerkIssuer?: string;
  authorizedParties?: string[];
  defaultCreditLimitMicroDollars?: number;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
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
      try {
        resolve(JSON.parse(raw || "{}") as Record<string, unknown>);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
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
    return { subject: payload.sub };
  };
}

function publicApplication(
  application: Awaited<ReturnType<ExchangeStore["getApplication"]>>,
) {
  if (!application) return null;
  return {
    id: application.id,
    enabled: application.enabled,
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

  async function dashboard(subject: string) {
    const client = await ownedClient(subject);
    if (!client) return { onboarded: false };
    const applications = (await store.listApplications()).filter(
      (application) => application.clientId === client.id,
    );
    const [balance, ledger, requestGroups, applicationBalances] =
      await Promise.all([
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
    const caller = await identity(req, res);
    if (!caller) return true;

    if (path === ROOT && req.method === "GET") {
      sendJson(res, 200, await dashboard(caller.subject));
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
          createdAt: new Date(),
        });
        const created = await operator.createApplication({
          id: applicationIdFor(applicationName),
          clientId,
        });
        sendJson(res, 201, {
          credential: created.credential,
          dashboard: await dashboard(caller.subject),
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

    sendJson(res, 405, { error: "method_not_allowed" });
    return true;
  };
}
