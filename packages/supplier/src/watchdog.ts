/**
 * Run a task with a hard deadline.
 *
 * Promoted from `examples/local-providers/harness/cancellation.ts`, where it was
 * written for benchmark runs. A probe that hangs must not hang the agent — a
 * machine with one wedged Model should still publish the rest.
 */

export interface WatchdogResult<T> {
  ok: true;
  value: T;
  elapsedMs: number;
}

export interface WatchdogTimeout {
  ok: false;
  reason: 'timeout';
  elapsedMs: number;
}

export interface WatchdogError {
  ok: false;
  reason: 'error';
  error: unknown;
  elapsedMs: number;
}

export type WatchdogOutcome<T> = WatchdogResult<T> | WatchdogTimeout | WatchdogError;

/**
 * Run `task(signal)` with a watchdog timer. If the timer fires before
 * the task settles, `controller.abort()` is called and the outcome is
 * `{ ok: false, reason: 'timeout' }`.
 *
 * The task is responsible for honoring the signal (passing it to the
 * SDK call). If it doesn't, the watchdog timer still resolves the
 * outer promise — but the underlying work will keep going in the
 * background, which is exactly the bug this design is meant to expose.
 */
export async function runWithWatchdog<T>(opts: {
  /** Hard ceiling. Default 10 minutes. */
  timeoutMs?: number;
  /** Optional caller-supplied signal we should also honor. */
  parentSignal?: AbortSignal;
  task: (signal: AbortSignal) => Promise<T>;
}): Promise<WatchdogOutcome<T>> {
  const { timeoutMs = 10 * 60_000, parentSignal, task } = opts;
  const start = Date.now();
  const controller = new AbortController();

  // Forward the parent signal if one is provided.
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason);
    else parentSignal.addEventListener('abort', () => controller.abort(parentSignal.reason), {
      once: true,
    });
  }

  let timer: NodeJS.Timeout | null = null;
  const timerPromise = new Promise<WatchdogTimeout>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`watchdog timeout after ${timeoutMs}ms`));
      resolve({ ok: false, reason: 'timeout', elapsedMs: Date.now() - start });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  try {
    const value = await Promise.race([
      task(controller.signal).then(
        (v): WatchdogResult<T> => ({ ok: true, value: v, elapsedMs: Date.now() - start }),
        (error): WatchdogError => ({
          ok: false,
          reason: 'error',
          error,
          elapsedMs: Date.now() - start,
        }),
      ),
      timerPromise,
    ]);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
