/**
 * Components — the unit of composition (ADR 0031; paper §4.1, §4.3, and the
 * lifecycle of Algorithm 5).
 *
 * A Component pairs the Services it declares with an apply function that
 * runs — as tracked effects — once the declaration is satisfied. Mounting a
 * component on a context yields a Fiber: the live instantiation, with an
 * inspectable state and an unmount. Everything apply performs reverts on
 * deactivation or unmount, and a component that mounts sub-components on
 * its activation context cascades: unmounting the parent unmounts them
 * first (LIFO, per the effect laws).
 *
 * Inertia (paper §4.3.3) comes from the declaration's serialized transition
 * chain: a load or unload in flight runs to completion, then the next
 * transition chains — a fiber is never half-mounted.
 */

import type { Context, Inverse } from "./context.js";
import type { CommittedView, ServiceKey } from "./services.js";

export interface ComponentSpec<C = void> {
  /** For diagnostics; not an identity. */
  name?: string;
  /** Services this component needs before it can run. */
  inject?: ServiceKey<unknown>[];
  /**
   * Runs when the declaration is satisfied. Effects performed on `ctx`
   * (including mounting sub-components) revert on deactivation; a returned
   * inverse is tracked there too. `view` is the committed view of the
   * declared services, stable through teardown.
   */
  apply: (
    ctx: Context,
    view: CommittedView,
    config: C,
  ) => void | Inverse | Promise<void | Inverse>;
}

/** The live instantiation of a component on a context. */
export interface Fiber {
  /** Diagnostic name, from the spec. */
  readonly name: string | undefined;
  /** True while the component's effects are in place. */
  readonly active: boolean;
  /** Declared services currently unsatisfied. */
  readonly missing: ServiceKey<unknown>[];
  /** The last transition's failure, if it failed. */
  readonly error: unknown;
  /** Resolves when in-flight transitions have finished. */
  settled(): Promise<void>;
  /** Unmount: revert everything, permanently. Idempotent. */
  unmount(): Promise<void>;
}

/**
 * Mount a component. The fiber lives under `ctx` — disposing `ctx` unmounts
 * it — and activates/deactivates reactively as its declared services come
 * and go.
 */
export function mount<C>(
  ctx: Context,
  spec: ComponentSpec<C>,
  ...args: C extends void ? [] : [config: C]
): Fiber {
  const config = args[0] as C;
  // Own child context so unmount() can revert this fiber alone without
  // touching anything else the caller mounted on `ctx`.
  const owner = ctx.child();
  const declaration = owner.declare({
    inject: spec.inject ?? [],
    activate: (view, activationCtx) =>
      spec.apply(activationCtx, view, config),
  });

  return {
    name: spec.name,
    get active() {
      return declaration.active;
    },
    get missing() {
      return declaration.missing;
    },
    get error() {
      return declaration.error;
    },
    settled: async () => {
      await declaration.settled();
    },
    unmount: async () => {
      await owner.dispose();
      await declaration.settled();
    },
  };
}
