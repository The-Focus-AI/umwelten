/**
 * FissionTree: the in-memory conversation tree plus its turn log.
 *
 * Pure data manipulation — no model calls, no filesystem. The engine drives it,
 * the store persists it, the server reads it. That split is what lets the whole
 * thing be unit-tested without a network.
 */

import { v4 as uuidv4 } from "uuid";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import {
  DEFAULT_FISSION_CONFIG,
  type FissionConfig,
  type FissionNode,
  type FissionTreeData,
  type TopicSignature,
  type TreeStats,
  type TurnLabel,
  type TurnRecord,
} from "../types.js";
import { emptySignature, mergeSignature } from "./signature.js";

export interface CreateTreeOptions {
  id?: string;
  title?: string;
  model: ModelDetails;
  config?: Partial<FissionConfig>;
  rootTitle?: string;
}

export class FissionTree {
  data: FissionTreeData;
  /** Turn records keyed by id. Append-only in practice. */
  turns: Map<string, TurnRecord>;

  constructor(data: FissionTreeData, turns: TurnRecord[] = []) {
    this.data = data;
    this.turns = new Map(turns.map((t) => [t.id, t]));
  }

  static create(options: CreateTreeOptions): FissionTree {
    const now = new Date().toISOString();
    const treeId = options.id ?? uuidv4();
    const rootId = uuidv4();
    const root: FissionNode = {
      id: rootId,
      treeId,
      title: options.rootTitle ?? "Root",
      createdAt: now,
      updatedAt: now,
      turnIds: [],
      topicSignature: emptySignature(),
      status: "active",
    };
    return new FissionTree({
      id: treeId,
      title: options.title ?? "Untitled exploration",
      createdAt: now,
      updatedAt: now,
      model: options.model,
      config: { ...DEFAULT_FISSION_CONFIG, ...options.config },
      rootId,
      activeNodeId: rootId,
      nodes: { [rootId]: root },
    });
  }

  get id(): string {
    return this.data.id;
  }

  get config(): FissionConfig {
    return this.data.config;
  }

  node(id: string): FissionNode | undefined {
    return this.data.nodes[id];
  }

  requireNode(id: string): FissionNode {
    const node = this.data.nodes[id];
    if (!node) throw new Error(`No such node: ${id}`);
    return node;
  }

  get activeNode(): FissionNode {
    return this.requireNode(this.data.activeNodeId);
  }

  setActiveNode(id: string): void {
    this.requireNode(id);
    this.data.activeNodeId = id;
    this.touch();
  }

  children(nodeId: string): FissionNode[] {
    return Object.values(this.data.nodes)
      .filter((n) => n.parentId === nodeId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Root → node, inclusive. */
  pathTo(nodeId: string): FissionNode[] {
    const path: FissionNode[] = [];
    let current = this.node(nodeId);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      current = current.parentId ? this.node(current.parentId) : undefined;
    }
    return path;
  }

  depth(nodeId: string): number {
    return this.pathTo(nodeId).length - 1;
  }

  nodeTurns(nodeId: string): TurnRecord[] {
    const node = this.node(nodeId);
    if (!node) return [];
    return node.turnIds
      .map((id) => this.turns.get(id))
      .filter((t): t is TurnRecord => t !== undefined);
  }

  allTurns(): TurnRecord[] {
    return Array.from(this.turns.values()).sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
  }

  /** Spin a new child off `parentId`, seeded with compacted parent context. */
  fork(options: {
    parentId: string;
    title: string;
    bornFromTurnId?: string;
    seed?: FissionNode["seed"];
    signature?: TopicSignature;
  }): FissionNode {
    const parent = this.requireNode(options.parentId);
    const now = new Date().toISOString();
    const child: FissionNode = {
      id: uuidv4(),
      treeId: this.data.id,
      parentId: parent.id,
      title: options.title,
      createdAt: now,
      updatedAt: now,
      bornFromTurnId: options.bornFromTurnId,
      seed: options.seed,
      turnIds: [],
      topicSignature: options.signature ?? emptySignature(),
      status: "active",
    };
    this.data.nodes[child.id] = child;
    parent.updatedAt = now;
    this.touch();
    return child;
  }

  addTurn(turn: TurnRecord): void {
    const node = this.requireNode(turn.nodeId);
    this.turns.set(turn.id, turn);
    if (!node.turnIds.includes(turn.id)) node.turnIds.push(turn.id);
    node.updatedAt = turn.timestamp;
    this.touch();
  }

  /** Fold a turn's text into its node's running fingerprint. */
  updateSignature(nodeId: string, incoming: TopicSignature): void {
    const node = this.requireNode(nodeId);
    node.topicSignature = mergeSignature(node.topicSignature, incoming);
    this.touch();
  }

  labelTurn(turnId: string, label: TurnLabel): TurnRecord | undefined {
    const turn = this.turns.get(turnId);
    if (!turn) return undefined;
    turn.label = label;
    this.touch();
    return turn;
  }

  renameNode(nodeId: string, title: string): void {
    const node = this.requireNode(nodeId);
    node.title = title;
    node.updatedAt = new Date().toISOString();
    this.touch();
  }

  stats(): TreeStats {
    const turns = this.allTurns();
    const ratios: number[] = [];
    let totalCostUsd = 0;
    let tokensSaved = 0;
    let forkCount = 0;
    let labeledTurns = 0;

    for (const turn of turns) {
      if (turn.compaction && !turn.compaction.error) {
        ratios.push(turn.compaction.ratio);
        tokensSaved += Math.max(
          0,
          turn.compaction.tokensBefore - turn.compaction.tokensAfter,
        );
      }
      totalCostUsd += turn.usage?.costUsd ?? 0;
      totalCostUsd += turn.detector?.costUsd ?? 0;
      if (turn.detector?.verdict === "fork") forkCount++;
      if (turn.label) labeledTurns++;
    }

    let maxDepth = 0;
    for (const nodeId of Object.keys(this.data.nodes)) {
      maxDepth = Math.max(maxDepth, this.depth(nodeId));
    }

    return {
      nodeCount: Object.keys(this.data.nodes).length,
      turnCount: turns.length,
      forkCount,
      maxDepth,
      totalCostUsd,
      meanCompactionRatio:
        ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1,
      tokensSaved,
      labeledTurns,
    };
  }

  private touch(): void {
    this.data.updatedAt = new Date().toISOString();
  }
}
