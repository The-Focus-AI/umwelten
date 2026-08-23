/**
 * Services — reactive coeffects on the context tree (ADR 0031; paper §3.2,
 * Algorithms 2–3, and the ordering discipline of Algorithm 5).
 *
 * A provider binds a value at a ServiceKey; providing is itself a revertible
 * effect, so withdrawal is automatic when the providing context is disposed.
 * A declaration names the keys it needs and activates only while all of them
 * are present; every provide/withdraw is classified against it as
 * activating, deactivating, or neutral.
 *
 * The ordering law this module exists to enforce (the part hand-rolled
 * systems get wrong): a departing provider *stops providing* before any of
 * its inverses run — its dependents observe the loss, deactivate, and drain
 * against a still-readable committed view; only then is the binding removed.
 *
 * Realms (isolation, #398) will add an indirection between key and binding;
 * in this slice the tree shares one registry, owned by the root context.
 */

import type { Context, Inverse } from "./context.js";

/** Typed name of a Service. The phantom field carries the value type. */
export interface ServiceKey<T> {
  readonly id: string;
  readonly __type?: T;
}

export function serviceKey<T>(id: string): ServiceKey<T> {
  return { id };
}

/** The bindings a declaration activated against — stable for its lifetime. */
export class CommittedView {
  constructor(private values: Map<string, unknown>) {}
  get<T>(key: ServiceKey<T>): T {
    if (!this.values.has(key.id))
      throw new Error(`Service "${key.id}" is not in this committed view.`);
    return this.values.get(key.id) as T;
  }
}

export interface DeclarationOptions {
  /** The services this declaration needs. */
  inject: ServiceKey<unknown>[];
  /**
   * Runs when every declared service is present. Effects performed on the
   * passed context are reverted on deactivation; a returned inverse is
   * tracked there too. `view` stays readable through deactivation.
   */
  activate: (
    view: CommittedView,
    ctx: Context,
  ) => void | Inverse | Promise<void | Inverse>;
}

/** Inspectable status of one declaration. */
export interface Declaration {
  readonly active: boolean;
  /** Declared keys currently unsatisfied (empty when active). */
  readonly missing: ServiceKey<unknown>[];
  /** The last transition's failure, if it failed; cleared on success. */
  readonly error: unknown;
  /** Resolves when in-flight activation/deactivation transitions finish. */
  settled(): Promise<void>;
}

interface Binding {
  value: unknown;
  /** True from the moment the provider starts leaving until removal. */
  leaving: boolean;
}

class DeclarationImpl implements Declaration {
  active = false;
  error: unknown = undefined;
  private view: CommittedView | undefined;
  private activationCtx: Context | undefined;
  /** Serializes transitions: a refresh never interleaves with another. */
  private chain: Promise<void> = Promise.resolve();
  private unregistered = false;

  constructor(
    private registry: ServiceRegistry,
    private owner: Context,
    private options: DeclarationOptions,
  ) {}

  get missing(): ServiceKey<unknown>[] {
    return this.options.inject.filter((k) => !this.registry.has(k.id));
  }

  declares(id: string): boolean {
    return this.options.inject.some((k) => k.id === id);
  }

  settled(): Promise<void> {
    return this.chain;
  }

  private satisfied(): boolean {
    return this.options.inject.every((k) => this.registry.has(k.id));
  }

  /**
   * Re-evaluate against the registry; queue the transition it implies.
   * Transition failures are recorded on `error`, never left to break the
   * chain — a declaration must keep responding to later notifications.
   */
  refresh(): Promise<void> {
    this.chain = this.chain.then(async () => {
      try {
        const target = !this.unregistered && this.satisfied();
        if (target && !this.active) await this.doActivate();
        else if (!target && this.active) await this.doDeactivate();
      } catch (err) {
        this.error = err;
      }
    });
    return this.chain;
  }

