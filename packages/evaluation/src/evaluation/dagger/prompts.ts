/**
 * LLM prompt templates for container configuration
 */

/**
 * Prompt template for container configuration
 */
export const CONTAINER_CONFIG_PROMPT = `You are an expert DevOps engineer. Given a code snippet and its language, provide the optimal Docker container configuration to execute it.

## Code Language
{{language}}

## Code to Execute
\`\`\`{{language}}
{{code}}
\`\`\`

## Required Packages (detected)
{{detectedPackages}}

## Instructions
Analyze the code and provide a JSON configuration with:
1. The best base image (prefer Alpine variants for size)
2. Setup commands to install dependencies (if needed)
3. The exact command to execute the code
4. Any cache volumes for package managers

## Response Format (JSON only)
{
  "baseImage": "string - Docker image name with tag",
  "setupCommands": ["array of shell commands to run before code execution"],
  "runCommand": ["array of command and arguments to execute the code"],
  "cacheVolumes": [
    {"name": "volume-name", "mountPath": "/path/to/cache"}
  ],
  "reasoning": "brief explanation of choices"
}

## Example for Python with pandas:
{
  "baseImage": "python:3.11-alpine",
  "setupCommands": [
    "pip install --no-cache-dir pandas"
  ],
  "runCommand": ["python", "/app/code.py"],
  "cacheVolumes": [
    {"name": "pip-cache", "mountPath": "/root/.cache/pip"}
  ],
  "reasoning": "Using Alpine for smaller image. pandas requires pip install."
}

## Example for TypeScript with external deps:
{
  "baseImage": "node:20-alpine",
  "setupCommands": [
    "npm install -g tsx",
    "npm install lodash"
  ],
  "runCommand": ["npx", "tsx", "/app/code.ts"],
  "cacheVolumes": [
    {"name": "npm-cache", "mountPath": "/root/.npm"}
  ],
  "reasoning": "Using Node 20 Alpine. Installing tsx for TypeScript execution and lodash as detected dependency."
}

Respond with ONLY the JSON configuration, no additional text.`;

/**
 * Prompt for package detection when static detection fails
 */
export const PACKAGE_DETECTION_PROMPT = `Analyze this {{language}} code and list all external packages/dependencies that need to be installed.

\`\`\`{{language}}
{{code}}
\`\`\`

Respond with a JSON array of package names:
["package1", "package2"]

If no external packages are needed (only standard library), respond with: []`;

/**
 * Simple prompt for quick language setup when no packages are needed
 */
export const QUICK_SETUP_PROMPT = `What is the minimal Docker command to run {{language}} code saved as /app/code{{extension}}?

Respond with ONLY the run command as a JSON array, e.g.: ["python", "/app/code.py"]`;
