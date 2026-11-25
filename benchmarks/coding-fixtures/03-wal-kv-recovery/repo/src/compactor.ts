import fs from "node:fs";
import { encodeRecord, type WalRecord } from "./codec.ts";
import { readWalSegment } from "./wal.ts";

export function compactSegmentFiles(
  segmentPaths: readonly string[],
  targetPath: string,
  options: { preserveTombstones?: boolean } = {},
): WalRecord[] {
  const latestByKey = new Map<string, WalRecord>();
  for (const segPath of segmentPaths) {
    const { records } = readWalSegment(segPath);
    for (const rec of records) {
      const prev = latestByKey.get(rec.key);
      if (!prev || rec.seq >= prev.seq) {
        latestByKey.set(rec.key, rec);
      }
    }
  }

  const kept: WalRecord[] = [];
  for (const rec of latestByKey.values()) {
    // BUG: ignores preserveTombstones and always drops deletions
    void options;
    if (rec.op === "del") continue;
    kept.push(rec);
  }
  kept.sort((a, b) => a.seq - b.seq);

  const chunks = kept.map((r) => encodeRecord(r));
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, Buffer.concat(chunks));

  for (const segPath of segmentPaths) {
    if (segPath !== targetPath && fs.existsSync(segPath)) {
      fs.unlinkSync(segPath);
    }
  }
  fs.renameSync(tmpPath, targetPath);
  return kept;
}
