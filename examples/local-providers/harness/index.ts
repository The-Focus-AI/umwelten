/**
 * Local-providers harness — Layer 2 of the eval architecture.
 *
 * Wraps the provider-agnostic `runFullEval` with system-state probes,
 * preflight gating, eviction, and AbortController-backed watchdog
 * cancellation.
 */

export { runHarness } from './runner.js';
export type { CellOutcome, CellReport, HarnessOptions, MatrixEntry } from './runner.js';

export { assertCanRun, formatPreflight, PreflightError } from './preflight.js';
export type { PreflightOptions } from './preflight.js';

export {
  evictAll,
  evictAndWait,
  waitForMemoryBelow,
  skipIfAlreadyLoaded,
} from './eviction.js';

export {
  getBatteryState,
  getLoadedModels,
  getModelMemoryBytes,
  getSystemState,
  fmtBytes,
} from './system-state.js';
export type {
  BatteryState,
  LoadedModel,
  SystemStateSnapshot,
} from './system-state.js';

export { runWithWatchdog } from './cancellation.js';
export type {
  WatchdogOutcome,
  WatchdogResult,
  WatchdogTimeout,
  WatchdogError,
} from './cancellation.js';

export { collectTimeoutDiagnostic, saveDiagnostic } from './diagnostics.js';
export type { TimeoutDiagnostic } from './diagnostics.js';
