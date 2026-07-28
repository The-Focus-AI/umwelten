/**
 * Read the volume state the provisioning decision depends on.
 *
 * Kept apart from `planProvision` so the decision itself never touches the
 * filesystem: tests describe a volume as a literal, and the one place that
 * does I/O is this file, behind an injectable `exists` probe.
 */

import { join } from "node:path";
import { fileExists } from "../config.js";
import { normalizeAgents } from "./plan.js";
import { provisionedMarkerPath, staleMarkerPath } from "./stale.js";
import type { HabitatConfig } from "../types.js";
import type { AgentVolumeState, VolumeState } from "./types.js";

export interface VolumeProbe {
  exists(path: string): Promise<boolean>;
}

const realProbe: VolumeProbe = { exists: fileExists };

export interface ReadVolumeStateInput {
  workDir: string;
  config: HabitatConfig;
  probe?: VolumeProbe;
}

export async function readVolumeState(
  input: ReadVolumeStateInput,
): Promise<VolumeState> {
  const { workDir, config, probe = realProbe } = input;
  const ownedRepoDir = join(workDir, config.projectDir ?? "project");
  const agentsDir = join(workDir, "agents");

  const [
    configPresent,
    ownedRepoCloned,
    skillsLockPresent,
    volumeProvisioned,
    staleMarkerPresent,
  ] = await Promise.all([
    probe.exists(join(workDir, "config.json")),
    probe.exists(join(ownedRepoDir, ".git")),
    probe.exists(join(workDir, "skills-lock.json")),
    probe.exists(provisionedMarkerPath(workDir)),
    probe.exists(staleMarkerPath(workDir)),
  ]);

  const agents: Record<string, AgentVolumeState> = {};
  await Promise.all(
    normalizeAgents(config.agents).map(async (agent) => {
      agents[agent.id] = {
        repoCloned: await probe.exists(join(agentsDir, agent.id, "repo", ".git")),
      };
    }),
  );

  return {
    configPresent,
    ownedRepoCloned,
    skillsLockPresent,
    volumeProvisioned,
    staleMarkerPresent,
    agents,
  };
}
