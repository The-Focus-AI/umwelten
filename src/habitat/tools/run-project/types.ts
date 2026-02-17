/**
 * Types for the run_project tool: smart container provisioning for agent projects.
 */

import type { AgentEntry } from '../../types.js';

/** A skill/plugin git repo to clone into the container. */
export interface SkillRepo {
  /** Skill name (e.g. "chrome-driver"). */
  name: string;
  /** Git repo: "owner/repo" shorthand or full URL. */
  gitRepo: string;
  /** Where to install in the container (e.g. "/opt/chrome-driver"). */
  containerPath: string;
  /** apt packages required by this skill. */
  aptPackages: string[];
  /** Commands to run after cloning (e.g. build step). */
  setupCommands: string[];
}

/** Requirements detected from a project for container provisioning. */
export interface ProjectRequirements {
  /** Detected project type: npm, pip, cargo, go, shell, unknown */
  projectType: string;
  /** Tools/commands detected in scripts: imagemagick, claude-cli, chrome-driver, git, npx, etc. */
  detectedTools: string[];
  /** Environment variable names needed (from CLAUDE.md, .env, scripts) */
  envVarNames: string[];
  /** apt packages to install */
  aptPackages: string[];
  /** npm packages to install globally */
  npmGlobalPackages: string[];
  /** Commands to run during container setup (in order) */
  setupCommands: string[];
  /** Base Docker image */
  baseImage: string;
  /** Cache volumes for package managers */
  cacheVolumes: CacheVolumeConfig[];
  /** Skill repos to clone into the container. */
  skillRepos: SkillRepo[];
}

/** Cache volume configuration for package managers. */
export interface CacheVolumeConfig {
  /** Cache volume name */
  name: string;
  /** Where to mount in container */
  mountPath: string;
}

/** Experience metadata persisted alongside the experience directory. */
export interface ExperienceMetadata {
  experienceId: string;
  sourcePath: string;
  created: string;
  lastUsed: string;
  agentId?: string;
}

/** Context needed by the run_project tool from the habitat. */
export interface RunProjectContext {
  readonly workDir: string;
  getAgent(idOrName: string): AgentEntry | undefined;
  getAllowedRoots(): string[];
  getSecret(name: string): string | undefined;
}

/** Result returned by the run_project tool. */
export interface RunProjectResult {
  experienceId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  status?: 'new' | 'continued' | 'committed' | 'discarded';
  hint?: string;
  timedOut?: boolean;
  error?: string;
  message?: string;
  detectedRequirements?: {
    projectType: string;
    detectedTools: string[];
    baseImage: string;
    envVarsInjected: string[];
    skillRepos?: string[];
  };
}
