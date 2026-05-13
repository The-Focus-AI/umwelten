/**
 * Credential Audit Logger — writes timestamped credential operations to a
 * JSONL file at `<dataDir>/credential-audit.jsonl`.
 *
 * Every time an operator adds, removes, binds, unbinds, or verifies a
 * credential, the operation is recorded with a timestamp, operation type,
 * and the credential/habitat affected.
 *
 * No user attribution yet — the current bearer token model does not
 * distinguish between users.
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const AUDIT_FILE = "credential-audit.jsonl";

/** All credential operations that are logged. */
export type AuditOperation =
	| "add_credential"
	| "remove_credential"
	| "verify_credential"
	| "bind_capability"
	| "unbind_capability";

/** A single audit log entry. */
export interface AuditEntry {
	timestamp: string;
	operation: AuditOperation;
	habitatId?: string;
	capability?: string;
	credential?: string;
}

export class CredentialAuditLogger {
	constructor(private readonly dataDir: string) {}

	private get auditPath(): string {
		return join(this.dataDir, AUDIT_FILE);
	}

	/**
	 * Append a single audit entry to the JSONL log file.
	 * Creates the file (and parent directory) on first write.
	 */
	async log(entry: AuditEntry): Promise<void> {
		await mkdir(this.dataDir, { recursive: true });
		const line = JSON.stringify(entry) + "\n";
		await appendFile(this.auditPath, line, "utf-8");
	}

	/**
	 * Read the most recent `n` entries from the audit log.
	 * Returns an empty array if the file doesn't exist.
	 */
	async read(n = 50): Promise<AuditEntry[]> {
		try {
			const raw = await readFile(this.auditPath, "utf-8");
			const lines = raw.trim().split("\n").filter(Boolean);
			const entries = lines.map((line) => JSON.parse(line) as AuditEntry);
			return entries.slice(-n);
		} catch {
			return [];
		}
	}
}

/** Convenience: create a timestamped entry for a credential-only operation. */
export function credentialEntry(
	operation: AuditOperation,
	credential: string,
): AuditEntry {
	return {
		timestamp: new Date().toISOString(),
		operation,
		credential,
	};
}

/** Convenience: create a timestamped entry for a capability binding operation. */
export function bindingEntry(
	operation: "bind_capability" | "unbind_capability",
	habitatId: string,
	capability: string,
	credential: string,
): AuditEntry {
	return {
		timestamp: new Date().toISOString(),
		operation,
		habitatId,
		capability,
		credential,
	};
}
