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
  skillsFromGit?: string[];
}

/** Status of a credential (whether it's known to be working). */
export type CredentialStatus = "active" | "expired" | "unknown";

/**
 * Metadata about a secret stored in Gaia's master vault.
 * Stores what the key grants, which provider it's for, and verification info.
 * No actual secret values — only metadata.
 */
export interface CredentialEntry {
  /** Stable machine name, e.g. "accounting-bot-read-key" */
  name: string;
  /** Human-readable label */
  label: string;
  /** Provider namespace, e.g. "intuit/quickbooks", "github", "openrouter" */
  provider: string;
  /** Capability names this credential grants, e.g. ["quickbooks:read", "quickbooks:write"] */
  capabilities: string[];
  /** Upstream OAuth scopes or API permission names, e.g. ["accounts:read"] */
  scopes: string[];
  /** Optional URL to a billing/quotas dashboard for this credential */
  dashboardUrl?: string;
  /** Where the actual secret lives: 1Password item UUID, age key name, vault entry */
  sourceVaultRef?: string;
  /** Whether this credential has been verified recently */
  status: CredentialStatus;
  /** ISO timestamp of last verification */
  lastVerified?: string;
  /** ISO timestamp when OAuth refresh token expires (if applicable) */
  refreshTokenExpiry?: string;
}

/** Options for the Gaia orchestrator server. */
export interface GaiaOrchestratorOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  provider?: string;
  model?: string;
}
