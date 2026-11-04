/** Durable, metadata-only operational conditions. No agent or administrative tools. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  GaiaHabitatEntry,
  ContainerStatus,
  ContainerHealthStatus,
} from "./types.js";
import type { HostResourceSnapshot } from "./host-resources.js";
import {
  buildAnnouncement,
  type AnnounceOutcome,
  type SaasRegistryConfig,
} from "./saas-registry.js";

export const OPERATIONS_STALE_MS = 120_000;
const RETENTION_MS = 7 * 86_400_000;
const messages = {
  "runtime-unavailable": "Container status could not be verified.",
  "runtime-unhealthy": "The running container is failing its health check.",
  "runtime-errors":
    "Recent HTTP requests, tools or agent turns reported errors.",
  "runtime-stopped":
    "The container exited unexpectedly; operator review is required.",
  "runtime-paused": "The container is paused or restarting.",
  "telemetry-unavailable":
    "Operational telemetry is unavailable; task and execution health are unknown.",
  "waiting-input":
    "Tasks are waiting for input or authorization; this is not abandoned work.",
  "long-running":
    "Active tasks have not reported progress for over 30 minutes; inspect before interrupting.",
  "execution-errors": "Recent model executions reported errors.",
  "execution-unknown":
    "Execution records are absent or truncated; usage and error counts are incomplete.",
  "execution-slow": "Recent model executions exceeded two minutes.",
  "configuration-incomplete": "Required environment variables are missing.",
  "registration-destination":
    "SaaS registration needs an explicit organization and workspace decision.",
  "registration-auth":
    "SaaS registration authorization was rejected; operator action is required.",
  "registration-rejected":
    "SaaS registration was rejected; review configuration before retrying.",
  "registration-transient":
    "SaaS registration is temporarily unavailable; bounded retry is scheduled.",
  "registration-unconfigured":
    "The SaaS registry integration is not configured.",
  "registration-removal":
    "The habitat was removed from Gaia; a workspace owner must detach its SaaS attachment.",
  "host-pressure": "Host memory or disk capacity is under pressure.",
  "host-unavailable": "Host resource health could not be measured.",
  "backup-unknown":
    "Backup freshness and restore guarantees have not been verified.",
  "watchdog-unknown":
    "An independent external outage watchdog has not been verified.",
  "recovery-failed":
    "The policy-authorized recovery attempt failed; operator review is required.",
} as const;
type Code = keyof typeof messages;
const codeSchema = z.enum(Object.keys(messages) as [Code, ...Code[]]);
const conditionSchema = z.object({
  id: z.string(),
  subject: z.string(),
  code: codeSchema,
  severity: z.enum(["info", "warning", "error"]),
  state: z.enum(["active", "resolved"]),
  summary: z.string(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  occurrences: z.number().int().positive(),
});
export type OperationalCondition = z.infer<typeof conditionSchema>;
const investigationSchema = z.object({
  conditionId: z.string(),
  at: z.string().datetime(),
  diagnosis: z.string(),
  decision: z.string(),
});
const registrationSchema = z.object({
  fingerprint: z.string(),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number(),
  blocked: z.boolean(),
});
const actionSchema = z.object({
  subject: z.string(),
  at: z.string().datetime(),
  action: z.literal("restart-unhealthy"),
  outcome: z.enum(["attempted", "failed", "pending-verification", "verified"]),
});
const stateSchema = z.object({
  version: z.literal(1),
  observedAt: z.string().datetime().nullable(),
  conditions: z.array(conditionSchema),
  investigations: z.array(investigationSchema),
  pendingInvestigations: z.array(z.string()).default([]),
  registrations: z.record(z.string(), registrationSchema),
  actions: z.array(actionSchema),
  observations: z
    .record(
      z.string(),
      z.object({
        observedAt: z.string().datetime(),
        runtime: z.string(),
        telemetry: z.lazy(() => telemetrySchema).optional(),
      }),
    )
    .default({}),
});
type State = z.infer<typeof stateSchema>;

export const telemetrySchema = z.object({
  version: z.literal(1),
  observedAt: z.string().datetime(),
  tasks: z.object({
    active: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    oldestActiveAt: z.string().datetime().nullable(),
  }),
  executions: z.object({
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    slow: z.number().int().nonnegative(),
    tokens: z.number().nonnegative(),
    cost: z.number().nonnegative(),
    available: z.boolean(),
    truncated: z.boolean(),
  }),
  runtimeErrors: z.number().int().nonnegative().default(0),
  configurationReady: z.boolean(),
});
export type OperationalTelemetry = z.infer<typeof telemetrySchema>;

export interface OperationsDeps {
  file: string;
  listEntries: () => GaiaHabitatEntry[];
  getStatus: (id: string) => Promise<ContainerStatus>;
  getHealthStatus: (id: string) => Promise<ContainerHealthStatus>;
  telemetry: (entry: GaiaHabitatEntry) => Promise<OperationalTelemetry>;
  resources: () => Promise<HostResourceSnapshot>;
  registryConfig: () => SaasRegistryConfig | null;
  announce: (
    entry: GaiaHabitatEntry,
    config: SaasRegistryConfig,
  ) => Promise<AnnounceOutcome>;
  /** This must be an explicit deployment policy, never a diagnostic decision. */
  recoveryEnabled?: boolean;
  restart?: (id: string) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

