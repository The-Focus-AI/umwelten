/**
 * Habitat Bridge Analyzer
 *
 * Analyzes repositories via the bridge client to detect:
 * - Project type (npm, pip, cargo, etc.)
 * - Required tools and apt packages
 * - Skills needed
 * - Environment variables
 *
 * Adapted from existing run-project detection logic.
 */

import { HabitatBridgeClient } from "./client.js";

export interface AnalysisResult {
  projectType: string;
  detectedTools: string[];
  aptPackages: string[];
  envVarNames: string[];
  skillRepos: Array<{
    name: string;
    gitRepo: string;
    containerPath: string;
    aptPackages: string[];
  }>;
  setupCommands: string[];
}

// Base images per project type (same as existing project-analyzer.ts)
const PROJECT_BASE_IMAGES: Record<string, string> = {
  npm: "node:20",
  pip: "python:3.11",
  cargo: "rust:1.75",
  go: "golang:1.21",
  maven: "maven:3.9-eclipse-temurin-17",
  gradle: "gradle:8.5-jdk17",
  shell: "node:20", // Shell scripts often need node for bridge server
  unknown: "node:20", // Default to node image since bridge server requires node
};

// Project type markers (same as existing context-provider.ts)
const PROJECT_TYPE_MARKERS: Record<string, string[]> = {
  npm: ["package.json", "pnpm-lock.yaml", "yarn.lock"],
  pip: ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile"],
  cargo: ["Cargo.toml"],
  go: ["go.mod", "go.sum"],
  maven: ["pom.xml"],
  gradle: ["build.gradle", "build.gradle.kts", "settings.gradle"],
};

// Tool detection patterns (same as existing project-analyzer.ts)
export const TOOL_PATTERNS: Array<{
  pattern: RegExp;
  tool: string;
  aptPackages?: string[];
}> = [
  {
    pattern: /\b(magick|convert)\b/,
    tool: "imagemagick",
    aptPackages: ["imagemagick"],
  },
  {
    pattern: /\bjq\b/,
    tool: "jq",
    aptPackages: ["jq"],
  },
  {
    pattern: /\bcurl\b/,
    tool: "curl",
    aptPackages: ["curl"],
  },
  {
    pattern: /\bwget\b/,
    tool: "wget",
    aptPackages: ["wget"],
  },
  {
    pattern: /\bgit\b/,
    tool: "git",
    aptPackages: ["git"],
  },
  {
    pattern: /\bpython3?\b/,
    tool: "python",
    aptPackages: ["python3"],
  },
  {
    pattern: /\bffmpeg\b/,
    tool: "ffmpeg",
    aptPackages: ["ffmpeg"],
  },
  {
    pattern: /\bsqlite3\b/,
    tool: "sqlite3",
    aptPackages: ["sqlite3"],
  },
  {
    pattern: /\bchrome|chromium\b/,
    tool: "chrome",
    aptPackages: ["chromium", "chromium-driver"],
  },
  {
    pattern: /\bclaude\b/,
    tool: "claude-code",
    aptPackages: [], // Installed via official installer script
  },
  {
    pattern: /\bop\s+(read|signin|vault)/,
    tool: "1password-cli",
    aptPackages: [], // Installed via apt repo
  },
  {
    pattern: /\bnpx\s+/,
    tool: "npx",
    aptPackages: [], // Comes with node
  },
];

// Tools that need official installation scripts (not apt, not npm)
const OFFICIAL_INSTALLERS: Record<string, string> = {
  "claude-code": "curl -fsSL https://claude.ai/install.sh | bash",
  "1password-cli":
    'apt-get install -y curl gpg && curl -sS https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" | tee /etc/apt/sources.list.d/1password.list && apt-get update && apt-get install -y 1password-cli',
};

// Tools that need custom installation scripts
const CUSTOM_SETUP: Record<string, string> = {
  "1password-cli":
    "curl -sS https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/amd64 stable main' | tee /etc/apt/sources.list.d/1password.list && mkdir -p /etc/debsig/policies/AC2D62742012EA22/ && curl -sS https://downloads.1password.com/linux/debian/debsig/1password.pol | tee /etc/debsig/policies/AC2D62742012EA22/1password.pol && mkdir -p /usr/share/debsig/keyrings/AC2D62742012EA22 && curl -sS https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor --output /usr/share/debsig/keyrings/AC2D62742012EA22/debsig.gpg && apt-get update && apt-get install -y 1password-cli",
};

