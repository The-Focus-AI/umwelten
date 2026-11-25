import type { WalRecord } from "./codec.ts";

export class MemTable {
  private readonly entries = new Map<string, { value: string | null; seq: number }>();

  apply(record: WalRecord): void {
    const existing = this.entries.get(record.key);
    if (existing && existing.seq > record.seq) return;
    this.entries.set(record.key, {
      value: record.op === "put" ? record.value : null,
      seq: record.seq,
    });
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.value === null) return undefined;
    return entry.value;
  }

  keys(): string[] {
    const out: string[] = [];
    for (const [k, v] of this.entries) {
      if (v.value !== null) out.push(k);
    }
    return out.sort();
  }
}
