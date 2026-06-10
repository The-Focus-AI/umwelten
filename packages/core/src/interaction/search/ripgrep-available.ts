/**
 * Preflight check for the `rg` binary (slice 9, #91).
 *
 * The scanner already throws RipgrepNotFoundError mid-scan when `rg` is
 * missing, but by then the TUI may already own the terminal. The CLI runs
 * this check once per `umwelten search` invocation, before any TUI mount
 * or scan, so the install hint lands on a clean stderr with a non-zero
 * exit. See ADR docs/adr/0002-session-search-shells-out-to-ripgrep.md.
 */
import { spawn } from "node:child_process";

/**
 * Resolve true when the binary can be spawned and reports a version,
 * false otherwise. Never rejects — absence is an expected condition the
 * caller turns into the RipgrepNotFoundError install hint.
 */
export async function ripgrepAvailable(bin = "rg"): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const settle = (ok: boolean) => {
			if (settled) return;
			settled = true;
			resolve(ok);
		};

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(bin, ["--version"], {
				stdio: ["ignore", "ignore", "ignore"],
			});
		} catch {
			settle(false);
			return;
		}

		child.on("error", () => settle(false));
		child.on("close", (code) => settle(code === 0));
	});
}
