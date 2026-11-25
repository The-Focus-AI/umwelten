import { crc32 } from "./crc.ts";

export type WalOp = "put" | "del";

export interface WalRecord {
  op: WalOp;
  seq: number;
  key: string;
  value: string | null;
}

const OP_PUT = 1;
const OP_DEL = 2;

export function encodeRecord(rec: WalRecord): Buffer {
  const keyBuf = Buffer.from(rec.key, "utf8");
  const valBuf = rec.value !== null ? Buffer.from(rec.value, "utf8") : Buffer.alloc(0);

  // Header: op(1) + seq(4) + keyLen(4) + valLen(4) = 13 bytes, plus body + crc(4)
  const payload = Buffer.allocUnsafe(13 + keyBuf.length + valBuf.length);
  payload.writeUInt8(rec.op === "put" ? OP_PUT : OP_DEL, 0);
  payload.writeUInt32BE(rec.seq, 1);
  // BUG: uses JS UTF-16 string `.length` instead of UTF-8 byte lengths
  payload.writeUInt32BE(rec.key.length, 5);
  payload.writeUInt32BE(rec.value !== null ? rec.value.length : 0, 9);
  keyBuf.copy(payload, 13);
  valBuf.copy(payload, 13 + keyBuf.length);

  const checksum = crc32(payload);
  const frame = Buffer.allocUnsafe(payload.length + 4);
  payload.copy(frame, 0);
  frame.writeUInt32BE(checksum, payload.length);
  return frame;
}

export function decodeRecordAt(
  buf: Buffer,
  offset: number,
): { record: WalRecord; nextOffset: number } {
  if (offset + 17 > buf.length) {
    throw new Error(`Truncated WAL header at offset ${offset}`);
  }
  const opByte = buf.readUInt8(offset);
  const seq = buf.readUInt32BE(offset + 1);
  const keyLen = buf.readUInt32BE(offset + 5);
  const valLen = buf.readUInt32BE(offset + 9);
  const bodyLen = 13 + keyLen + valLen;
  const totalLen = bodyLen + 4;

  if (offset + totalLen > buf.length) {
    throw new Error(`Truncated WAL body at offset ${offset}`);
  }

  const payload = buf.subarray(offset, offset + bodyLen);
  const expectedCrc = buf.readUInt32BE(offset + bodyLen);
  const actualCrc = crc32(payload);
  if (expectedCrc !== actualCrc) {
    throw new Error(`CRC mismatch at offset ${offset}`);
  }

  if (opByte !== OP_PUT && opByte !== OP_DEL) {
    throw new Error(`Unknown WAL op byte ${opByte} at offset ${offset}`);
  }

  const key = buf.subarray(offset + 13, offset + 13 + keyLen).toString("utf8");
  const value =
    opByte === OP_PUT
      ? buf.subarray(offset + 13 + keyLen, offset + bodyLen).toString("utf8")
      : null;

  return {
    record: {
      op: opByte === OP_PUT ? "put" : "del",
      seq,
      key,
      value,
    },
    nextOffset: offset + totalLen,
  };
}
