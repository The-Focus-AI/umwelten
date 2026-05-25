/**
 * Render the markdown MEMORY.md content that `agent_configure` writes
 * to disk for a managed agent. Plus the helper that collects which
 * secret refs from a run contract should end up on the AgentEntry.
 */

import type { AgentEntry } from "../../types.js";
import type { AgentConfigureContract } from "./configure-contract.js";

export function renderAgentMemory(
	agent: AgentEntry,
	contract: AgentConfigureContract,
): string {
	const secretRefs = collectContractSecretRefs(contract);
	const lines: string[] = [
		`# ${agent.name} MEMORY`,
		"",
		`Updated: ${new Date().toISOString()}`,
		"",
		"## Purpose",
		contract.purpose,
		"",
		"## Summary",
		contract.summary,
		"",
		"## Recommended Runtime",
		contract.recommendedRuntime,
		"",
		"## Entry Points",
		...contract.entrypoints.map((entrypoint) => `- ${entrypoint}`),
		"",
		"## Commands",
		`- setup: ${contract.setupCommand ?? "(not identified)"}`,
		`- run: ${contract.runCommand ?? "(not identified)"}`,
		"",
		"## Required Env Vars",
		...(contract.requiredEnvVars.length > 0
			? contract.requiredEnvVars.map(
					(envVar) =>
						`- ${envVar.name} (${envVar.required ? "required" : "optional"}): ${envVar.reason}`,
				)
			: ["- none identified"]),
		"",
		"## Secret Refs",
		...(secretRefs.length > 0
			? secretRefs.map((secretRef) => `- ${secretRef}`)
			: ["- none identified"]),
		"",
		"## Required CLI Tools",
		...(contract.requiredCliTools.length > 0
			? contract.requiredCliTools.map(
					(tool) =>
						`- ${tool.name} (${tool.required ? "required" : "optional"}): ${tool.reason}`,
				)
			: ["- none identified"]),
		"",
		"## Auth Requirements",
		...(contract.authRequirements.length > 0
			? contract.authRequirements.flatMap((auth) => {
					const detailParts: string[] = [];
					if (auth.secretRefs.length > 0) {
						detailParts.push(`secret refs: ${auth.secretRefs.join(", ")}`);
					}
					if (auth.cliTools.length > 0) {
						detailParts.push(`tools: ${auth.cliTools.join(", ")}`);
					}
					const detailSuffix =
						detailParts.length > 0 ? ` [${detailParts.join(" | ")}]` : "";
					const noteLines =
						auth.notes.length > 0
							? auth.notes.map((note) => `  note: ${note}`)
							: [];
					return [
						`- ${auth.system} (${auth.required ? "required" : "optional"}): ${auth.reason}${detailSuffix}`,
						...noteLines,
					];
				})
			: ["- none identified"]),
		"",
		"## Host Integrations",
		...(contract.hostIntegrations.length > 0
			? contract.hostIntegrations.map((integration) => {
					const pathPart = integration.path
						? ` [path: ${integration.path}]`
						: "";
					return `- ${integration.name} (${integration.required ? "required" : "optional"}): ${integration.reason}${pathPart}`;
				})
			: ["- none identified"]),
		"",
		"## Notes",
		...(contract.notes.length > 0
			? contract.notes.map((note) => `- ${note}`)
			: ["- none"]),
		"",
	];

	return lines.join("\n");
}

export function collectContractSecretRefs(
	contract: Pick<
		AgentConfigureContract,
		"requiredEnvVars" | "authRequirements"
	>,
): string[] {
	return Array.from(
		new Set([
			...contract.requiredEnvVars
				.filter((envVar) => envVar.required)
				.map((envVar) => envVar.name.trim())
				.filter(Boolean),
			...contract.authRequirements
				.filter((auth) => auth.required)
				.flatMap((auth) => auth.secretRefs)
				.map((secretRef) => secretRef.trim())
				.filter(Boolean),
		]),
	);
}

export function collectAgentSecretRefs(
	agent: AgentEntry,
	contract: AgentConfigureContract,
): string[] {
	return Array.from(
		new Set([...(agent.secrets ?? []), ...collectContractSecretRefs(contract)]),
	);
}
