import fs from "node:fs";
import path from "node:path";
import { decodeRecordAt, encodeRecord, type WalRecord } from "./codec.ts";

export function segmentFileName(index: number): string {
  return `wal-${String(index).padStart(4, "0")}.log`;
}

export function listSegments(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^wal-\d{4}\.log$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

export function appendWalRecord(filePath: string, rec: WalRecord): void {
  fs.appendFileSync(filePath, encodeRecord(rec));
}

export function readWalSegment(filePath: string): {
  records: WalRecord[];
  validBytes: number;
  truncatedTail: boolean;
} {
  if (!fs.existsSync(filePath)) {
    return { records: [], validBytes: 0, truncatedTail: false };
  }
  const buf = fs.readFileSync(filePath);
  const records: WalRecord[] = [];
  let offset = 0;

  while (offset < buf.length) {
    // BUG: lets decodeRecordAt throw instead of salvaging valid prefix & truncating torn tail
    const { record, nextOffset } = decodeRecordAt(buf, offset);
    records.push(record);
    offset = nextOffset;
  }

  return { records, validBytes: offset, truncatedTail: false };
}
