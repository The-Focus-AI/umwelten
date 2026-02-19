/**
 * Bridge LLM Container Configuration Builder
 *
 * Uses Dagger's LLM integration to analyze a repository and generate
 * optimal container configuration for the Bridge system.
 */

import { dag, connection } from "@dagger.io/dagger";
import type { BridgeProvisioning } from "./lifecycle.js";

const BRIDGE_CONFIG_PROMPT = `You are a container configuration expert. Analyze this repository structure and generate a Dagger container configuration.

Repository files: {{files}}

Key files content:
{{fileContents}}

Generate a JSON configuration with these fields:
{
  "baseImage": "Docker base image (e.g., 'node:20', 'python:3.11', 'ubuntu:22.04')",
  "aptPackages": ["list of apt packages to install"]
}

Rules:
- Choose the most appropriate base image for the detected project type
- Include git in aptPackages (always needed)
- Include any build tools (node, npm, python, pip, cargo, etc.) in aptPackages
- Return ONLY valid JSON, no markdown formatting`;

export class BridgeLLMConfigBuilder {
  /**
   * Generate container configuration using Dagger LLM based on repo analysis
   */
  async generateConfig(
    files: string[],
    fileContents: Record<string, string>,
  ): Promise<BridgeProvisioning> {
    const prompt = BRIDGE_CONFIG_PROMPT.replace(
      "{{files}}",
      files.join("\n"),
    ).replace(
      "{{fileContents}}",
      JSON.stringify(fileContents, null, 2).slice(0, 3000),
    );

    let configJson = "";

    try {
      await connection(
        async () => {
          const env = dag
            .env()
            .withStringInput("prompt", prompt, "Repository analysis request")
            .withStringOutput("config", "Container configuration JSON");

          const llm = dag.llm().withEnv(env).withPrompt(prompt);
          configJson = await llm.lastReply();
        },
        { LogOutput: process.stderr },
      );

      return this.parseConfig(configJson);
    } catch (error) {
      console.warn("LLM config generation failed, using fallback:", error);
      return this.getFallbackConfig(files);
    }
  }

  private parseConfig(response: string): BridgeProvisioning {
    try {
      // Extract JSON from response
      const jsonMatch =
        response.match(/```(?:json)?\s*([\s\S]*?)```/) ||
        response.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        throw new Error("No JSON found in LLM response");
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr.trim());

      return {
        baseImage: parsed.baseImage || "ubuntu:22.04",
        aptPackages: parsed.aptPackages || ["git"],
        gitRepos: [],
      };
    } catch (error) {
      console.warn("Failed to parse LLM config:", error);
      return this.getFallbackConfig([]);
    }
  }

  private getFallbackConfig(files: string[]): BridgeProvisioning {
    // Detect project type from files
    if (files.some((f) => f.includes("package.json"))) {
      return {
        baseImage: "node:20",
        aptPackages: ["git"],
        gitRepos: [],
      };
    }
    if (
      files.some(
        (f) => f.includes("requirements.txt") || f.includes("setup.py"),
      )
    ) {
      return {
        baseImage: "python:3.11",
        aptPackages: ["git"],
        gitRepos: [],
      };
    }
    if (files.some((f) => f.includes("Cargo.toml"))) {
      return {
        baseImage: "rust:1.75",
        aptPackages: ["git"],
        gitRepos: [],
      };
    }

    return {
      baseImage: "ubuntu:22.04",
      aptPackages: ["git"],
      gitRepos: [],
    };
  }
}
