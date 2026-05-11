/**
 * Deterministic skill inspector.
 *
 * Walks a skill directory and infers the AgentRequirements (env vars + CLI
 * tools) from the source. The intentional design constraint: this MUST NOT
 * extend the SkillDefinition spec — requirements are *discovered* from
 * existing skill files, never declared in metadata.
 *
 * Inputs:
 *   - SKILL.md (look for "Required environment variables" / "Required tools" sections)
 *   - scripts/*, references/*, assets/*  — any .ts/.js/.mjs/.cjs/.sh/.bash/.py
 *
 * Heuristics (ordered, deduped):
 *   - Node: `process.env.NAME` / `process.env["NAME"]` / `process.env['NAME']`
 *   - Shell: `${NAME}` / `$NAME` (only ALL_CAPS, ≥3 chars; PATH/HOME/etc. filtered)
 *   - Python: `os.environ["NAME"]` / `os.getenv("NAME")`
 *   - CLI tools: shebangs, `exec*("tool")`, `subprocess.run(["tool", ...])`,
 *     and bare command-line invocations in shell scripts.
 *
 * Reasons are short and self-explanatory ("referenced in scripts/run.ts").
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, extname } from "node:path";
import type { AgentRequirements, CapabilityHint } from "../types.js";

/** Minimal interface for the credential catalog — keeps the inspector decoupled. */
export interface InspectorCatalog {
	get(name: string): { name: string; capabilities: string[] } | undefined;
}

const ENV_NOISE = new Set([
	"PATH",
	"HOME",
	"USER",
	"SHELL",
	"PWD",
	"LANG",
	"TERM",
	"TMPDIR",
	"EDITOR",
	"OLDPWD",
	"DISPLAY",
	"HOSTNAME",
	"LC_ALL",
	"LD_LIBRARY_PATH",
	"LOGNAME",
	"MAIL",
	"PS1",
	"PS2",
	"TZ",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_CACHE_HOME",
	"NODE_ENV",
	"DEBUG",
	"CI",
	"GITHUB_ACTIONS",
]);

const CLI_NOISE = new Set([
	"echo",
	"cat",
	"ls",
	"cd",
	"pwd",
	"exit",
	"true",
	"false",
	"test",
	"[",
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"for",
	"while",
	"do",
	"done",
	"set",
	"unset",
	"export",
	"source",
	".",
	"read",
	"shift",
	"return",
	"printf",
	"sleep",
	"trap",
	"wait",
	"eval",
	"exec",
	"function",
	"case",
	"esac",
	"select",
	"until",
	"in",
	"let",
	"local",
	"declare",
	"readonly",
	"typeset",
	"alias",
	"command",
	"type",
	"which",
	"hash",
	"history",
	"fg",
	"bg",
	"jobs",
	"kill",
	"umask",
	"ulimit",
	"cd",
	"pushd",
	"popd",
	"dirs",
	"complete",
	"env",
	"tee",
	"head",
	"tail",
	"sort",
	"uniq",
	"wc",
	"tr",
	"cut",
	"paste",
	"awk",
	"sed",
	"grep",
	"find",
	"xargs",
	"rm",
	"cp",
	"mv",
	"mkdir",
	"rmdir",
	"touch",
	"ln",
	"chmod",
	"chown",
	"chgrp",
	"stat",
	"df",
	"du",
	"free",
	"ps",
	"top",
	"uname",
	"hostname",
	"id",
	"whoami",
	"groups",
	"passwd",
	"su",
	"sudo",
]);

const CODE_EXTS = new Set([
	".ts",
	".tsx",
	".js",
	".mjs",
	".cjs",
	".jsx",
	".py",
]);
const SHELL_EXTS = new Set([".sh", ".bash", ".zsh", ".fish"]);
const SCAN_DIRS = ["scripts", "references", "assets"];

const MAX_FILE_SIZE = 256 * 1024; // skip huge generated files

interface Hit {
	reason: string;
	required: boolean;
}

function addEnv(map: Map<string, Hit>, name: string, source: string): void {
	if (ENV_NOISE.has(name)) return;
	if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name)) return;
	if (!map.has(name)) {
		map.set(name, { reason: `referenced in ${source}`, required: true });
	}
}

function addCli(map: Map<string, Hit>, name: string, source: string): void {
	if (CLI_NOISE.has(name)) return;
	if (!/^[a-z][a-z0-9_-]{1,}$/i.test(name)) return;
	if (!map.has(name)) {
		map.set(name, { reason: `invoked in ${source}`, required: true });
	}
}