// Map tool names to their primary apt package for quick lookup
export const TOOL_PACKAGES: Record<string, string | undefined> = {
  imagemagick: "imagemagick",
  jq: "jq",
  curl: "curl",
  wget: "wget",
  git: "git",
  python: "python3",
  ffmpeg: "ffmpeg",
  sqlite3: "sqlite3",
  chrome: "chromium",
  "claude-cli": undefined, // npm global
  "1password-cli": undefined, // custom install
  npx: undefined, // comes with node
};

// Known skills mapping (same as existing skill-provisioner.ts)
const KNOWN_SKILLS: Record<
  string,
  {
    gitRepo: string;
    aptPackages: string[];
    containerPath: string;
  }
> = {
  "chrome-driver": {
    gitRepo: "The-Focus-AI/chrome-driver",
    aptPackages: ["chromium", "perl", "libwww-perl", "libjson-perl"],
    containerPath: "/opt/chrome-driver",
  },
  "nano-banana": {
    gitRepo: "The-Focus-AI/nano-banana-cli",
    aptPackages: [],
    containerPath: "/opt/nano-banana",
  },
};

export class BridgeAnalyzer {
  private client: HabitatBridgeClient;

  constructor(client: HabitatBridgeClient) {
    this.client = client;
  }

  async analyze(workspacePath: string = "/workspace"): Promise<AnalysisResult> {
    // Step 1: Detect project type
    const projectType = await this.detectProjectType(workspacePath);

    // Step 2: Collect and scan scripts
    const scriptContents = await this.collectScriptContents(workspacePath);

    // Step 3: Detect tools from scripts
    const detectedTools = new Set<string>();
    const aptPackages = new Set<string>();

    for (const content of scriptContents) {
      for (const toolDef of TOOL_PATTERNS) {
        if (toolDef.pattern.test(content)) {
          detectedTools.add(toolDef.tool);
          toolDef.aptPackages?.forEach((p) => aptPackages.add(p));
        }
      }
    }

    // Step 4: Detect skills from scripts
    const skillRepos = this.detectSkills(scriptContents);
    skillRepos.forEach((skill) => {
      skill.aptPackages.forEach((p) => aptPackages.add(p));
    });

    // Step 5: Parse CLAUDE.md for env vars
    const envVarNames = await this.parseClaudeMdEnvVars(workspacePath);

    // Step 6: Parse .env files
    const dotEnvVars = await this.parseDotEnvVarNames(workspacePath);
    dotEnvVars.forEach((v) => envVarNames.add(v));

    // Step 7: Determine setup commands based on project type
    const setupCommands = this.getSetupCommands(projectType);

    // Step 8: Add setup commands for detected tools (official installers)
    for (const tool of detectedTools) {
      if (OFFICIAL_INSTALLERS[tool]) {
        setupCommands.push(OFFICIAL_INSTALLERS[tool]);
      }
    }

    return {
      projectType,
      detectedTools: Array.from(detectedTools),
      aptPackages: Array.from(aptPackages),
      envVarNames: Array.from(envVarNames),
      skillRepos,
      setupCommands,
    };
  }

  async detectProjectType(workspacePath: string): Promise<string> {
    // Check for project type markers
    for (const [projectType, markers] of Object.entries(PROJECT_TYPE_MARKERS)) {
      for (const marker of markers) {
        const exists = await this.client.fileExists(
          `${workspacePath}/${marker}`,
        );
        if (exists) {
          return projectType;
        }
      }
    }

    // Check for shell project markers
    const shellMarkers = ["run.sh", "setup.sh", "Makefile", "makefile"];
    for (const marker of shellMarkers) {
      const exists = await this.client.fileExists(`${workspacePath}/${marker}`);
      if (exists) {
        return "shell";
      }
    }

    // Check for bin/ directory
    try {
      const entries = await this.client.listDirectory(`${workspacePath}/bin`);
      if (entries.length > 0) {
        return "shell";
      }
    } catch {
      // bin/ doesn't exist
    }

    return "unknown";
  }

