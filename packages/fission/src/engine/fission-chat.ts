/**
 * FissionChat — the turn loop.
 *
 * Every user turn runs the same pipeline:
 *
 *   1. score the turn for drift against the node it landed in (active detector
 *      plus any shadow detectors, all against the same pre-turn state)
 *   2. fork if the active detector says so — the child is seeded with a
 *      query-conditioned carry-over of the parent, and the parent is untouched
 *   3. answer, in whichever node the turn ended up in
 *   4. analyse the exchange into summary / facts / topics
 *   5. compact the node's context
 *   6. record all of it on an append-only TurnRecord
 *
 * Detection runs *before* the answer deliberately. Forking after answering
 * would put the new thread's first exchange in the old thread's context, which
 * is the thing fission exists to prevent.
 */

import { v4 as uuidv4 } from "uuid";
import type { ModelMessage, Tool } from "ai";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { estimateContextSize } from "@umwelten/core/context/estimate-size.js";
import type { ModelDetails, StreamObserver } from "@umwelten/core/cognition/types.js";
import type {
  CompactionRecord,
  DetectorResult,
  FissionNode,
  ToolCallRecord,
  TurnRecord,
} from "../types.js";
import { FissionTree } from "../tree/tree.js";
import { FissionStore } from "../tree/store.js";
import { buildSignature, topTerms } from "../tree/signature.js";
import { getDetector } from "../detect/registry.js";
import type { DetectorContext } from "../detect/types.js";
import { analyzeTurn } from "../analysis/turn-analysis.js";
import { runCompaction } from "./compact.js";
import { registerFissionStrategies } from "../compaction/register.js";
import { buildFissionTools } from "./tools.js";
import { usageFrom } from "../util/usage.js";
import type { FissionEvent, FissionEventHandler } from "./events.js";

const DEFAULT_SYSTEM_PROMPT = `You are a research assistant in a threaded workspace.

Answer questions directly and look things up when it helps. Some of what you know about this person lives in *other threads* of this conversation — when they refer to something that isn't in front of you, use recall_thread to find it before saying you don't know.

Be concise. Prefer specifics over hedging.`;

export interface FissionChatOptions {
  tree: FissionTree;
  store: FissionStore;
  /** Model that answers the user. */
  model: ModelDetails;
  /** Model for analysis, detection, and compaction. Defaults to `model`. */
  analysisModel?: ModelDetails;
  systemPrompt?: string;
  /** Overrides the default tool set entirely when provided. */
  tools?: Record<string, Tool>;
  maxSteps?: number;
}

export interface SendOptions {
  signal?: AbortSignal;
  onEvent?: FissionEventHandler;
  /** Force the turn into this node regardless of what the detector says. */
  forceNodeId?: string;
  /** Force a fork (true) or forbid one (false) for this turn. */
  forceFork?: boolean;
}

export class FissionChat {
  readonly tree: FissionTree;
  readonly store: FissionStore;
  readonly model: ModelDetails;
  readonly analysisModel: ModelDetails;
  private systemPrompt: string;
  private toolsOverride?: Record<string, Tool>;
  private maxSteps: number;
  private interactions = new Map<string, Interaction>();

  constructor(options: FissionChatOptions) {
    this.tree = options.tree;
    this.store = options.store;
    this.model = options.model;
    this.analysisModel = options.analysisModel ?? options.model;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.toolsOverride = options.tools;
    this.maxSteps = options.maxSteps ?? 8;
    registerFissionStrategies();
  }

  static async create(options: {
    store?: FissionStore;
    model: ModelDetails;
    analysisModel?: ModelDetails;
    title?: string;
    config?: Partial<FissionChatConfigInput>;
    systemPrompt?: string;
  }): Promise<FissionChat> {
    const store = options.store ?? new FissionStore();
    const tree = FissionTree.create({
      model: options.model,
      title: options.title,
      config: options.config,
    });
    await store.saveTree(tree);
    return new FissionChat({
      tree,
      store,
      model: options.model,
      analysisModel: options.analysisModel,
      systemPrompt: options.systemPrompt,
    });
  }

  static async open(options: {
    treeId: string;
    store?: FissionStore;
    model?: ModelDetails;
    analysisModel?: ModelDetails;
    systemPrompt?: string;
  }): Promise<FissionChat> {
    const store = options.store ?? new FissionStore();
    const tree = await store.load(options.treeId);
    const chat = new FissionChat({
      tree,
      store,
      model: options.model ?? tree.data.model,
      analysisModel: options.analysisModel,
      systemPrompt: options.systemPrompt,
    });
    await chat.hydrate();
    return chat;
  }

