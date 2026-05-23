# JSONL Persistence in Node.js: Append Safety, Streaming Reads, and Concurrency Controls

*Date: 2026-05-22 | Sources: 4*

---

## Overview

JSON Lines (JSONL) is an increasingly popular format for logging, audit trails, and agent interaction traces. Because each line is a self-contained, newline-delimited JSON object, it is highly structured yet append-friendly. 

However, building a production-grade JSONL persistence layer in a Node.js/TypeScript environment requires addressing specific execution-model challenges:

- **Append Operations:** Frequent use of `fs.appendFile` degrades performance due to constant file descriptor open/close cycles and risks race conditions. Dedicated write streams (`fs.createWriteStream`) keep a persistent file descriptor and serialize writes internally.
- **Read Operations:** Loading files into memory via `fs.readFile` and splitting by newlines risks out-of-memory (OOM) crashes as files scale. Streaming via the native `readline` module processes lines incrementally, maintaining a low and constant memory footprint.
- **Concurrency & Locking:** Standard file operations lack transactional isolation. For single-process environments, an in-memory Mutex or Promise queue serializes concurrent appends. For multi-process environments, directory-based advisory file locking (via `proper-lockfile`) prevents interleaving and file corruption.

---

## 1. Append Performance and Safety

When writing JSONL logs, developer choice generally falls between high-level utility functions like `fs.promises.appendFile` and lower-level streams via `fs.createWriteStream`.

### The `fs.appendFile` Overhead and Hazards
Every call to `fs.appendFile` performs three distinct system operations under the hood:
1. **Open** the file with the `O_APPEND` flag.
2. **Write** the line buffer.
3. **Close** the file descriptor.

If your application appends frequently (e.g., tracing agent steps or step loops), this cycle introduces significant I/O overhead. 

Furthermore, if multiple asynchronous `fs.appendFile` operations are fired concurrently without being awaited, they are dispatched to the libuv thread pool. Because thread execution order is managed by the OS scheduler, writes can be reordered or, under heavy load, interleaved.

### OS-Level Atomicity (`O_APPEND`)
On POSIX-compliant operating systems, opening a file with the `O_APPEND` flag guarantees that the file write offset is moved to the end-of-file immediately before the write system call. This is an atomic operation at the kernel level.
- **Pipes/FIFOs:** Guaranteed atomic only up to `PIPE_BUF` (typically 4KB).
- **Regular Files:** POSIX does not strictly define a limit for regular files. On local filesystems (e.g., ext4, APFS), writes are generally appended without interleaving, regardless of size. 
- **Network Filesystems (NFS/SMB):** Lack atomic append guarantees. Concurrent writes from different nodes will corrupt files.

### The Stream Advantage
Using `fs.createWriteStream(path, { flags: 'a' })` is both more performant and inherently safer:
- It keeps a single file descriptor open, avoiding open/close system call overhead.
- Node.js's stream implementation manages an internal buffer and write queue. Calling `stream.write()` repeatedly from the same process guarantees that data is written sequentially to the file descriptor in the exact order of calls, preventing interleaving.

### Recommended Append Pattern (Single Stream)

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

export class JsonlWriter<T> {
  private stream: fs.WriteStream;

  constructor(filePath: string) {
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Open in append-only mode ('a')
    this.stream = fs.createWriteStream(filePath, {
      flags: 'a',
      encoding: 'utf8',
    });
  }

  append(data: T): Promise<void> {
    const line = JSON.stringify(data) + '\n';
    
    return new Promise((resolve, reject) => {
      // stream.write returns false if the internal buffer is full (backpressure)
      const fitsInMemory = this.stream.write(line, (error) => {
        if (error) reject(error);
        else resolve();
      });

      if (!fitsInMemory) {
        // Handle backpressure if write buffer is full
        this.stream.once('drain', resolve);
      }
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.stream.end(resolve);
    });
  }
}
```

---

## 2. Read Performance and Safety

Reading JSONL files involves two trade-offs: memory usage and error resilience.

### Streaming vs. In-Memory Buffers
- **In-Memory (`fs.readFile`):** Reading the entire file, splitting by newline (`.split('\n')`), and parsing each line is only acceptable for files under a few megabytes. As files grow, V8 memory limits will trigger process crashes.
- **Streaming (`readline`):** The built-in `readline` module processes the file line-by-line as chunks flow from `fs.createReadStream`. This keeps memory consumption constant (typically < 30MB) even when reading gigabyte-scale datasets.

### Resilient Line Processing
A production-ready reader must handle:
1. **Windows vs. Unix line endings:** Handled via `crlfDelay: Infinity` in `readline`.
2. **Missing Files:** Catching `ENOENT` errors and handling them gracefully.
3. **Empty Files:** Skipping empty or whitespace-only lines without throwing.
4. **Malformed JSON:** Wrapping the parser in `try-catch` to avoid failing the entire read loop if a single line is corrupted.

### Recommended Streaming Read Pattern

```typescript
import * as fs from 'node:fs';
import * as readline from 'node:readline';

export interface ReadOptions {
  ignoreMalformed?: boolean;
}

