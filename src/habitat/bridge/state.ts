/**
 * Bridge state persistence for multi-agent support
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
