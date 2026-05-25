/**
 * Skill management tools: search, add, remove, list.
 *
 * Skills are installed via `npx skills` at container boot — these
 * tools manage which `skillsFromGit` repos are configured on a
 * habitat (or on Gaia itself). Adding/removing only updates config;
 * the user must rebuild the habitat for installation/removal to
 * take effect.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { GaiaToolsContext } from "./context.js";
import { buildSeedFiles } from "./seed-files.js";

const execFileAsync = promisify(execFile);

export function createSkillsTools(ctx: GaiaToolsContext): Record<string, Tool> {
	const { registry, vault, docker, catalog, gaiaDataDir } = ctx;

	return {
		search_skills: tool({
			description:
				"Search the agent skills ecosystem for skills matching a query. Runs `npx skills find <query>` and returns parsed results with skill names, install counts, and repo URLs. Use this BEFORE calling add_skill — let the user see what's available and pick one.",
			inputSchema: z.object({
				query: z
					.string()
					.describe(
						"Search query (e.g. 'web scraping', 'design', 'firecrawl')",
					),
			}),
			execute: async ({ query }) => {
				try {
					const { stdout } = await execFileAsync(
						"npx",
						["skills", "find", query, "--yes"],
						{ timeout: 30_000, env: { ...process.env, FORCE_COLOR: "0" } },
					);
					// Strip ANSI escape codes
					const clean = stdout.replace(/\x1b\[[0-9;]*m/g, "");
					// Extract skill lines: look for lines with "installs"
					const lines = clean.split("\n");
					const results: { name: string; installs: string; url: string }[] = [];
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i].trim();
						const match = line.match(
							/^(.+?)\s+(\d+\.?\d*[KMB]?\s+installs?)$/i,
						);
						if (match) {
							const name = match[1].trim();
							const installs = match[2].trim();
							// next line has the URL (starts with └)
							let url = "";
							if (i + 1 < lines.length) {
								const nextLine = lines[i + 1].trim();
								const urlMatch = nextLine.match(/https?:\/\/skills\.sh\/\S+/);
								if (urlMatch) url = urlMatch[0];
							}
							results.push({ name, installs, url });
						}
					}
					if (results.length === 0) {
						return `No skills found for "${query}". Try a different query or browse https://skills.sh/.`;
					}
					return JSON.stringify(
						{
							query,
							results,
							hint: "Use add_skill with the 'owner/repo' part of the name (e.g. 'firecrawl/cli'). The '@skill' suffix is optional — omitting it installs all skills in the repo.",
						},
						null,
						2,
					);
				} catch (err: any) {
					return `Skill search failed: ${err.message}. Try browsing https://skills.sh/ directly.`;
				}
			},
		}),

		add_skill: tool({
			description:
				"Add a skill package to a habitat's config. Use 'owner/repo' format (e.g. 'firecrawl/cli'). If no habitat id is specified and no child habitats exist, the skill is added to this orchestrator's own config. Do NOT create a new habitat just to add a skill. The skill is installed via `npx skills` on next rebuild. Call rebuild_habitat afterward to apply.",
			inputSchema: z.object({
				id: z
					.string()
					.optional()
					.describe("Habitat ID (omit to add to this orchestrator itself)"),
				repo: z.string().describe("Skill package (e.g. 'firecrawl/cli')"),
			}),
			execute: async ({ id, repo }) => {
				// Self case: add to Gaia's own config
				if (!id) {
					const configPath = join(gaiaDataDir, "config.json");
					let config: Record<string, any>;
					try {
						config = JSON.parse(await readFile(configPath, "utf-8"));
					} catch {
						config = {};
					}
					if (!config.skillsFromGit) config.skillsFromGit = [];
					if (config.skillsFromGit.includes(repo)) {
						return `Skill "${repo}" is already configured on this orchestrator.`;
					}
					config.skillsFromGit.push(repo);
					await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
					return `Added skill "${repo}" to this orchestrator's config. The skill will be installed on next restart. Restart the Docker container to apply.`;
				}

				// Child habitat case
				const entry = registry.get(id);
				if (!entry)
					return `Habitat "${id}" not found. List habitats to see available IDs.`;

				if (!entry.config.skillsFromGit) {
					entry.config.skillsFromGit = [];
				}
				if (entry.config.skillsFromGit.includes(repo)) {
					return `Skill "${repo}" already configured on habitat "${id}"`;
				}
				entry.config.skillsFromGit.push(repo);
				await registry.update(id, { config: entry.config });
				// Re-seed volume with updated config (skillsFromGit added)
				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));
				return `Added skill "${repo}" to habitat "${id}". Rebuild the habitat to install it.`;
			},
		}),

		remove_skill: tool({
			description: "Remove a skill package from a habitat's config.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
				repo: z.string().describe("Skill package to remove"),
			}),
			execute: async ({ id, repo }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				if (!entry.config.skillsFromGit?.includes(repo)) {
					return `Skill "${repo}" not found in habitat "${id}" config`;
				}
				entry.config.skillsFromGit = entry.config.skillsFromGit.filter(
					(s) => s !== repo,
				);
				await registry.update(id, { config: entry.config });
				// Re-seed volume with updated config (skillsFromGit removed)
				await docker.seedVolume(id, buildSeedFiles(entry, vault, catalog));
				return `Removed skill "${repo}" from habitat "${id}". Rebuild the habitat to apply.`;
			},
		}),

		list_skills: tool({
			description: "List skill packages configured on a habitat.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID"),
			}),
			execute: async ({ id }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;

				const skills = entry.config.skillsFromGit ?? [];
				if (skills.length === 0)
					return `No skills configured on habitat "${id}"`;
				return `Skills on "${id}":\n${skills.map((s) => `  - ${s}`).join("\n")}`;
			},
		}),
	};
}