  /** Restore each node's live message array from disk. */
  private async hydrate(): Promise<void> {
    for (const nodeId of Object.keys(this.tree.data.nodes)) {
      const messages = await this.store.loadNodeMessages(this.tree.id, nodeId);
      if (!messages) continue;
      const interaction = this.buildInteraction(this.tree.requireNode(nodeId));
      interaction.messages = messages as ModelMessage[];
      this.interactions.set(nodeId, interaction);
    }
  }

  private buildInteraction(node: FissionNode): Interaction {
    const instructions = [this.systemPrompt];
    if (node.seed?.text) {
      instructions.push(`\n${node.seed.text}`);
    }
    const stimulus = new Stimulus({
      role: "threaded research assistant",
      objective: "answer questions and look things up within one thread of a conversation tree",
      instructions,
      runnerType: "base",
    });
    const interaction = new Interaction(this.model, stimulus, {
      id: node.id,
      source: "native",
    });
    interaction.tools =
      this.toolsOverride ??
      buildFissionTools({
        tree: this.tree,
        getCurrentNodeId: () => this.tree.data.activeNodeId,
      });
    interaction.maxSteps = this.maxSteps;
    return interaction;
  }

  interactionFor(nodeId: string): Interaction {
    const existing = this.interactions.get(nodeId);
    if (existing) return existing;
    const interaction = this.buildInteraction(this.tree.requireNode(nodeId));
    this.interactions.set(nodeId, interaction);
    return interaction;
  }

  get activeNode(): FissionNode {
    return this.tree.activeNode;
  }

  setActiveNode(nodeId: string): void {
    this.tree.setActiveNode(nodeId);
  }

