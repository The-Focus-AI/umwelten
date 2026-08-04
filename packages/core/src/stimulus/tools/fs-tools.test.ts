/**
 * Bounded reads.
 *
 * The case these exist for: a habitat mounted on a docs repo containing a
 * 5.2 MB `.eml` answered one question by calling read_file on it, and the
 * provider rejected the request at 1,154,415 tokens against a 1,000,000
 * limit. The turn did not degrade — it ended, with no answer and nothing the
 * model could do differently, because it had no way to know the size before
 * asking.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAX_READ_BYTES, boundSlice, readBounded } from './fs-tools.js';

describe('readBounded', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'umwl-fs-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (name: string, content: string) => {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  };

  it('returns a small file whole, with no truncation metadata', async () => {
    const path = await write('small.md', 'hello\nworld\n');
    const result = await readBounded(path);

    expect(result.content).toBe('hello\nworld\n');
    expect(result.truncated).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  it('truncates a file past the cap instead of returning it whole', async () => {
    const line = `${'x'.repeat(99)}\n`;
    const path = await write('big.eml', line.repeat(5000)); // ~500 KB
    const result = await readBounded(path);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(
      DEFAULT_MAX_READ_BYTES,
    );
    expect(result.totalBytes).toBe(500_000);
  });

  it('reports the real size so the model can tell how much it is missing', async () => {
    const path = await write('big.eml', `${'y'.repeat(99)}\n`.repeat(5000));
    const result = await readBounded(path);

    expect(result.totalBytes).toBe(500_000);
    expect(result.bytesReturned).toBeLessThan(result.totalBytes);
    expect(result.hint).toMatch(/offset and limit/);
  });

  /**
   * A half-line is worse than a missing line: the model cannot tell a record
   * that ends early from one whose value really is that short.
   */
  it('cuts on a line boundary, never mid-line', async () => {
    const path = await write('rows.csv', `${'z'.repeat(999)}\n`.repeat(400));
    const result = await readBounded(path);

    expect(result.truncated).toBe(true);
    for (const line of result.content.split('\n').filter(Boolean)) {
      expect(line).toHaveLength(999);
    }
  });

  it('honours an explicit cap', async () => {
    const path = await write('mid.txt', `${'q'.repeat(99)}\n`.repeat(200)); // 20 KB
    const result = await readBounded(path, 4096);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(4096);
  });

  /** A single unbroken line has no boundary to cut on; bound it anyway. */
  it('still bounds a file with no newline at all', async () => {
    const path = await write('oneline.json', 'a'.repeat(400_000));
    const result = await readBounded(path);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content, 'utf-8')).toBeLessThanOrEqual(
      DEFAULT_MAX_READ_BYTES,
    );
  });

  it('does not truncate a file sitting exactly on the cap', async () => {
    const path = await write('exact.txt', 'a'.repeat(DEFAULT_MAX_READ_BYTES));
    const result = await readBounded(path);

    expect(result.truncated).toBeUndefined();
    expect(result.content).toHaveLength(DEFAULT_MAX_READ_BYTES);
  });
});

describe('boundSlice', () => {
  /**
   * The paged path asks in lines, and a line count says nothing about byte
   * size — one row of a data file can be megabytes, so `limit: 500` is not by
   * itself a bound.
   */
  it('bounds a slice whose lines are individually enormous', () => {
    const sliced = `${'x'.repeat(500_000)}\n${'y'.repeat(500_000)}`;
    const { content, meta } = boundSlice(sliced);

    expect(meta.truncated).toBe(true);
    expect(Buffer.byteLength(content, 'utf-8')).toBeLessThanOrEqual(
      DEFAULT_MAX_READ_BYTES,
    );
    expect(meta.hint).toMatch(/limit/);
  });

  it('leaves a normal slice untouched, with no metadata', () => {
    const { content, meta } = boundSlice('one\ntwo\nthree');

    expect(content).toBe('one\ntwo\nthree');
    expect(meta).toEqual({});
  });
});
