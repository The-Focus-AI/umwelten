/**
 * Boot-time CLI: mint an ambient-read installation token from the
 * GITHUB_APP_* env and print it to stdout (ADR 0004).
 *
 * Run by entrypoint.sh in the one container that holds the App identity —
 * Gaia itself — so its own skillsFromGit / project clones authenticate
 * through the App instead of a long-lived vault PAT. Child habitats never
 * have GITHUB_APP_* env; they receive per-habitat boot tokens minted by
 * Gaia's token service (docker.ts).
 *
 * Prints nothing when the App is unconfigured; exits non-zero on a mint
 * failure. The caller treats both as "no token" and falls back to the
 * GITHUB_TOKEN secret. Read-only scope: boot clones never need write.
 */

import { readFile } from "node:fs/promises";
import { mintInstallationToken } from "./app-auth.js";
import { resolveGithubAppConfig } from "./app-config.js";

const cfg = resolveGithubAppConfig();
if (cfg) {
	const privateKeyPem = await readFile(cfg.privateKeyFile, "utf-8");
	const minted = await mintInstallationToken({
		appId: cfg.appId,
		privateKeyPem,
		installationId: cfg.installationId,
		permissions: { contents: "read" },
	});
	process.stdout.write(minted.token);
}
