export type {
  CapabilityName,
  CapabilityProbe,
  HeadroomMeta,
  HeadroomPolicy,
  HeadroomSample,
  MachineState,
  ManagedOptions,
  OfferDraft,
  ProbedOffer,
  SaturationVerdict,
  ServingMode,
  SupplierConfig,
} from "./types.js";

export { discoverRuntimes } from "./discover.js";
export { probeOffer } from "./probe.js";
export { findDuplicateModels, probeTargets, toOfferDrafts } from "./offers.js";
export { ExchangeClient } from "./exchange-client.js";
export type { ExchangeClientOptions, PublishResult } from "./exchange-client.js";

export {
  detectResources,
  estimateCandidates,
  estimateLoadBytes,
  estimateParamsB,
} from "./candidates.js";
export type {
  Accelerator,
  AcceleratorKind,
  Candidate,
  CandidateSet,
  DetectEffects,
  Exclusion,
  MachineResources,
} from "./candidates.js";
export { detectMachineResources, nodeDetectEffects } from "./candidates-node.js";

export {
  HEADROOM_POLICY,
  MAX_SAMPLE_CONCURRENCY,
  classifySaturation,
  meetsPolicy,
  sanitizeLevels,
  servesConcurrently,
} from "./headroom.js";

export {
  ManagedModeError,
  RUNTIME_CONCURRENCY,
  chooseManagedRuntime,
  extractQuant,
  matchWeights,
  planManagedRuntime,
  selectWeights,
  verifyConcurrency,
} from "./managed.js";
export type { ManagedPlan, PinnedModel } from "./managed.js";

export { ManagedRuntime, RuntimeStartError, nodeRuntimeEffects } from "./runtime.js";
export type { RuntimeEffects, SpawnedProcess } from "./runtime.js";

export { OfferSupervisor, WITHDRAW_AFTER_FAILURES } from "./supervisor.js";
export type { OfferHealth, SupervisorChange } from "./supervisor.js";

export { HEALTH_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, runServeLoop } from "./serve.js";
export type { ServeEffects, ServeOptions } from "./serve.js";

export {
  DEFAULT_REPROBE_INTERVAL_MS,
  capabilitiesChanged,
  fingerprint,
  reprobeReason,
} from "./fingerprint.js";
export type { ProbeInputs, StalenessInput } from "./fingerprint.js";

export {
  STATE_VERSION,
  clearRuntimePid,
  loadConfig,
  loadCredential,
  loadState,
  nodeOrphanEffects,
  reapOrphanedRuntime,
  recordRuntimePid,
  saveConfig,
  saveCredential,
  saveState,
  supplierDir,
} from "./state.js";
export type { OrphanEffects, PersistedConfig, PersistedState } from "./state.js";

export { defaultServiceKind, launchdPlist, renderService, systemdUnit } from "./service.js";
export type { ServiceKind, ServiceOptions } from "./service.js";

export { supplierCommand } from "./command.js";
