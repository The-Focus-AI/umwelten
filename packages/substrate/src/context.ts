/**
 * Revertible effects on a context tree — the substrate's first mechanism
 * (ADR 0031 — interfaces and habitat internals compose on the substrate).
 *
 * The model, from "A Programming Paradigm for Spatiotemporal Composability"
 * (cordiverse/paper §3.1, Algorithm 1): every mutation performed through a
 * context supplies its own inverse at the point of application. The context
 * accumulates inverses; disposing the context replays them LIFO, recovering
 * the environment to its pre-composition state. A child context's disposal
 * is itself a tracked effect of its parent, which is what makes recovery
 * cascade down the tree.
 *
 * That the supplied inverse actually reverts the effect is an obligation on
 * the caller, not a property the runtime verifies (paper §5.1.1) — same
 * posture as Cordis.
 *
 * Isomorphic: no Node or DOM imports in this module.
 */

/** Undoes one effect. May be async; runs at most once. */
export type Inverse = () => void | Promise<void>;

/**
 * Performs one effect and returns its inverse (or nothing, for an effect
 * with no state to revert — e.g. a pure read used for its timing).
 */
export type EffectCallback = () => void | Inverse | Promise<void | Inverse>;

/**
 * Reverts one tracked effect. Idempotent: the second and later calls are
 * no-ops, and the context skips already-disposed effects during recovery.
 */
export type Dispose = () => Promise<void>;

/** Thrown when an operation is attempted on a disposed context. */
export class ContextDisposedError extends Error {
  constructor() {
    super("Context has been disposed; it can no longer track effects.");
    this.name = "ContextDisposedError";
  }
}

interface TrackedEffect {
  dispose: Dispose;
}

export class Context {
  readonly parent: Context | undefined;
  /** LIFO stack of tracked effects; recovery walks it in reverse. */
  private effects: TrackedEffect[] = [];
  private isDisposed = false;
  /** Disarms this context's registration in its parent (child contexts). */
  private detachFromParent: (() => void) | undefined;

  constructor(parent?: Context) {
    this.parent = parent;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Perform an effect and track its inverse. The callback runs immediately
   * (synchronously when it is synchronous); the returned Dispose reverts
   * just this effect, at most once. A synchronous throw in the callback
   * propagates and nothing is tracked.
   */
  effect(callback: EffectCallback): Dispose {
    if (this.isDisposed) throw new ContextDisposedError();

    // Run now. A sync callback yields its inverse immediately; an async one
    // yields a task whose settlement dispose() awaits — the paper's rule
    // that recovery waits for the in-flight transition to complete.
    const result = callback();
    const task: Promise<void | Inverse> =
      result instanceof Promise ? result : Promise.resolve(result);
    // An async callback's failure surfaces in dispose(); prevent unhandled
    // rejection warnings for effects that are never explicitly disposed.
    task.catch(() => {});

    let armed = true;
    const dispose: Dispose = async () => {
      if (!armed) return;
      armed = false;
      let inverse: void | Inverse;
      try {
        inverse = await task;
      } catch {
        // The effect itself failed, so there is nothing to revert.
        return;
      }
      if (inverse) await inverse();
    };

    this.effects.push({ dispose });
    return dispose;
  }

  /**
   * Derive a child context. The child's disposal is a tracked effect of
   * this context, so disposing the parent recovers the child first (LIFO
   * puts later children before earlier ones, and children before the
   * parent's own earlier effects).
   */
  child(): Context {
    if (this.isDisposed) throw new ContextDisposedError();
    const child = new Context(this);
    const detach = this.effect(() => () => child.dispose());
    // Disposing the child directly must also disarm the parent's entry, so
    // the parent's own recovery does not attempt a second (no-op) disposal
    // and so the parent's stack does not accumulate dead entries' work.
    child.detachFromParent = () => void detach();
    return child;
  }

  /**
   * Recover this context: replay every tracked inverse in LIFO order, then
   * mark the context disposed. Errors thrown by inverses do not halt
   * recovery — the remaining inverses still run — and are rethrown at the
   * end (as an AggregateError when there is more than one).
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;

    const stack = this.effects;
    this.effects = [];
    const errors: unknown[] = [];
    for (let i = stack.length - 1; i >= 0; i--) {
      try {
        await stack[i].dispose();
      } catch (err) {
        errors.push(err);
      }
    }

    this.detachFromParent?.();

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, "Errors during context recovery");
  }
}

/** Create a root context. */
export function createContext(): Context {
  return new Context();
}