  /**
   * Rebuild a node's *uncompacted* context from its turn records.
   *
   * This is what the compaction playground feeds every strategy, so each one is
   * measured on identical input rather than on whatever the live context had
   * already been compacted into.
   */
  rebuildRawMessages(nodeId: string, upToTurnId?: string): ModelMessage[] {
    const node = this.tree.requireNode(nodeId);
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: node.seed?.text
          ? `${this.systemPrompt}\n\n${node.seed.text}`
          : this.systemPrompt,
      },
    ];
    for (const turn of this.tree.nodeTurns(nodeId)) {
      messages.push({ role: "user", content: turn.userText });
      messages.push({ role: "assistant", content: turn.assistantText });
      if (upToTurnId && turn.id === upToTurnId) break;
    }
    return messages;
  }

  /** Run one detector against a node's pre-turn state. */
  private buildDetectorContext(
    node: FissionNode,
    userText: string,
    signal?: AbortSignal,
  ): DetectorContext {
    return {
      userText,
      node,
      recentTurns: this.tree.nodeTurns(node.id),
      runningSummary: this.runningSummaryFor(node.id),
      model: this.analysisModel,
      threshold: this.tree.config.driftThreshold,
      signal,
    };
  }

  /** The rolling summary currently sitting in a node's context, if any. */
  runningSummaryFor(nodeId: string): string | undefined {
    const interaction = this.interactions.get(nodeId);
    if (!interaction) return undefined;
    for (let i = 1; i < interaction.messages.length; i++) {
      const msg = interaction.messages[i] as { role?: string; content?: unknown };
      if (msg.role === "system" && typeof msg.content === "string") {
        return msg.content;
      }
    }
    return undefined;
  }

  async send(userText: string, options: SendOptions = {}): Promise<TurnRecord> {
    const emit = (event: FissionEvent) => options.onEvent?.(event);
    const turnStarted = Date.now();
    const config = this.tree.config;

    const arrivedNode = options.forceNodeId
      ? this.tree.requireNode(options.forceNodeId)
      : this.tree.activeNode;
    emit({ type: "turn-start", nodeId: arrivedNode.id, userText });

    // --- 1. detect -------------------------------------------------------
    const ctx = this.buildDetectorContext(arrivedNode, userText, options.signal);
    emit({ type: "detect-start", nodeId: arrivedNode.id, detectorId: config.detectorId });

    const activeDetector = getDetector(config.detectorId);
    let detectorResult: DetectorResult | undefined;
    if (activeDetector) {
      detectorResult = await activeDetector.detect(ctx);
      emit({ type: "detect", result: detectorResult, shadow: false });
    }

    const shadowResults: DetectorResult[] = [];
    for (const shadowId of config.shadowDetectorIds) {
      if (shadowId === config.detectorId) continue;
      const detector = getDetector(shadowId);
      if (!detector) continue;
      try {
        const result = await detector.detect(ctx);
        shadowResults.push(result);
        emit({ type: "detect", result, shadow: true });
      } catch {
        // A shadow detector is instrumentation; it must not break the turn.
      }
    }

    // --- 2. fork ---------------------------------------------------------
    const eligibleToFork = arrivedNode.turnIds.length >= config.minTurnsBeforeFork;
    const wantsFork =
      options.forceFork ?? (detectorResult?.verdict === "fork" && eligibleToFork);

    let targetNode = arrivedNode;
    const forked = wantsFork && (config.autoFork || options.forceFork === true);
    if (forked) {
      targetNode = await this.performFork(arrivedNode, userText, detectorResult, emit);
    } else if (detectorResult?.verdict === "fork") {
      emit({
        type: "fork-proposed",
        nodeId: arrivedNode.id,
        reason: eligibleToFork
          ? "autoFork is off — fork recorded but not applied."
          : `Node has ${arrivedNode.turnIds.length} turn(s); minTurnsBeforeFork is ${config.minTurnsBeforeFork}.`,
        proposedTitle: detectorResult.proposedTitle,
      });
    }

    // --- 3. answer -------------------------------------------------------
    const interaction = this.interactionFor(targetNode.id);
    const contextTokensBefore = estimateContextSize(interaction.messages).estimatedTokens;
    interaction.addMessage({ role: "user", content: userText });
    emit({ type: "answer-start", nodeId: targetNode.id });

    const toolCalls: ToolCallRecord[] = [];
    const observer: StreamObserver = {
      onTextDelta: (delta) => emit({ type: "answer-delta", delta }),
      onToolCall: (call) => {
        const argsPreview = JSON.stringify(call.input ?? {}).slice(0, 300);
        toolCalls.push({ name: call.toolName, argsPreview });
        emit({ type: "tool-call", name: call.toolName, input: call.input });
      },
      onToolResult: (result) =>
        emit({ type: "tool-result", name: result.toolName, isError: result.isError }),
    };

    let assistantText = "";
    let usage;
    try {
      const response = await interaction.streamText(options.signal, observer);
      assistantText = response.content ?? "";
      usage = usageFrom(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "error", message });
      throw error;
    }
    emit({ type: "answer", nodeId: targetNode.id, text: assistantText });

    // --- 4. analyse ------------------------------------------------------
    const analysis = await analyzeTurn({
      model: this.analysisModel,
      userText,
      assistantText,
      signal: options.signal,
    });
    emit({ type: "analysis", analysis });

    // --- 5. compact ------------------------------------------------------
    let compaction: CompactionRecord | undefined;
    const tokensNow = estimateContextSize(interaction.messages).estimatedTokens;
    const shouldCompact =
      config.compactEveryTurn || tokensNow >= config.compactAboveTokens;
    if (shouldCompact) {
      const outcome = await runCompaction({
        messages: interaction.messages,
        strategyId: config.compactionStrategyId,
        keepRecentMessages: config.keepRecentMessages,
        model: this.analysisModel,
        runner: interaction.getRunner(),
      });
      if (outcome) {
        interaction.messages = outcome.messages;
        compaction = outcome.record;
        emit({ type: "compaction", record: outcome.record });
      }
    }
    const contextTokensAfter = estimateContextSize(interaction.messages).estimatedTokens;

    // --- 6. record -------------------------------------------------------
    const turn: TurnRecord = {
      id: uuidv4(),
      treeId: this.tree.id,
      nodeId: targetNode.id,
      arrivedAtNodeId: arrivedNode.id,
      index: targetNode.turnIds.length,
      timestamp: new Date().toISOString(),
      userText,
      assistantText,
      toolCalls,
      analysis,
      detector: detectorResult,
      shadowDetectors: shadowResults,
      compaction,
      contextTokensBefore,
      contextTokensAfter,
      usage,
      wallMs: Date.now() - turnStarted,
    };

    // The child exists before the turn does, so the back-pointer is set here.
    if (forked) targetNode.bornFromTurnId = turn.id;

    this.tree.addTurn(turn);
    this.tree.updateSignature(
      targetNode.id,
      buildSignature(
        [userText, analysis.summary, analysis.topics.join(" "), analysis.facts.join(" ")].join("\n"),
      ),
    );
    this.tree.setActiveNode(targetNode.id);

    // Give an untitled node a name once it has something to be named after.
    if (targetNode.title === "Root" && targetNode.turnIds.length === 1 && analysis.topics.length) {
      this.tree.renameNode(targetNode.id, analysis.topics.slice(0, 2).join(" / "));
    }

    await this.persist(targetNode.id, turn);
    emit({ type: "turn-complete", turn });
    return turn;
  }

  private async performFork(
    parent: FissionNode,
    userText: string,
    detectorResult: Partial<DetectorResult> | undefined,
    emit: (event: FissionEvent) => void,
  ): Promise<FissionNode> {
    const config = this.tree.config;
    const parentInteraction = this.interactionFor(parent.id);

    // Seed the child with a carry-over brief conditioned on the drifting turn.
    let seed: FissionNode["seed"];
    const outcome = await runCompaction({
      messages: parentInteraction.messages,
      strategyId: config.carryoverStrategyId,
      // Carry-over summarizes the whole parent; nothing is kept verbatim.
      keepRecentMessages: 0,
      model: this.analysisModel,
      runner: parentInteraction.getRunner(),
      strategyOptions: { newTopic: userText },
    });
    if (outcome && !outcome.record.error) {
      seed = {
        strategyId: outcome.record.strategyId,
        text: outcome.record.summaryText,
        tokensBefore: outcome.record.tokensBefore,
        tokensAfter: outcome.record.tokensAfter,
      };
    }

    const title =
      detectorResult?.proposedTitle?.trim() ||
      topTerms(buildSignature(userText), 3).join(" ") ||
      "New thread";

    const child = this.tree.fork({
      parentId: parent.id,
      title,
      seed,
    });
    this.tree.setActiveNode(child.id);
    emit({
      type: "fork",
      parentId: parent.id,
      child,
      reason: detectorResult?.reason ?? "Manual fork.",
    });
    return child;
  }

  /** Fork by hand from the UI, with no drift detection involved. */
  async forkManually(parentId: string, title: string, newTopic?: string): Promise<FissionNode> {
    const parent = this.tree.requireNode(parentId);
    const child = await this.performFork(parent, newTopic ?? title, { proposedTitle: title }, () => {});
    await this.store.saveTree(this.tree);
    return child;
  }

  /**
   * Playground: run any strategy over a node's raw context as of a given turn.
   * Recorded under `altCompactions` so the browser can diff strategies that all
   * saw exactly the same input.
   */
  async tryCompaction(options: {
    turnId: string;
    strategyId: string;
    keepRecentMessages?: number;
    newTopic?: string;
  }): Promise<CompactionRecord | undefined> {
    const turn = this.tree.turns.get(options.turnId);
    if (!turn) return undefined;

    const messages = this.rebuildRawMessages(turn.nodeId, turn.id);
    const interaction = this.interactionFor(turn.nodeId);
    const keepRecentMessages =
      options.keepRecentMessages ?? this.tree.config.keepRecentMessages;
    const outcome = await runCompaction({
      messages,
      strategyId: options.strategyId,
      keepRecentMessages,
      model: this.analysisModel,
      runner: interaction.getRunner(),
      strategyOptions: {
        // One "keep recent" knob in the UI has to mean one thing. Segment
        // planning already holds the tail out; strategies that keep their own
        // verbatim window (recent-window, truncate) read this, so without
        // forwarding it the control would silently do nothing for them.
        keepMessages: keepRecentMessages,
        keepTurns: keepRecentMessages,
        ...(options.newTopic ? { newTopic: options.newTopic } : {}),
      },
    });
    if (!outcome) return undefined;

    turn.altCompactions = { ...(turn.altCompactions ?? {}), [options.strategyId]: outcome.record };
    await this.store.rewriteTurns(this.tree.id, this.tree.allTurns());
    return outcome.record;
  }

  private async persist(nodeId: string, turn: TurnRecord): Promise<void> {
    await this.store.appendTurn(this.tree.id, turn);
    await this.store.saveTree(this.tree);
    const interaction = this.interactions.get(nodeId);
    if (interaction) {
      await this.store.saveNodeMessages(this.tree.id, nodeId, interaction.messages);
    }
  }
}

/** Config subset accepted by FissionChat.create. */
export type FissionChatConfigInput = import("../types.js").FissionConfig;
