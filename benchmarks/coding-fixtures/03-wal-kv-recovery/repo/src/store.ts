import fs from "node:fs";
import path from "node:path";
import { compactSegmentFiles } from "./compactor.ts";
import { MemTable } from "./memtable.ts";
import {
  appendWalRecord,
  listSegments,
  readWalSegment,
  segmentFileName,
} from "./wal.ts";

export class WalKVStore {
  readonly dir: string;
  private readonly memtable = new MemTable();
  private activeSegmentIndex: number;
  private nextSeq: number;

  private constructor(dir: string, activeSegmentIndex: number, nextSeq: number) {
    this.dir = dir;
    this.activeSegmentIndex = activeSegmentIndex;
    this.nextSeq = nextSeq;
  }

  static open(dir: string): WalKVStore {
    fs.mkdirSync(dir, { recursive: true });
    const segments = listSegments(dir);
    if (segments.length === 0) {
      const firstPath = path.join(dir, segmentFileName(1));
      fs.writeFileSync(firstPath, Buffer.alloc(0));
      return new WalKVStore(dir, 1, 1);
    }

    const memtable = new MemTable();
    let maxSeq = 0;
    let maxIndex = 1;

    for (const segPath of segments) {
      const match = path.basename(segPath).match(/^wal-(\d{4})\.log$/);
      if (match) {
        maxIndex = Math.max(maxIndex, Number(match[1]));
      }
      const { records } = readWalSegment(segPath);
      for (const rec of records) {
        memtable.apply(rec);
        if (rec.seq > maxSeq) maxSeq = rec.seq;
      }
    }

    const store = new WalKVStore(dir, maxIndex, maxSeq + 1);
    for (const segPath of segments) {
      const { records } = readWalSegment(segPath);
      for (const rec of records) {
        store.memtable.apply(rec);
      }
    }
    return store;
  }

  private activeSegmentPath(): string {
    return path.join(this.dir, segmentFileName(this.activeSegmentIndex));
  }

  set(key: string, value: string): void {
    const rec = { op: "put" as const, seq: this.nextSeq++, key, value };
    appendWalRecord(this.activeSegmentPath(), rec);
    this.memtable.apply(rec);
  }

  delete(key: string): void {
    const rec = { op: "del" as const, seq: this.nextSeq++, key, value: null };
    appendWalRecord(this.activeSegmentPath(), rec);
    this.memtable.apply(rec);
  }

  get(key: string): string | undefined {
    return this.memtable.get(key);
  }

  keys(): string[] {
    return this.memtable.keys();
  }

  rotateSegment(): string {
    this.activeSegmentIndex += 1;
    const p = this.activeSegmentPath();
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, Buffer.alloc(0));
    }
    return p;
  }

  compact(options: { keepOldest?: number } = {}): void {
    const keepOldest = Math.max(0, options.keepOldest ?? 0);
    const segments = listSegments(this.dir);
    if (segments.length <= keepOldest + 1 && keepOldest > 0) return;
    if (segments.length === 0) return;

    const toCompact = segments.slice(keepOldest);
    if (toCompact.length === 0) return;

    const targetPath = toCompact[0];
    compactSegmentFiles(toCompact, targetPath, {
      preserveTombstones: keepOldest > 0,
    });
  }
}

export * from "./crc.ts";
export * from "./codec.ts";
export * from "./wal.ts";
export * from "./memtable.ts";
export * from "./compactor.ts";
