/**
 * Types for the Gaia Orchestrator — manages multiple habitat containers.
 */

import type { HabitatConfig } from "../types.js";

/** A registered habitat managed by Gaia. */
export interface GaiaHabitatEntry {
  /** Slug identifier, e.g. "jeeves-bot" */
  id: string;
  /** Display name, e.g. "Jeeves Bot" */
  name: string;
  /** Habitat config (reuses existing type) */
  config: HabitatConfig;
  /** Which master secrets this container gets (env var names, not values) */
  secretBindings: string[];
  /** Auto-generated per-container API key */
  apiKey: string;
  /** Assigned host port (127.0.0.1 only) — set after container starts */
  containerPort?: number;
  /** ISO timestamp */
  createdAt: string;
}

/** Persisted registry of all managed habitats. */
export interface GaiaRegistry {
  habitats: GaiaHabitatEntry[];
}

/** Container status from Docker inspect. */
export type ContainerStatus =
  | "running"
  | "exited"
  | "paused"
  | "restarting"
  | "dead"
  | "created"
  | "not-found";

/** Habitat entry enriched with live container status. */
export interface GaiaHabitatWithStatus extends GaiaHabitatEntry {
  containerStatus: ContainerStatus;
}

/** Options for creating a new habitat entry. */
export interface CreateHabitatOptions {
  id: string;
  name: string;
  gitUrl?: string;
  gitBranch?: string;
  provider?: string;
  model?: string;
  secretBindings?: string[];
}

/** Options for the Gaia orchestrator server. */
export interface GaiaOrchestratorOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  provider?: string;
  model?: string;
}
