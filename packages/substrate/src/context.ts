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

import {
  ServiceRegistry,
  type Declaration,
  type DeclarationOptions,
  type ServiceKey,
} from "./services.js";

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
  /** Setup tasks still in flight; settle() awaits them. */
  private pending = new Set<Promise<unknown>>();
  /**
   * Steps that run before recovery begins — the paper's rule (§5.1.3) that
   * a departing provider's dependents drain ahead of the WHOLE recovery,
   * never from inside one inverse where LIFO would leave the rest
   * unordered. Registered by the services layer for each provision.
   */
  private preDispose: Array<() => Promise<void>> = [];
  /** Service registry — lazily created, lives on the root (until realms). */
  private serviceRegistry: ServiceRegistry | undefined;

  constructor(parent?: Context) {
    this.parent = parent;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  /** The root of this context tree. */
  get root(): Context {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let ctx: Context = this;
    while (ctx.parent) ctx = ctx.parent;
    return ctx;
  }

  private registry(): ServiceRegistry {
    const root = this.root;
    root.serviceRegistry ??= new ServiceRegistry();
    return root.serviceRegistry;
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
    this.pending.add(task);
    task.finally(() => this.pending.delete(task)).catch(() => {});

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
   * Derive a child context. By default the child's disposal is a tracked
   * effect of this context, so disposing the parent recovers the child
   * first (LIFO puts later children before earlier ones, and children
   * before the parent's own earlier effects).
   *
   * `detached: true` keeps the parent link (for root/registry resolution)
   * but registers nothing here — the caller owns the child's recovery.
   * Used by the services layer for activation contexts, whose disposal
   * must route through the declaration's serialized transition chain: a
   * direct cascade would tear the context out from under an in-flight
   * activation, discarding the inverse it was about to return.
   */
  child(options?: { detached?: boolean }): Context {
    if (this.isDisposed) throw new ContextDisposedError();
    const child = new Context(this);
    if (!options?.detached) {
      const detach = this.effect(() => () => child.dispose());
      // Disposing the child directly must also disarm the parent's entry,
      // so the parent's own recovery does not attempt a second (no-op)
      // disposal and the stack does not accumulate dead entries' work.
      child.detachFromParent = () => void detach();
    }
    return child;
  }

  /**
   * Await every in-flight effect setup on this context. New effects
   * registered while settling are awaited too. Failed setups are surfaced
   * by their own dispose(), not here.
   */
  async settle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /**
   * Provide a Service on this context tree. A revertible effect: disposing
   * this context (or the returned disposer) withdraws it — after the
   * dependents that declared it have drained. One provider per key at a
   * time (realms lift this later, per ADR 0031 D4).
   */
  provide<T>(key: ServiceKey<T>, value: T): Dispose {
    return this.registry().provide(this, key, value);
  }

  /** Read a Service binding directly. Undefined when absent or leaving. */
  get<T>(key: ServiceKey<T>): T | undefined {
    return this.registry().get(key);
  }

  /**
   * Declare needed Services. The activate callback runs when all are
   * present — with a CommittedView of the bindings it saw — and everything
   * it did reverts when any of them leaves. Reactivates on return.
   */
  declare(options: DeclarationOptions): Declaration {
    return this.registry().declare(this, options);
  }

  /**
   * Recover this context: replay every tracked inverse in LIFO order, then
   * mark the context disposed. Errors thrown by inverses do not halt
   * recovery — the remaining inverses still run — and are rethrown at the
   * end (as an AggregateError when there is more than one).
   */
  /** Register a step that runs ahead of this context's recovery. */
  beforeDispose(step: () => Promise<void>): void {
    if (this.isDisposed) throw new ContextDisposedError();
    this.preDispose.push(step);
  }

  async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;

    const errors: unknown[] = [];

    // Drain first: dependents of anything provided here tear down against
    // still-readable bindings before a single inverse runs.
    const steps = this.preDispose;
    this.preDispose = [];
    for (let i = steps.length - 1; i >= 0; i--) {
      try {
        await steps[i]();
      } catch (err) {
        errors.push(err);
      }
    }

    const stack = this.effects;
    this.effects = [];
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
