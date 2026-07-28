/**
 * The real volume probe behind `readHabitatProvenance` (umwelten #277).
 *
 * Split from `provenance.ts` for the same reason `volume-state.ts` is split
 * from `plan.ts`: the shape of a provenance record is worth testing against
 * literals, and nothing here is.
 *
 * Every read is local. `rev-parse` and `log -1` read the object database;
 * the refresh time comes from the mtime of `FETCH_HEAD`, which git touches on
 * every fetch and pull whether or not anything came back — that "we checked
 * and there was nothing" case is exactly the one a rollup needs to be able to
 * distinguish from "we never checked". A repo cloned and never fetched has no
 * `FETCH_HEAD`, so it falls back to the mtime of `.git`, which is its clone
 * time.
 */

import { execFile } from "node:child_process";
import { stat, readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileExists } from "../config.js";
import type { ProvenanceProbe } from "./provenance.js";

const run = promisify(execFile);

/** Git commands are read-only and local; a hung one must not hang an answer. */
const GIT_TIMEOUT_MS = 5_000;

async function git(dir: string, args: string[]): Promise<string | undefined> {
	try {
		const { stdout } = await run("git", ["-C", dir, ...args], {
			timeout: GIT_TIMEOUT_MS,
		});
		const out = stdout.trim();
		return out.length > 0 ? out : undefined;
	} catch {
		// A repo that cannot be read reports as unknown rather than failing
		// the answer. Provenance is context on a result, not the result.
		return undefined;
	}
}

async function mtime(path: string): Promise<string | undefined> {
	try {
		return (await stat(path)).mtime.toISOString();
	} catch {
		return undefined;
	}
}

export const realProvenanceProbe: ProvenanceProbe = {
	exists: fileExists,

	async readFile(path) {
		try {
			return await fsReadFile(path, "utf-8");
		} catch {
			return undefined;
		}
	},

	headCommit(dir) {
		return git(dir, ["rev-parse", "HEAD"]);
	},

	async headCommittedAt(dir) {
		// %cI is strict ISO 8601 — no locale, no parsing ambiguity.
		return await git(dir, ["log", "-1", "--format=%cI"]);
	},

	async lastFetchedAt(dir) {
		return (
			(await mtime(join(dir, ".git", "FETCH_HEAD"))) ??
			(await mtime(join(dir, ".git")))
		);
	},
};