function scanCodeFile(
	content: string,
	rel: string,
	env: Map<string, Hit>,
	cli: Map<string, Hit>,
): void {
	// process.env.NAME / process.env["NAME"]
	for (const m of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
		addEnv(env, m[1], rel);
	}
	for (const m of content.matchAll(
		/process\.env\[(?:"|')([A-Z][A-Z0-9_]+)(?:"|')\]/g,
	)) {
		addEnv(env, m[1], rel);
	}
	// os.environ / os.getenv (Python)
	for (const m of content.matchAll(
		/os\.environ(?:\.get)?\((?:"|')([A-Z][A-Z0-9_]+)(?:"|')/g,
	)) {
		addEnv(env, m[1], rel);
	}
	for (const m of content.matchAll(
		/os\.environ\[(?:"|')([A-Z][A-Z0-9_]+)(?:"|')\]/g,
	)) {
		addEnv(env, m[1], rel);
	}
	for (const m of content.matchAll(
		/os\.getenv\((?:"|')([A-Z][A-Z0-9_]+)(?:"|')/g,
	)) {
		addEnv(env, m[1], rel);
	}
	// execFile / spawn / spawnSync / exec — first string arg
	for (const m of content.matchAll(
		/\b(?:execFile|spawn|spawnSync|execFileSync|execSync|exec)\((?:"|'|`)([a-z][a-z0-9_-]+)(?:"|'|`)/gi,
	)) {
		addCli(cli, m[1].toLowerCase(), rel);
	}
	// subprocess.run(["cmd", ...]) (Python)
	for (const m of content.matchAll(
		/subprocess\.(?:run|call|Popen|check_output|check_call)\(\s*\[\s*(?:"|')([a-z][a-z0-9_-]+)(?:"|')/gi,
	)) {
		addCli(cli, m[1].toLowerCase(), rel);
	}
}

function scanShellFile(
	content: string,
	rel: string,
	env: Map<string, Hit>,
	cli: Map<string, Hit>,
): void {
	// ${NAME} and $NAME
	for (const m of content.matchAll(
		/\$\{([A-Z][A-Z0-9_]+)(?::[-?+=][^}]*)?\}/g,
	)) {
		addEnv(env, m[1], rel);
	}
	for (const m of content.matchAll(/\$([A-Z][A-Z0-9_]{2,})\b/g)) {
		addEnv(env, m[1], rel);
	}
	// First token of each non-empty, non-comment line that isn't a builtin
	for (const rawLine of content.split("\n")) {
		const line = rawLine.replace(/#.*$/, "").trim();
		if (!line) continue;
		// strip leading var assignments like FOO=bar
		const noAssign = line.replace(/^([A-Z_][A-Z0-9_]*=\S*\s+)+/, "");
		const first = noAssign.split(/\s+/)[0];
		if (
			!first ||
			first.startsWith("$") ||
			first.startsWith("/") ||
			first.includes("=")
		)
			continue;
		addCli(cli, first.toLowerCase(), rel);
	}
}

function scanMarkdown(
	content: string,
	rel: string,
	env: Map<string, Hit>,
): void {
	// Pull bullet items under "Required environment variables", "Env vars", or "Environment".
	const lines = content.split("\n");
	let inEnvSection = false;
	for (const line of lines) {
		if (
			/^#{1,6}\s+(?:required\s+)?(?:environment(?:\s+variables?)?|env\s*vars?)\b/i.test(
				line,
			)
		) {
			inEnvSection = true;
			continue;
		}
		if (/^#{1,6}\s+/.test(line)) {
			inEnvSection = false;
			continue;
		}
		if (!inEnvSection) continue;
		// bullet `- NAME` or `- \`NAME\` — description`
		const m = line.match(/^[-*]\s+`?([A-Z][A-Z0-9_]+)`?/);
		if (m) addEnv(env, m[1], `${rel} (declared in section)`);
	}
}

async function* walk(dir: string): AsyncGenerator<string> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(full);
		} else if (entry.isFile()) {
			yield full;
		}
	}
}

/**
 * Options for skill inspection.
 */
export interface InspectSkillOptions {
	/**
	 * Optional credential catalog. When provided, discovered env vars are
	 * cross-referenced against catalog entries to produce capability hints.
	 */
	catalog?: InspectorCatalog;
}

/**
 * Inspect a skill directory and return the discovered requirements.
 * Returns empty arrays if the directory is unreadable; that case is the
 * caller's signal to skip.
 *
 * When `options.catalog` is provided, env vars found in source files are
 * looked up in the catalog: if a credential entry has a matching name and
 * declares capabilities, those become CapabilityHint entries in the result.
 */
export async function inspectSkill(
	skillDir: string,
	options?: InspectSkillOptions,
): Promise<AgentRequirements> {
	const env = new Map<string, Hit>();
	const cli = new Map<string, Hit>();
	const hash = createHash("sha256");

	const skillMd = join(skillDir, "SKILL.md");
	try {
		const md = await readFile(skillMd, "utf-8");
		hash.update(md);
		scanMarkdown(md, "SKILL.md", env);
	} catch {
		// tolerate skills without SKILL.md (subagent test fixtures)
	}

	for (const sub of SCAN_DIRS) {
		const root = join(skillDir, sub);
		let exists = false;
		try {
			exists = (await stat(root)).isDirectory();
		} catch {}
		if (!exists) continue;

		for await (const file of walk(root)) {
			const ext = extname(file).toLowerCase();
			if (!CODE_EXTS.has(ext) && !SHELL_EXTS.has(ext)) continue;

			let stats;
			try {
				stats = await stat(file);
			} catch {
				continue;
			}
			if (stats.size > MAX_FILE_SIZE) continue;

			let content: string;
			try {
				content = await readFile(file, "utf-8");
			} catch {
				continue;
			}
			hash.update(content);

			const rel = relative(skillDir, file);
			if (CODE_EXTS.has(ext)) scanCodeFile(content, rel, env, cli);
			if (SHELL_EXTS.has(ext)) scanShellFile(content, rel, env, cli);
		}
	}

	const result: AgentRequirements = {
		envVars: [...env.entries()].map(([name, hit]) => ({ name, ...hit })),
		cliTools: [...cli.entries()].map(([name, hit]) => ({ name, ...hit })),
		inspectedAt: new Date().toISOString(),
		sourceHash: hash.digest("hex"),
	};

	// Cross-reference env vars against credential catalog (if provided)
	if (options?.catalog) {
		const hints: CapabilityHint[] = [];
		for (const e of result.envVars) {
			const cred = options.catalog.get(e.name);
			if (cred?.capabilities) {
				for (const cap of cred.capabilities) {
					hints.push({
						envVar: e.name,
						capability: cap,
						credential: cred.name,
						source: e.reason,
					});
				}
			}
		}
		if (hints.length > 0) {
			result.capabilityHints = hints;
		}
	}

	return result;
}

/**
 * Merge multiple AgentRequirements into one, preserving the first-seen reason
 * for each env var / CLI tool. Dedupes capability hints by (envVar, capability).
 * Used by computeRequirements() to aggregate across skills + agents.
 */
export function mergeRequirements(
	parts: AgentRequirements[],
): AgentRequirements {
	const env = new Map<string, AgentRequirements["envVars"][number]>();
	const cli = new Map<string, AgentRequirements["cliTools"][number]>();
	const hintSeen = new Set<string>();
	const hints: CapabilityHint[] = [];

	for (const part of parts) {
		for (const e of part.envVars) {
			const existing = env.get(e.name);
			if (!existing) {
				env.set(e.name, e);
				continue;
			}
			// Promote required:true if any source needs it.
			if (e.required && !existing.required) existing.required = true;
		}
		for (const c of part.cliTools) {
			const existing = cli.get(c.name);
			if (!existing) {
				cli.set(c.name, c);
				continue;
			}
			if (c.required && !existing.required) existing.required = true;
		}
		// Merge capability hints
		if (part.capabilityHints) {
			for (const h of part.capabilityHints) {
				const key = `${h.envVar}:${h.capability}`;
				if (!hintSeen.has(key)) {
					hintSeen.add(key);
					hints.push(h);
				}
			}
		}
	}

	const result: AgentRequirements = {
		envVars: [...env.values()].sort((a, b) => a.name.localeCompare(b.name)),
		cliTools: [...cli.values()].sort((a, b) => a.name.localeCompare(b.name)),
		inspectedAt: new Date().toISOString(),
	};
	if (hints.length > 0) result.capabilityHints = hints;
	return result;
}
