/**
 * Stateful, live-streaming `InteractiveCodingSession` controller on
 * `@earendil-works/pi-durable`.
 *
 * Powers both the interactive Web Workbench (`pnpm run bench:ui`) and the
 * interactive terminal REPL (`pnpm run bench:interactive`):
 *   - Starts an isolated git checkout + `Harness` with `CodingTools` + extensions
 *   - Streams real-time `partial`, `turn_start`, `assistant_turn`, `tool_start`,
 *     `tool_end`, and `graded` events via `Conversation.watch()` + trace hooks
 *   - Grades safely against held-out hidden tests in temporary snapshots so the
 *     live checkout stays uncontaminated for inspection and follow-up conversation
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  clampThinkingLevel,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import {
  createRegistry,
  Harness,
  LiveDoc,
  MemoryStorage,
  type Conversation,
  type ConversationWatch,
  type Cursor,
  type EntryRecord,
  type LiveState,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  canonicalizeThinkingEffort,
  formatModelSpecString,
  resolvePiModel,
  resolveThinkingStreamOptions,
  type ModelSpec,
  type ResolvedPiInvocationTarget,
} from "@umwelten/pi";
import {
  createSessionTraceExtension,
  resolveCodingExtensionStack,
} from "./extensions.js";
import {
  aggregateSessionMetrics,
  buildAgentInstructions,
  buildCodingCacheKey,
  defaultMaxTurns,
  defaultTimeoutMs,
  ensureModelRegistered,
  isLocalSpec,
} from "./runner.js";
import type {
  CodingFollowUpResult,
  CodingSessionEvent,
  CodingSessionRecord,
  CodingSessionStatus,
  CodingTaskSpec,
  InteractiveCodingSessionOptions,
} from "./types.js";
import {
  computeTaskHash,
  getWorkspaceDiff,
  gradeWorkspaceSnapshot,
  type PreparedCheckout,
  prepareIsolatedGitCheckout,
} from "./workspace.js";

const DEFAULT_INTERACTIVE_OUTPUT_DIR = path.join(
  "output",
  "evaluations",
  "coding-bench",
  "runs",
  "001",
);

export class InteractiveCodingSession {
  readonly id: string;
  readonly task: CodingTaskSpec;
  readonly spec: ModelSpec;
  readonly effort: string;
  readonly effectiveThinkingLevel: string;
  readonly extensionProfile: string;
  readonly workspaceDir: string;
  readonly taskHash: string;
  readonly events: CodingSessionEvent[] = [];

  status: CodingSessionStatus = "idle";
  initialRecord?: CodingSessionRecord;
  latestRecord?: CodingSessionRecord;

  private readonly target: ResolvedPiInvocationTarget;
  private readonly checkout: PreparedCheckout;
  private harness: Harness | undefined;
  private readonly conv: Conversation;
  private watch: ConversationWatch | undefined;
  private readonly extensionCleanup: () => Promise<void>;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly outputDir: string;
  private readonly listeners = new Set<(event: CodingSessionEvent) => void>();
  private activeAbortRequested = false;

  private constructor(params: {
    id: string;
    task: CodingTaskSpec;
    spec: ModelSpec;
    effort: string;
    effectiveThinkingLevel: string;
    extensionProfile: string;
    taskHash: string;
    target: ResolvedPiInvocationTarget;
    checkout: PreparedCheckout;
    harness: Harness;
    conv: Conversation;
    watch: ConversationWatch;
    extensionCleanup: () => Promise<void>;
    maxTurns: number;
    timeoutMs: number;
    outputDir: string;
  }) {
    this.id = params.id;
    this.task = params.task;
    this.spec = params.spec;
    this.effort = params.effort;
    this.effectiveThinkingLevel = params.effectiveThinkingLevel;
    this.extensionProfile = params.extensionProfile;
    this.taskHash = params.taskHash;
    this.workspaceDir = params.checkout.dir;
    this.target = params.target;
    this.checkout = params.checkout;
    this.harness = params.harness;
    this.conv = params.conv;
    this.watch = params.watch;
    this.extensionCleanup = params.extensionCleanup;
    this.maxTurns = params.maxTurns;
    this.timeoutMs = params.timeoutMs;
    this.outputDir = params.outputDir;
  }

  private emit(event: CodingSessionEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Isolate failing UI subscribers from session lifecycle
      }
    }
  }

  private setStatus(status: CodingSessionStatus, error?: string): void {
    this.status = status;
    this.emit({
      type: "status",
      status,
      ...(error ? { error } : {}),
      timestamp: Date.now(),
    });
  }

  subscribe(
    listener: (event: CodingSessionEvent) => void,
    options?: { replay?: boolean },
  ): () => void {
    if (options?.replay) {
      for (const ev of this.events) {
        listener(ev);
      }
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  static async start(
    options: InteractiveCodingSessionOptions,
  ): Promise<InteractiveCodingSession> {
    const id = options.id ?? crypto.randomUUID().slice(0, 8);
    const { task, spec } = options;
    const maxTurns =
      options.maxTurns ?? task.maxTurns ?? defaultMaxTurns(task.difficulty);
    const timeoutMs =
      options.timeoutMs ?? task.timeoutMs ?? defaultTimeoutMs(task.difficulty);
    const outputDir = options.outputDir ?? DEFAULT_INTERACTIVE_OUTPUT_DIR;

    const taskHash = await computeTaskHash(task);
    const target = options.overrideTarget ?? (await resolvePiModel(spec));
    const localTarget = isLocalSpec(spec, target.piModel);
    const canonicalEffort = canonicalizeThinkingEffort(spec.reasoningEffort);
    const thinking = resolveThinkingStreamOptions(
      target.piModel,
      spec.provider,
      spec.reasoningEffort,
    );

    const checkout = await prepareIsolatedGitCheckout(task.repoDir);
    let harness: Harness | undefined;
    let watch: ConversationWatch | undefined;
    let cleanupExt: (() => Promise<void>) | undefined;

    // Buffer early events during construction so constructor can instantiate first
    let sessionRef: InteractiveCodingSession | undefined;
    const pendingEvents: CodingSessionEvent[] = [];
    const dispatchEvent = (ev: CodingSessionEvent) => {
      if (sessionRef) sessionRef.emit(ev);
      else pendingEvents.push(ev);
    };

    try {
      const stack = await resolveCodingExtensionStack({
        names: options.extensionNames,
        customPaths: options.customExtensionPaths,
        extraExtensions: [
          ...(options.extraExtensions ?? []),
          createSessionTraceExtension(target.piModel, dispatchEvent),
        ],
        workspaceDir: checkout.dir,
        task,
        spec,
        target,
      });
      cleanupExt = stack.cleanup;

      // Strip trace extension name from external cache/report profileId cleanly
      const profileId = stack.profileId.replace(
        /\+umwelten\.coding-eval\.session-trace$/,
        "",
      );

      const registry = createRegistry();
      for (const ext of stack.extensions) {
        registry.install(ext);
      }

      const models = ensureModelRegistered(target.models, target.piModel);
      const executionEnv = new NodeExecutionEnv({ cwd: checkout.dir });

      harness = await Harness.open(
        new MemoryStorage(),
        {
          models,
          registry,
          env: () => executionEnv,
          settings: {
            retry: { maxRetries: 2 },
          },
        },
        BACKGROUND_CONTEXT,
      );

      let agentThinkingLevel: ModelThinkingLevel | undefined;
      if (canonicalEffort !== undefined) {
        agentThinkingLevel = localTarget
          ? canonicalEffort
          : clampThinkingLevel(target.piModel, canonicalEffort);
      }

      const conv = await harness.root(BACKGROUND_CONTEXT, {
        agent: {
          model: {
            provider: target.piModel.provider,
            modelId: target.piModel.id,
          },
          ...(agentThinkingLevel !== undefined
            ? { thinkingLevel: agentThinkingLevel }
            : {}),
          maxTurns,
          instructions: buildAgentInstructions(task, stack.systemPromptAddendum),
        },
      });

      watch = await conv.watch(BACKGROUND_CONTEXT);

      sessionRef = new InteractiveCodingSession({
        id,
        task,
        spec,
        effort: canonicalEffort ?? "default",
        effectiveThinkingLevel: thinking.effectiveEffort,
        extensionProfile: profileId,
        taskHash,
        target,
        checkout,
        harness,
        conv,
        watch,
        extensionCleanup: stack.cleanup,
        maxTurns,
        timeoutMs,
        outputDir,
      });

      if (options.onEvent) {
        sessionRef.listeners.add(options.onEvent);
      }

      let lastPartialSig = "";
      watch.start(async (call) => {
        if (call.kind !== "value" || !sessionRef) return;
        const live = call.value.docs?.[LiveDoc.definition.kind] as LiveState | undefined;
        if (!live) return;
        const msg = live.generation?.message;
        let thinkingText = "";
        let answerText = "";
        if (msg && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "thinking") thinkingText += block.thinking;
            else if (block.type === "text") answerText += block.text;
          }
        }
        const activeTools = (live.tools ?? []).map((t) => ({
          callId: t.callId,
          name: t.name,
          status: t.status,
          ...(t.output ? { output: t.output.slice(-600) } : {}),
        }));
        if (!thinkingText && !answerText && activeTools.length === 0) return;

        const sig = `${thinkingText.length}:${answerText.length}:${activeTools
          .map((a) => `${a.callId}:${a.status}:${a.output?.length ?? 0}`)
          .join("|")}`;
        if (sig === lastPartialSig) return;
        lastPartialSig = sig;

        sessionRef.emit({
          type: "partial",
          turn: (live.run?.turns ?? 0) + 1,
          thinking: thinkingText,
          text: answerText,
          activeTools,
          timestamp: Date.now(),
        });
      });

      for (const ev of pendingEvents) sessionRef.emit(ev);

      sessionRef.emit({
        type: "session_started",
        sessionId: id,
        taskId: task.id,
        title: task.title,
        model: spec.name,
        provider: spec.provider,
        effort: canonicalEffort ?? "default",
        extensionProfile: profileId,
        workspaceDir: checkout.dir,
        timestamp: Date.now(),
      });

      return sessionRef;
    } catch (err) {
      if (watch) await watch.stop().catch(() => undefined);
      if (harness) await harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
      if (cleanupExt) await cleanupExt().catch(() => undefined);
      await checkout.cleanup().catch(() => undefined);
      throw err;
    }
  }

  private async readAllEntries(): Promise<EntryRecord[]> {
    const entries: EntryRecord[] = [];
    let cursor: Cursor | undefined;
    for (let pageIdx = 0; pageIdx < 20; pageIdx++) {
      const page = await this.conv.entries(
        { order: "ascending" },
        500,
        cursor,
        BACKGROUND_CONTEXT,
      );
      entries.push(...page.items);
      if (!page.next || page.items.length === 0) break;
      cursor = page.next;
    }
    return entries;
  }

  private async buildRecordFromCheckout(options: {
    durationMs: number;
    stopReason: CodingSessionRecord["stopReason"];
    error?: string;
    persistArtifact?: boolean;
  }): Promise<CodingSessionRecord> {
    const entries = await this.readAllEntries();
    const metrics = aggregateSessionMetrics(entries, this.target.piModel);
    const grade = await gradeWorkspaceSnapshot(this.checkout.dir, this.task);
    const cacheKey = buildCodingCacheKey(this.spec, this.extensionProfile);
    const canonicalEffort = canonicalizeThinkingEffort(this.spec.reasoningEffort);
    const taskOutputDir = path.join(this.outputDir, this.task.id);
    const jsonOutPath = path.join(taskOutputDir, `${cacheKey}.json`);
    const transcriptPath = path.join(taskOutputDir, `${cacheKey}.transcript.json`);

    const tokPerSec =
      options.durationMs > 0 && metrics.tokenUsage.completion > 0
        ? Number(
            (metrics.tokenUsage.completion / (options.durationMs / 1000)).toFixed(1),
          )
        : null;

    const fatalError = options.error;
    const record: CodingSessionRecord = {
      taskId: this.task.id,
      title: this.task.title,
      difficulty: this.task.difficulty,
      language: this.task.language,
      model: this.spec.name,
      provider: this.spec.provider,
      ...(canonicalEffort ? { reasoningEffort: canonicalEffort } : {}),
      effectiveThinkingLevel: this.effectiveThinkingLevel,
      extensionProfile: this.extensionProfile,
      taskHash: this.taskHash,
      cacheKey,
      generatedAt: new Date().toISOString(),
      passed: fatalError ? false : grade.passed,
      score: fatalError ? 0 : grade.score,
      maxScore: grade.maxScore,
      details: fatalError ? `${fatalError} | ${grade.details}` : grade.details,
      visibleTests: {
        passed: grade.visibleTests.passed,
        failed: grade.visibleTests.failed,
        total: grade.visibleTests.total,
      },
      hiddenTests: {
        passed: grade.hiddenTests.passed,
        failed: grade.hiddenTests.failed,
        total: grade.hiddenTests.total,
      },
      cheatedProtectedFiles: grade.cheatedProtectedFiles,
      stopReason: options.stopReason,
      durationMs: options.durationMs,
      turns: metrics.turns,
      toolCallsTotal: metrics.toolCallsTotal,
      toolCallsByName: metrics.toolCallsByName,
      toolErrors: metrics.toolErrors,
      costUsd: metrics.costUsd,
      tokenUsage: metrics.tokenUsage,
      tokPerSec,
      changedFiles: grade.changedFiles,
      gitDiffStat: grade.gitDiffStat,
      gitDiff: grade.gitDiff,
      gradingOutput: grade.gradingOutput,
      finalAssistantText: metrics.finalAssistantText,
      transcriptPath: path.relative(process.cwd(), transcriptPath),
      ...(fatalError ? { error: fatalError } : {}),
      cached: false,
    };

    if (options.persistArtifact) {
      await fs.mkdir(taskOutputDir, { recursive: true });
      await fs.writeFile(jsonOutPath, JSON.stringify(record, null, 2));
      await fs.writeFile(
        transcriptPath,
        JSON.stringify(
          {
            taskId: this.task.id,
            modelSpec: formatModelSpecString(this.spec),
            extensionProfile: this.extensionProfile,
            baselineCommit: this.checkout.baselineCommit,
            stopReason: options.stopReason,
            error: fatalError,
            entries,
            gitDiff: grade.gitDiff,
            gradingOutput: grade.gradingOutput,
          },
          null,
          2,
        ),
      );
    }

    return record;
  }

  async runInitialEval(): Promise<CodingSessionRecord> {
    if (this.status === "closed") {
      throw new Error("InteractiveCodingSession is already closed");
    }
    this.activeAbortRequested = false;
    this.setStatus("running");
    const startedAt = Date.now();
    let timedOut = false;
    let stopReason: CodingSessionRecord["stopReason"] = "completed";
    let fatalError: string | undefined;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      void this.abort();
    }, this.timeoutMs);

    try {
      const sub = await this.conv.submit(
        {
          type: "input",
          content: this.task.prompt,
          whenBusy: "followUp",
        },
        BACKGROUND_CONTEXT,
      );
      const settled = await sub.wait(BACKGROUND_CONTEXT);
      await this.conv.waitForIdle(BACKGROUND_CONTEXT);

      if (timedOut) {
        stopReason = "timeout";
        fatalError = `Timed out after ${Math.round(this.timeoutMs / 1000)}s`;
      } else if (settled.status === "unanswered") {
        if (settled.reason === "turn_limit") {
          stopReason = "turn_limit";
        } else if (settled.reason === "aborted") {
          stopReason = this.activeAbortRequested ? "error" : "error";
          fatalError = this.activeAbortRequested
            ? "Aborted by user"
            : "Conversation aborted unexpectedly";
        } else {
          stopReason = "error";
          fatalError = `${settled.reason}${settled.detail !== undefined ? `: ${JSON.stringify(settled.detail)}` : ""}`;
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    this.setStatus("grading");
    const durationMs = Date.now() - startedAt;
    const record = await this.buildRecordFromCheckout({
      durationMs,
      stopReason,
      error: fatalError,
      persistArtifact: !fatalError && !this.activeAbortRequested,
    });

    this.initialRecord = record;
    this.latestRecord = record;
    this.emit({
      type: "graded",
      record,
      isInitialEval: true,
      timestamp: Date.now(),
    });

    const terminalStatus: CodingSessionStatus = this.activeAbortRequested
      ? "aborted"
      : fatalError
        ? "error"
        : "ready";
    this.setStatus(terminalStatus, fatalError);
    return record;
  }

  async abort(): Promise<void> {
    if (this.status === "closed") return;
    this.activeAbortRequested = true;
    await this.conv.abort(BACKGROUND_CONTEXT).catch(() => undefined);
  }

  async sendFollowUp(message: string): Promise<CodingFollowUpResult> {
    if (this.status === "closed") {
      throw new Error("Session is closed");
    }
    if (this.status === "running" || this.status === "chatting") {
      throw new Error(`Session is busy (${this.status})`);
    }

    const beforeEntries = await this.readAllEntries();
    const beforeMetrics = aggregateSessionMetrics(
      beforeEntries,
      this.target.piModel,
    );

    this.activeAbortRequested = false;
    this.setStatus("chatting");
    this.emit({
      type: "followup_user",
      message,
      timestamp: Date.now(),
    });

    try {
      const sub = await this.conv.submit(
        {
          type: "input",
          content: message,
          whenBusy: "followUp",
        },
        BACKGROUND_CONTEXT,
      );
      await sub.wait(BACKGROUND_CONTEXT);
      await this.conv.waitForIdle(BACKGROUND_CONTEXT);

      const afterEntries = await this.readAllEntries();
      const afterMetrics = aggregateSessionMetrics(
        afterEntries,
        this.target.piModel,
      );

      const replyText = afterMetrics.finalAssistantText;
      const deltaTurns = Math.max(0, afterMetrics.turns - beforeMetrics.turns);
      const deltaCostUsd = Number(
        Math.max(0, afterMetrics.costUsd - beforeMetrics.costUsd).toFixed(6),
      );

      this.emit({
        type: "followup_done",
        replyText,
        turns: deltaTurns,
        costUsd: deltaCostUsd,
        timestamp: Date.now(),
      });
      this.setStatus("ready");

      return {
        replyText,
        turns: deltaTurns,
        costUsd: deltaCostUsd,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus("ready", msg);
      throw err;
    }
  }

  async grade(): Promise<CodingSessionRecord> {
    if (this.status === "closed") {
      throw new Error("Session is closed");
    }
    const prevStatus = this.status;
    this.setStatus("grading");
    const record = await this.buildRecordFromCheckout({
      durationMs: this.initialRecord?.durationMs ?? 0,
      stopReason: this.latestRecord?.stopReason ?? "completed",
      persistArtifact: false,
    });
    this.latestRecord = record;
    this.emit({
      type: "graded",
      record,
      isInitialEval: false,
      timestamp: Date.now(),
    });
    this.setStatus(prevStatus === "idle" ? "ready" : prevStatus);
    return record;
  }

  async getDiff(): Promise<{
    changedFiles: string[];
    gitDiffStat: string;
    gitDiff: string;
  }> {
    if (this.status === "closed") {
      return { changedFiles: [], gitDiffStat: "", gitDiff: "" };
    }
    return getWorkspaceDiff(this.checkout.dir);
  }

  async close(): Promise<void> {
    if (this.status === "closed") return;
    this.activeAbortRequested = true;
    this.setStatus("closed");

    if (this.watch) {
      await this.watch.stop().catch(() => undefined);
      this.watch = undefined;
    }
    await this.conv.abort(BACKGROUND_CONTEXT).catch(() => undefined);
    if (this.harness) {
      await this.harness.close(BACKGROUND_CONTEXT).catch(() => undefined);
      this.harness = undefined;
    }
    await this.extensionCleanup().catch(() => undefined);
    await this.checkout.cleanup().catch(() => undefined);
  }
}
