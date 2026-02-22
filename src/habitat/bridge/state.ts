/**
 * Bridge state types for persistence and supervision.
 */

import type { SavedProvisioning } from "../types.js";

/** Status of a supervised bridge container. */
export type SupervisorStatus =
  | "building"
  | "running"
  | "unhealthy"
  | "rebuilding"
  | "error"
  | "stopped";

/** Persisted state for a supervised bridge — written to agents/{id}/supervisor.json. */
export interface SupervisorState {
  agentId: string;
  status: SupervisorStatus;
  port?: number;
  buildAttempts: number;
  maxBuildAttempts: number;
  lastHealthCheck?: string;
  lastError?: string;
  consecutiveFailures: number;
  provisioning?: SavedProvisioning;
  startedAt?: string;
  stoppedAt?: string;
}

/**
 * Legacy BridgeState for backwards compatibility during transition.
 * @deprecated Use SupervisorState instead.
 */
export interface BridgeState {
  agentId: string;
  port: number;
  pid: number;
  status: "starting" | "running" | "stopped" | "error";
  createdAt: string;
  lastHealthCheck: string;
  containerId?: string;
  repoUrl: string;
  error?: string;
}