  private async doActivate(): Promise<void> {
    const values = new Map<string, unknown>();
    for (const key of this.options.inject) {
      values.set(key.id, this.registry.read(key.id));
    }
    const view = new CommittedView(values);
    const ctx = this.owner.child();
    try {
      const inverse = await this.options.activate(view, ctx);
      if (inverse) ctx.effect(() => inverse);
      await ctx.settle();
    } catch (err) {
      // Failed activation: revert whatever partial setup happened and stay
      // inactive, with the failure inspectable on the declaration.
      this.error = err;
      await ctx.dispose().catch(() => {});
      return;
    }
    this.view = view;
    this.activationCtx = ctx;
    this.active = true;
    this.error = undefined;
  }

  private async doDeactivate(): Promise<void> {
    this.active = false;
    const ctx = this.activationCtx;
    this.activationCtx = undefined;
    // The committed view stays readable while effects revert: a departing
    // provider's binding is still in place, because its removal is waiting
    // on this very drain.
    try {
      if (ctx) await ctx.dispose();
      this.error = undefined;
    } finally {
      this.view = undefined;
    }
  }

  /** Called when the owning context is disposed. */
  async unregister(): Promise<void> {
    this.unregistered = true;
    await this.refresh();
  }
}

/** One registry per context tree, owned by the root. */
export class ServiceRegistry {
  private bindings = new Map<string, Binding>();
  private declarations = new Set<DeclarationImpl>();

  has(id: string): boolean {
    const b = this.bindings.get(id);
    return b !== undefined && !b.leaving;
  }

  read(id: string): unknown {
    const b = this.bindings.get(id);
    if (!b) throw new Error(`Service "${id}" is not provided.`);
    return b.value;
  }

  /**
   * Notify the declarations that declare this key; return their transitions
   * so a caller can drain them. Scoped to declarers of the key — a change
   * at k cannot flip a declaration that never mentions k, and awaiting
   * unrelated declarations' chains from inside a teardown would deadlock a
   * provider chain (a dependent mid-deactivation withdrawing its own
   * provisions must never wait on its own transition).
   */
  private notify(id: string): Promise<void>[] {
    return [...this.declarations]
      .filter((d) => d.declares(id))
      .map((d) => d.refresh());
  }

  provide<T>(ctx: Context, key: ServiceKey<T>, value: T): () => Promise<void> {
    // Stop providing, then drain: dependents recompute against the loss and
    // tear down while the binding is still readable. Hoisted to the
    // context's pre-dispose phase so it precedes the WHOLE recovery
    // (paper §5.1.3) — and also run from the inverse, for the direct-
    // disposer path; whichever runs second is a no-op. Scoped to THIS
    // binding instance: after a withdraw-and-re-provide swap, the old
    // provider's teardown must not touch the new provider's binding.
    let binding: Binding | undefined;
    const drain = async () => {
      if (!binding || this.bindings.get(key.id) !== binding) return;
      if (!binding.leaving) {
        binding.leaving = true;
        await Promise.all(this.notify(key.id));
      }
    };

    ctx.beforeDispose(drain);
    return ctx.effect(() => {
      if (this.bindings.has(key.id))
        throw new Error(
          `Service "${key.id}" is already provided; a service has one provider at a time (withdraw it first, or use realms once isolation lands).`,
        );
      binding = { value, leaving: false };
      this.bindings.set(key.id, binding);
      void Promise.all(this.notify(key.id));

      return async () => {
        await drain();
        if (this.bindings.get(key.id) === binding) this.bindings.delete(key.id);
      };
    });
  }

  get<T>(key: ServiceKey<T>): T | undefined {
    const b = this.bindings.get(key.id);
    return b && !b.leaving ? (b.value as T) : undefined;
  }

  declare(ctx: Context, options: DeclarationOptions): Declaration {
    const decl = new DeclarationImpl(this, ctx, options);
    this.declarations.add(decl);
    ctx.effect(() => async () => {
      await decl.unregister();
      this.declarations.delete(decl);
    });
    void decl.refresh();
    return decl;
  }
}