  async collectScriptContents(workspacePath: string): Promise<string[]> {
    const contents: string[] = [];

    // Read scripts from bin/
    try {
      const entries = await this.client.listDirectory(`${workspacePath}/bin`);
      for (const entry of entries) {
        if (entry.type === "file") {
          try {
            const content = await this.client.readFile(
              `${workspacePath}/bin/${entry.name}`,
            );
            contents.push(content);
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // no bin/ dir
    }

    // Read root shell scripts
    const rootScripts = [
      "run.sh",
      "setup.sh",
      "start.sh",
      "build.sh",
      "deploy.sh",
    ];
    for (const script of rootScripts) {
      try {
        const content = await this.client.readFile(
          `${workspacePath}/${script}`,
        );
        contents.push(content);
      } catch {
        // file doesn't exist
      }
    }

    // Read CLAUDE.md
    try {
      const content = await this.client.readFile(`${workspacePath}/CLAUDE.md`);
      contents.push(content);
    } catch {
      // no CLAUDE.md
    }

    return contents;
  }

  private detectSkills(scriptContents: string[]): Array<{
    name: string;
    gitRepo: string;
    containerPath: string;
    aptPackages: string[];
  }> {
    const skillRepos: Array<{
      name: string;
      gitRepo: string;
      containerPath: string;
      aptPackages: string[];
    }> = [];
    const seenSkills = new Set<string>();

    const combined = scriptContents.join("\n");

    // Pattern: ~/.claude/plugins/cache/<marketplace>/<plugin-name>/
    const pluginRefs = combined.matchAll(
      /~\/\.claude\/plugins\/cache\/([^/]+)\/([^/]+)\//g,
    );

    const detectedPlugins = new Set<string>();

    for (const match of pluginRefs) {
      const marketplace = match[1];
      const pluginName = match[2];
      detectedPlugins.add(`${marketplace}/${pluginName}`);
    }

    for (const pluginRef of detectedPlugins) {
      const pluginName = pluginRef.split("/").pop()!;

      if (seenSkills.has(pluginName)) continue;
      seenSkills.add(pluginName);

      const knownSkill = KNOWN_SKILLS[pluginName];

      if (knownSkill) {
        skillRepos.push({
          name: pluginName,
          gitRepo: knownSkill.gitRepo,
          containerPath: knownSkill.containerPath,
          aptPackages: knownSkill.aptPackages,
        });
      } else {
        // Unknown plugin - use marketplace/pluginName as git repo guess
        skillRepos.push({
          name: pluginName,
          gitRepo: pluginRef,
          containerPath: `/opt/${pluginName}`,
          aptPackages: [],
        });
      }
    }

    return skillRepos;
  }

  async parseClaudeMdEnvVars(workspacePath: string): Promise<Set<string>> {
    const envVars = new Set<string>();

    try {
      const content = await this.client.readFile(`${workspacePath}/CLAUDE.md`);

      // Match env var patterns: UPPER_CASE_WITH_UNDERSCORES (at least 2 parts)
      const matches = content.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g);
      for (const match of matches) {
        const name = match[1];
        // Filter to likely env vars (API keys, tokens, secrets, URLs)
        if (
          name.endsWith("_KEY") ||
          name.endsWith("_TOKEN") ||
          name.endsWith("_SECRET") ||
          name.endsWith("_URL") ||
          name.endsWith("_API_KEY") ||
          name.startsWith("ANTHROPIC_") ||
          name.startsWith("OPENAI_") ||
          name.startsWith("GOOGLE_") ||
          name.startsWith("GEMINI_") ||
          name.startsWith("GITHUB_") ||
          name.startsWith("TAVILY_") ||
          name.startsWith("AWS_")
        ) {
          envVars.add(name);
        }
      }
    } catch {
      // no CLAUDE.md
    }

    return envVars;
  }

  async parseDotEnvVarNames(workspacePath: string): Promise<Set<string>> {
    const envVars = new Set<string>();

    for (const envFile of [".env", ".env.example", ".env.local"]) {
      try {
        const content = await this.client.readFile(
          `${workspacePath}/${envFile}`,
        );
        const lines = content.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx > 0) {
              const name = trimmed.substring(0, eqIdx).trim();
              if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
                envVars.add(name);
              }
            }
          }
        }
      } catch {
        // file doesn't exist
      }
    }

    return envVars;
  }

  private getSetupCommands(projectType: string): string[] {
    switch (projectType) {
      case "npm":
        return ["npm install"];
      case "pip":
        return ["pip install -r requirements.txt || pip install -e . || true"];
      case "cargo":
        return ["cargo fetch"];
      case "go":
        return ["go mod download"];
      case "maven":
        return ["mvn dependency:resolve"];
      case "gradle":
        return ["gradle dependencies"];
      default:
        return [];
    }
  }

  getBaseImage(projectType: string): string {
    return PROJECT_BASE_IMAGES[projectType] || PROJECT_BASE_IMAGES.unknown;
  }
}