export class GaiaOperations {
  private state: State = {
    version: 1,
    observedAt: null,
    conditions: [],
    investigations: [],
    pendingInvestigations: [],
    registrations: {},
    actions: [],
    observations: {},
  };
  private timer?: ReturnType<typeof setInterval>;
  private pass?: Promise<void>;
  private healthyPersistence = true;
  private readonly now: () => number;
  private readonly failures = new Map<string, number>();
  constructor(private readonly deps: OperationsDeps) {
    this.now = deps.now ?? Date.now;
  }

  async load(): Promise<void> {
    try {
      this.state = stateSchema.parse(
        JSON.parse(await readFile(this.deps.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  /** Explicit operator retry, not an automatic bypass of a blocked 4xx. */
  async retryRegistration(id?: string) {
    await this.pass;
    for (const [subject, registration] of Object.entries(
      this.state.registrations,
    )) {
      if (!id || subject === id) {
        registration.blocked = false;
        registration.nextAttemptAt = 0;
      }
    }
    await this.tick();
    return this.snapshot(id);
  }

  start(): void {
    if (this.timer) return;
    const run = () =>
      void this.tick().catch(() =>
        this.deps.log?.(
          "[operations] Observation failed; status is stale until a successful pass.",
        ),
      );
    run();
    this.timer = setInterval(run, 30_000);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.pass;
  }

  snapshot(subject?: string) {
    const observedAt = subject
      ? (this.state.observations[subject]?.observedAt ?? null)
      : this.state.observedAt;
    const summary = {
      version: 1 as const,
      observedAt,
      stale:
        !this.healthyPersistence ||
        !observedAt ||
        Date.parse(observedAt) > this.now() ||
        this.now() - Date.parse(observedAt) > OPERATIONS_STALE_MS,
      // Project from fixed messages, never persisted free text, for the child surface.
      conditions: this.state.conditions
        .filter((c) => !subject || c.subject === subject)
        .map((c) => ({ ...c, summary: messages[c.code] })),
    };
    return subject
      ? summary
      : {
          ...summary,
          investigations: structuredClone(this.state.investigations),
          actions: structuredClone(this.state.actions),
          observations: structuredClone(this.state.observations),
          recoveryEnabled: this.deps.recoveryEnabled === true,
        };
  }

  tick(): Promise<void> {
    if (!this.pass)
      this.pass = this.observe().finally(() => {
        this.pass = undefined;
      });
    return this.pass;
  }

  private condition(
    subject: string,
    code: Code,
    active: boolean,
    severity: OperationalCondition["severity"] = "warning",
  ) {
    const id = `${subject}:${code}`;
    const at = new Date(this.now()).toISOString();
    let current = this.state.conditions.find((c) => c.id === id);
    if (!active) {
      if (current?.state === "active") {
        current.state = "resolved";
        current.resolvedAt = at;
        current.lastSeenAt = at;
      }
      return;
    }
    if (current?.state === "active") {
      current.lastSeenAt = at;
      current.occurrences++;
      return;
    }
    if (current)
      this.state.conditions = this.state.conditions.filter((c) => c.id !== id);
    current = {
      id,
      subject,
      code,
      severity,
      state: "active",
      summary: messages[code],
      firstSeenAt: at,
      lastSeenAt: at,
      occurrences: 1,
    };
    this.state.conditions.push(current);
    if (severity !== "info" && !this.state.pendingInvestigations.includes(id))
      this.state.pendingInvestigations.push(id);
  }

  private investigate() {
    // Separate bounded read-only jobs, resumed from durable state. They correlate
    // metadata, not conversation content. No model or administrative capability
    // is available to this worker, even when the operator agent has those tools.
    for (const id of this.state.pendingInvestigations.splice(0, 4)) {
      const condition = this.state.conditions.find(
        (c) => c.id === id && c.state === "active",
      );
      if (!condition) continue;
      const { code, subject } = condition;
      const related = this.state.conditions.filter(
        (c) => c.state === "active" && c.code === code,
      ).length;
      const pressure = this.state.conditions.some(
        (c) => c.state === "active" && c.code === "host-pressure",
      );
      const observation = this.state.observations[subject];
      const tasks = observation?.telemetry?.tasks;
      this.state.investigations.push({
        conditionId: id,
        at: new Date(this.now()).toISOString(),
        diagnosis: `${messages[code]} Same condition on ${related} subjects. Runtime: ${observation?.runtime ?? "unknown"}. ${tasks ? `${tasks.active} active tasks/turns; ${tasks.waiting} waiting tasks.` : "Task safety unknown."}${pressure ? " Host pressure is also present; correlation is not proof of cause." : ""}`,
        decision:
          code === "registration-destination"
            ? "Operator must select an existing organization and workspace; do not infer ownership or restart the habitat."
            : code === "registration-transient"
              ? "Retry the same destination with bounded backoff; do not change credentials or grants."
              : code === "runtime-unhealthy"
                ? "Only explicit recovery policy may restart, after task safety and cooldown checks; verify health on a later pass."
                : "Read the structured health evidence. Changes to access, credentials, images, configuration or data require operator approval.",
      });
    }
  }

  private async persist() {
    this.state.investigations = this.state.investigations.slice(-200);
    this.state.actions = this.state.actions.slice(-200);
    this.state.conditions = this.state.conditions.filter(
      (c) =>
        c.state === "active" ||
        this.now() - Date.parse(c.resolvedAt!) < RETENTION_MS,
    );
    try {
      await mkdir(dirname(this.deps.file), { recursive: true });
      await writeFile(`${this.deps.file}.tmp`, JSON.stringify(this.state), {
        mode: 0o600,
      });
      await rename(`${this.deps.file}.tmp`, this.deps.file);
      this.healthyPersistence = true;
    } catch (error) {
      this.healthyPersistence = false;
      throw error;
    }
  }

  private async observe() {
    const entries = this.deps.listEntries();
    const ids = new Set(entries.map((e) => e.id));
    this.state.conditions = this.state.conditions.filter(
      (c) =>
        c.subject === "gaia" ||
        ids.has(c.subject) ||
        c.code === "registration-removal",
    );
    for (const id of Object.keys(this.state.registrations))
      if (!ids.has(id)) {
        this.condition(id, "registration-removal", true);
        delete this.state.registrations[id];
        delete this.state.observations[id];
      }
    this.condition("gaia", "backup-unknown", true, "info");
    this.condition("gaia", "watchdog-unknown", true, "info");
    try {
      const resources = await this.deps.resources();
      this.condition("gaia", "host-pressure", resources.warnings.length > 0);
      this.condition("gaia", "host-unavailable", false);
    } catch {
      this.condition("gaia", "host-unavailable", true);
    }
    // Bounded read concurrency, followed by serialized persistent actions.
    for (let index = 0; index < entries.length; index += 4) {
      await Promise.all(
        entries
          .slice(index, index + 4)
          .map((entry) => this.observeChild(entry)),
      );
    }
    for (const entry of entries) await this.recover(entry);
    // Registration is serialized and persisted after every attempt, so a Gaia
    // restart neither forgets a 409 nor resets a transient retry budget.
    for (const entry of entries) await this.reconcile(entry);
    this.investigate();
    this.state.observedAt = new Date(this.now()).toISOString();
    await this.persist();
  }

  private async observeChild(entry: GaiaHabitatEntry) {
    const id = entry.id;
    let status: ContainerStatus;
    try {
      status = await this.deps.getStatus(id);
      this.condition(id, "runtime-unavailable", false);
    } catch {
      this.failures.delete(id);
      this.state.observations[id] = {
        observedAt: new Date(this.now()).toISOString(),
        runtime: "unknown",
      };
      this.condition(id, "runtime-unavailable", true);
      return;
    }
    this.state.observations[id] = {
      observedAt: new Date(this.now()).toISOString(),
      runtime: status === "not-found" ? "dormant" : status,
    };
    this.condition(id, "registration-removal", false);
    this.condition(id, "runtime-stopped", ["exited", "dead"].includes(status));
    this.condition(
      id,
      "runtime-paused",
      ["paused", "restarting", "created"].includes(status),
    );
    if (status !== "running") {
      // The reaper removes its container but retains containerPort. Absence is
      // intentional dormancy, never authority to bring capacity back online.
      this.failures.delete(id);
      // Retain last-known failures: stopping is not proof of recovery.
      return;
    }
    let unhealthy = false;
    try {
      const health = await this.deps.getHealthStatus(id);
      unhealthy = health === "unhealthy";
      this.condition(id, "runtime-unavailable", health === "not-found");
      if (unhealthy || health === "healthy")
        this.condition(id, "runtime-unhealthy", unhealthy, "error");
      if (health === "healthy") {
        for (const action of this.state.actions.filter(
          (a) => a.subject === id && a.outcome === "pending-verification",
        ))
          action.outcome = "verified";
        this.condition(id, "recovery-failed", false);
      }
    } catch {
      this.condition(id, "runtime-unavailable", true);
    }
    try {
      const telemetry = telemetrySchema.parse(await this.deps.telemetry(entry));
      if (
        Math.abs(this.now() - Date.parse(telemetry.observedAt)) >
        OPERATIONS_STALE_MS
      )
        throw new Error("stale");
      this.state.observations[id].telemetry = telemetry;
      this.condition(id, "telemetry-unavailable", false);
      this.condition(id, "waiting-input", telemetry.tasks.waiting > 0, "info");
      this.condition(
        id,
        "long-running",
        telemetry.tasks.active > 0 &&
          !!telemetry.tasks.oldestActiveAt &&
          this.now() - Date.parse(telemetry.tasks.oldestActiveAt) > 30 * 60_000,
      );
      this.condition(id, "execution-errors", telemetry.executions.errors > 0);
      this.condition(id, "runtime-errors", telemetry.runtimeErrors > 0);
      this.condition(
        id,
        "execution-unknown",
        !telemetry.executions.available || telemetry.executions.truncated,
        "info",
      );
      this.condition(id, "execution-slow", telemetry.executions.slow > 0);
      this.condition(
        id,
        "configuration-incomplete",
        !telemetry.configurationReady,
      );
    } catch {
      this.condition(id, "telemetry-unavailable", true);
    }
    const failures = unhealthy ? (this.failures.get(id) ?? 0) + 1 : 0;
    this.failures.set(id, failures);
  }

  private async recover(entry: GaiaHabitatEntry) {
    const id = entry.id;
    const telemetry = this.state.observations[id]?.telemetry;
    if (
      !this.deps.recoveryEnabled ||
      !this.deps.restart ||
      (this.failures.get(id) ?? 0) < 3 ||
      !telemetry ||
      telemetry.tasks.active ||
      telemetry.tasks.waiting
    )
      return;
    // Reserve the action durably BEFORE changing runtime state. A crash after
    // Docker accepts the request must not produce a restart loop on recovery.
    const recent = this.state.actions.filter(
      (a) => this.now() - Date.parse(a.at) < 86_400_000,
    );
    if (
      recent.length >= 3 ||
      recent.some(
        (a) => a.subject === id && this.now() - Date.parse(a.at) < 3_600_000,
      )
    )
      return;
    if ((await this.deps.getStatus(id)) !== "running") return;
    // Work may have arrived since observation. Unknown/failing probes deny recovery.
    try {
      const fresh = telemetrySchema.parse(await this.deps.telemetry(entry));
      if (
        fresh.tasks.active ||
        fresh.tasks.waiting ||
        Math.abs(this.now() - Date.parse(fresh.observedAt)) >
          OPERATIONS_STALE_MS
      )
        return;
    } catch {
      return;
    }
    const action: State["actions"][number] = {
      subject: id,
      at: new Date(this.now()).toISOString(),
      action: "restart-unhealthy",
      outcome: "attempted",
    };
    this.state.actions.push(action);
    await this.persist();
    try {
      await this.deps.restart(id);
      action.outcome = "pending-verification";
    } catch {
      action.outcome = "failed";
      this.condition(id, "recovery-failed", true, "error");
    }
    await this.persist();
  }

  private async reconcile(entry: GaiaHabitatEntry) {
    const config = this.deps.registryConfig();
    this.condition(entry.id, "registration-unconfigured", !config, "info");
    if (!config) return;
    const payload = buildAnnouncement(entry, config);
    if (!payload) return;
    // Never let an apparently unambiguous receiver choose tenant ownership.
    if (!entry.saasRegistration && !config.workspace) {
      this.condition(entry.id, "registration-destination", true, "error");
      return;
    }
    // Fingerprint stays operator-private and is never returned by any API.
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([config, payload]))
      .digest("hex");
    const previous = this.state.registrations[entry.id];
    if (
      previous?.fingerprint === fingerprint &&
      (previous.blocked || this.now() < previous.nextAttemptAt)
    )
      return;
    const result = await this.deps.announce(entry, config);
    const status = result.ok === false ? result.status : undefined;
    const blocked =
      result.ok === false &&
      status !== undefined &&
      status >= 400 &&
      status < 500 &&
      status !== 408 &&
      status !== 429;
    const attempts =
      result.ok === true
        ? 0
        : (previous?.fingerprint === fingerprint ? previous.attempts : 0) + 1;
    this.state.registrations[entry.id] = {
      fingerprint,
      attempts,
      blocked,
      nextAttemptAt:
        this.now() +
        (result.ok === true
          ? 15 * 60_000
          : Math.min(30 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 6))),
    };
    const code =
      result.ok !== false
        ? undefined
        : status === 409
          ? "registration-destination"
          : status === 401 || status === 403
            ? "registration-auth"
            : blocked
              ? "registration-rejected"
              : "registration-transient";
    for (const c of [
      "registration-destination",
      "registration-auth",
      "registration-rejected",
      "registration-transient",
    ] as const)
      this.condition(
        entry.id,
        c,
        c === code,
        c === "registration-transient" ? "warning" : "error",
      );
    await this.persist();
  }
}
