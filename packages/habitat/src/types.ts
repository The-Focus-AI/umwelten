export interface AgentIdentityScope {
  env?: string[];
}

export interface AgentEntry {
  id: string;
  name?: string;
  kind?: "repo" | "mcp-agent" | "remote-habitat" | "service" | string;
  mode?: "read" | "write";
  gitRemote?: string;
  gitBranch?: string;
  secrets?: string[];
  identity?: {
    scopes?: AgentIdentityScope[];
  };
}

export interface HabitatConfig {
  name?: string;
  defaultProvider?: string;
  defaultModel?: string;
  projectDir?: string;
  gitUrl?: string;
  gitBranch?: string;
  agents?: AgentEntry[];
  skillsFromGit?: string[];
}