export async function* readJsonl<T>(
  filePath: string,
  options: ReadOptions = { ignoreMalformed: true }
): AsyncGenerator<T, void, unknown> {
  // Gracefully handle missing file
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity, // Standardizes \r\n and \n
  });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue; // Skip empty lines or trailing newlines

      try {
        const parsed = JSON.parse(trimmed) as T;
        yield parsed;
      } catch (error) {
        if (!options.ignoreMalformed) {
          throw new Error(`Malformed JSONL line: ${line}. Error: ${(error as Error).message}`);
        }
        console.warn(`[JSONL Reader] Skipped malformed line: ${line.slice(0, 60)}…`);
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }
}
```

---

## 3. Concurrency and Locking Mechanisms

In an asynchronous Node.js environment, multiple tasks may attempt to write to the same JSONL file concurrently. This is especially true in agent habitats running parallel tool invocations.

### Why Asynchronous Appends Fail Without Locks
Even if Javascript is single-threaded, it yields control at every `await` boundary. If you have:

```typescript
async function appendEvent(data) {
  const content = JSON.stringify(data) + '\n';
  await fs.promises.appendFile('events.jsonl', content); // Yields here!
}
```

If `appendEvent` is called three times concurrently, all three tasks will open the file descriptor. If they write very large buffers (or if the OS scheduler suspends a thread pool operation mid-write), the output can interleave, rendering the JSON lines unparseable.

```
NO LOCKING (Async Interleaving Risk)
-----------------------------------
Task A: ----[Open]-------------------------[Write Chunk 1]------------[Write Chunk 2 (Close)]
Task B: --------[Open]----[Write Chunk 1]-----------------[Close]
                                 (Result: Interleaved and Corrupt lines)

WITH LOCKING / MUTEX
--------------------+
Task A: ----[Acquire Lock]----[Open]----[Write All]----[Close]----[Release Lock]
Task B:                                                                   [Acquire Lock]----[Open]...
```

### Solution A: Single-Process Concurrency (In-Memory Mutex)
If the concurrency is localized to a single Node.js process, a simple Mutex pattern or Promise serialization queue is the most efficient solution. It ensures that subsequent appends wait for the current append promise to resolve.

#### Lightweight Promise Queue Pattern
This pattern requires zero dependencies and guarantees sequential execution.

```typescript
export class AsyncQueue {
  private queue: Promise<any> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => task());
    // Catch errors to prevent a single failure from blocking the entire queue
    this.queue = next.catch(() => {});
    return next;
  }
}

// Usage in our Writer
export class SafeJsonlWriter<T> {
  private queue = new AsyncQueue();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async append(data: T): Promise<void> {
    await this.queue.enqueue(async () => {
      const line = JSON.stringify(data) + '\n';
      await fs.promises.appendFile(this.filePath, line, 'utf8');
    });
  }
}
```

### Solution B: Multi-Process Concurrency (File Locking)
When multiple Node.js instances (e.g., PM2 clusters, serverless functions, or independent CLI processes) write to the same file, in-memory queues are insufficient. We must synchronize at the filesystem level.

- **Native Locks (`flock`):** Handled via `fs.flock` (if using custom bindings) or native system calls. These are OS-dependent and can hang indefinitely if a process crashes before releasing.
- **Advisory Lockfiles (`proper-lockfile`):** The standard in the Node.js ecosystem. It creates a companion directory (e.g., `events.jsonl.lock`) and handles stale locks, process crashes, and custom retries via exponential backoff.

#### Safe Multi-Process Append Implementation

```typescript
import * as fs from 'node:fs/promises';
import { lock, unlock } from 'proper-lockfile';

export async function safeMultiProcessAppend(filePath: string, data: any): Promise<void> {
  const line = JSON.stringify(data) + '\n';
  
  // Ensure the target file exists before locking
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, '', { flag: 'wx' }).catch(() => {}); // Write if not exists
  }

  // Acquire lock with automatic retries (10 retries over ~3 seconds)
  const release = await lock(filePath, {
    retries: {
      retries: 10,
      factor: 2,
      minTimeout: 50,
      maxTimeout: 500,
    }
  });

  try {
    await fs.appendFile(filePath, line, 'utf8');
  } finally {
    await release(); // Always release in finally block
  }
}
```

---

## 4. Summary Matrix

| Scenario | Recommended Approach | Read Strategy | Write Strategy | Locking Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **Local CLI Tool** | Lightweight File Stream | `readline` stream | `WriteStream` (`'a'`) | None (sequential by design) |
| **Concurrent API Server** | Serialized Writer Queue | `readline` stream | `fs.promises.appendFile` | In-memory `AsyncQueue` / Mutex |
| **Multi-Process / Cluster** | Advisory File Locking | `readline` stream | `fs.promises.appendFile` | `proper-lockfile` directory lock |
| **Distributed / Serverless**| Database / Message Queue | Avoid direct file reads | Write to external queue | Distributed lock (e.g., Redis Redlock) |

---

## Sources
1. [Node.js `fs` API Documentation](https://nodejs.org/api/fs.html)
2. [Node.js `readline` API Documentation](https://nodejs.org/api/readline.html)
3. POSIX `O_APPEND` Atomicity guarantees: IEEE Std 1003.1
4. `proper-lockfile` implementation details on GitHub (v4.1)
