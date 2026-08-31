/** Pure state and parsing primitives for the project-preview supervisor. */

export interface TcpTable {
	family: "ipv4" | "ipv6";
	text: string;
}

export interface DiscoveredPreviewPort {
	port: number;
	/** True when every matching listener is unreachable outside the container. */
	loopbackOnly: boolean;
}

const TCP_LISTEN = "0A";

function reverseBytes(word: string): string {
	return (word.match(/../g) ?? []).reverse().join("");
}

function addressBytes(family: TcpTable["family"], raw: string): Uint8Array | null {
	if (family === "ipv4") {
		if (!/^[a-f0-9]{8}$/i.test(raw)) return null;
		return Uint8Array.from(
			(reverseBytes(raw).match(/../g) ?? []).map((byte) => parseInt(byte, 16)),
		);
	}

	if (!/^[a-f0-9]{32}$/i.test(raw)) return null;
	const hostOrder = (raw.match(/.{8}/g) ?? []).map(reverseBytes).join("");
	return Uint8Array.from(
		(hostOrder.match(/../g) ?? []).map((byte) => parseInt(byte, 16)),
	);
}

function isLoopback(family: TcpTable["family"], rawAddress: string): boolean {
	const bytes = addressBytes(family, rawAddress);
	if (!bytes) return false;
	if (family === "ipv4") return bytes[0] === 127;

	const ipv6Loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
	const mappedIpv4Loopback =
		bytes.slice(0, 10).every((byte) => byte === 0) &&
		bytes[10] === 0xff &&
		bytes[11] === 0xff &&
		bytes[12] === 127;
	return ipv6Loopback || mappedIpv4Loopback;
}

/**
 * Discover listeners owned by a process tree from `/proc/net/tcp{,6}` text.
 *
 * The caller collects `socket:[inode]` targets from descriptors in that tree;
 * keeping filesystem traversal outside makes the parser deterministic in tests.
 */
export function discoverPreviewPorts(
	tables: readonly TcpTable[],
	processSocketInodes: ReadonlySet<string>,
): DiscoveredPreviewPort[] {
	const loopbackByPort = new Map<number, boolean>();

	for (const table of tables) {
		for (const line of table.text.split("\n")) {
			const fields = line.trim().split(/\s+/);
			if (fields.length < 10 || fields[3] !== TCP_LISTEN) continue;
			if (!processSocketInodes.has(fields[9])) continue;

			const [rawAddress, rawPort] = fields[1].split(":");
			const port = parseInt(rawPort, 16);
			if (!Number.isInteger(port) || port < 1 || port > 65_535) continue;

			const loopback = isLoopback(table.family, rawAddress);
			loopbackByPort.set(port, (loopbackByPort.get(port) ?? true) && loopback);
		}
	}

	return [...loopbackByPort]
		.sort(([a], [b]) => a - b)
		.map(([port, loopbackOnly]) => ({ port, loopbackOnly }));
}

export type PreviewExitDecision =
	| { kind: "no-service" }
	| { kind: "restart" }
	| { kind: "backoff" };

/** Exhaustive policy for a completed `mise dev` process. */
export function decidePreviewExit(
	exitCode: number | null,
	everListened: boolean,
): PreviewExitDecision {
	if (exitCode === 0 && !everListened) return { kind: "no-service" };
	if (exitCode === 0) return { kind: "restart" };
	return { kind: "backoff" };
}

function redact(value: string, secrets: readonly string[]): string {
	let result = value;
	for (const secret of secrets) result = result.split(secret).join("[REDACTED]");
	return result;
}

/** Bounded diagnostics that redact at the only outward-facing read boundary. */
export class RedactedLogBuffer {
	private value = "";
	private readonly secrets: string[];
	private readonly retainedCharacters: number;

	constructor(
		secrets: readonly string[],
		private readonly maxCharacters = 32_768,
	) {
		if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
			throw new Error("Log buffer size must be a positive integer");
		}
		this.secrets = [...new Set(secrets.filter(Boolean))].sort(
			(a, b) => b.length - a.length,
		);
		this.retainedCharacters = maxCharacters + (this.secrets[0]?.length ?? 0);
	}

	append(chunk: string): void {
		this.value = `${this.value}${chunk}`.slice(-this.retainedCharacters);
	}

	tail(): string {
		return redact(this.value, this.secrets).slice(-this.maxCharacters);
	}

	get storedCharacters(): number {
		return this.value.length;
	}
}

export type PreviewSupervisorSnapshot =
	| { status: "starting" }
	| { status: "serving"; addresses: string[] }
	| { status: "failing"; error: string }
	| { status: "stopped" }
	| { status: "no-service" };

export type PreviewHandoverDecision =
	| { kind: "announce"; addresses: string[] }
	| { kind: "keep-fixing" }
	| { kind: "serves-nothing" };

/** The agent only hands a URL over after the service is actually reachable. */
export function decidePreviewHandover(
	snapshot: PreviewSupervisorSnapshot,
): PreviewHandoverDecision {
	if (snapshot.status === "serving") {
		return { kind: "announce", addresses: snapshot.addresses };
	}
	if (snapshot.status === "no-service") return { kind: "serves-nothing" };
	return { kind: "keep-fixing" };
}
