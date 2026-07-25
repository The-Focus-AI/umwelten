/**
 * On-disk layout for fission trees.
 *
 *   <root>/<treeId>/tree.json    — tree metadata + nodes (rewritten on change)
 *   <root>/<treeId>/turns.jsonl  — one TurnRecord per line (append-only)
 *
 * turns.jsonl is append-only so a live run is crash-safe and replayable: the
 * offline sweep driver reads the same file the live chat wrote. Label edits and
 * playground compactions rewrite the file, which is the one non-append path.
 */

import { mkdir, readFile, writeFile, readdir, appendFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FissionTreeData, TurnRecord } from "../types.js";
import { FissionTree } from "./tree.js";

export function defaultFissionRoot(): string {
  return process.env.UMWELTEN_FISSION_DIR ?? join(homedir(), ".umwelten", "fission");
}

export class FissionStore {
  constructor(private root: string = defaultFissionRoot()) {}

  treeDir(treeId: string): string {
    return join(this.root, treeId);
  }

  async listTreeIds(): Promise<string[]> {
    if (!existsSync(this.root)) return [];
    const entries = await readdir(this.root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && existsSync(join(this.root, e.name, "tree.json")))
      .map((e) => e.name);
  }

  async listTrees(): Promise<FissionTreeData[]> {
    const ids = await this.listTreeIds();
    const out: FissionTreeData[] = [];
    for (const id of ids) {
      try {
        out.push(await this.loadTreeData(id));
      } catch {
        // A half-written tree.json shouldn't break the index.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadTreeData(treeId: string): Promise<FissionTreeData> {
    const raw = await readFile(join(this.treeDir(treeId), "tree.json"), "utf8");
    return JSON.parse(raw) as FissionTreeData;
  }

  async loadTurns(treeId: string): Promise<TurnRecord[]> {
    const path = join(this.treeDir(treeId), "turns.jsonl");
    if (!existsSync(path)) return [];
    const raw = await readFile(path, "utf8");
    const turns: TurnRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        turns.push(JSON.parse(trimmed) as TurnRecord);
      } catch {
        // Tolerate a torn final line from an interrupted append.
      }
    }
    return turns;
  }

  async load(treeId: string): Promise<FissionTree> {
    const [data, turns] = await Promise.all([
      this.loadTreeData(treeId),
      this.loadTurns(treeId),
    ]);
    return new FissionTree(data, turns);
  }

  async saveTree(tree: FissionTree): Promise<void> {
    const dir = this.treeDir(tree.id);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, "tree.json.tmp");
    await writeFile(tmp, JSON.stringify(tree.data, null, 2), "utf8");
    await rename(tmp, join(dir, "tree.json"));
  }

  async appendTurn(treeId: string, turn: TurnRecord): Promise<void> {
    const dir = this.treeDir(treeId);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "turns.jsonl"), `${JSON.stringify(turn)}\n`, "utf8");
  }

  /** Rewrite the whole turn log. Used for label edits and playground results. */
  async rewriteTurns(treeId: string, turns: TurnRecord[]): Promise<void> {
    const dir = this.treeDir(treeId);
    await mkdir(dir, { recursive: true });
    const body = turns.map((t) => JSON.stringify(t)).join("\n");
    const tmp = join(dir, "turns.jsonl.tmp");
    await writeFile(tmp, body ? `${body}\n` : "", "utf8");
    await rename(tmp, join(dir, "turns.jsonl"));
  }

  /** Persist tree metadata and the full turn log together. */
  async saveAll(tree: FissionTree): Promise<void> {
    await this.saveTree(tree);
    await this.rewriteTurns(tree.id, tree.allTurns());
  }

  /**
   * A node's live message array, post-compaction. Kept separate from
   * turns.jsonl: turns are the immutable record of what happened, node
   * messages are the mutable working context the next turn will be sent.
   */
  async saveNodeMessages(
    treeId: string,
    nodeId: string,
    messages: unknown[],
  ): Promise<void> {
    const dir = join(this.treeDir(treeId), "nodes");
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `${nodeId}.json.tmp`);
    await writeFile(tmp, JSON.stringify(messages, null, 2), "utf8");
    await rename(tmp, join(dir, `${nodeId}.json`));
  }

  async loadNodeMessages(treeId: string, nodeId: string): Promise<unknown[] | undefined> {
    const path = join(this.treeDir(treeId), "nodes", `${nodeId}.json`);
    if (!existsSync(path)) return undefined;
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
