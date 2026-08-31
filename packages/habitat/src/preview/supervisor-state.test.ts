import { describe, expect, it } from "vitest";
import {
	decidePreviewExit,
	decidePreviewHandover,
	discoverPreviewPorts,
	RedactedLogBuffer,
} from "./supervisor-state.js";

function row(address: string, port: number, inode: string, state = "0A"): string {
	return `0: ${address}:${port.toString(16).padStart(4, "0")} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1000 0 ${inode} 1`;
}

describe("preview port discovery", () => {
	it("returns only listeners held by the dev-task process tree", () => {
		const text = [
			"sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode",
			row("00000000", 5173, "owned"),
			row("00000000", 8080, "somebody-else"),
			row("00000000", 9000, "owned", "01"),
		].join("\n");
		expect(
			discoverPreviewPorts([{ family: "ipv4", text }], new Set(["owned"])),
		).toEqual([{ port: 5173, loopbackOnly: false }]);
	});

	it("sorts multiple ports and reports an IPv4 loopback-only listener", () => {
		const text = [
			row("0100007F", 8080, "two"),
			row("00000000", 3000, "one"),
		].join("\n");
		expect(
			discoverPreviewPorts(
				[{ family: "ipv4", text }],
				new Set(["one", "two"]),
			),
		).toEqual([
			{ port: 3000, loopbackOnly: false },
			{ port: 8080, loopbackOnly: true },
		]);
	});

	it("treats a port as reachable when any matching listener is non-loopback", () => {
		const text = [
			row("0100007F", 5173, "loopback"),
			row("00000000", 5173, "wildcard"),
		].join("\n");
		expect(
			discoverPreviewPorts(
				[{ family: "ipv4", text }],
				new Set(["loopback", "wildcard"]),
			),
		).toEqual([{ port: 5173, loopbackOnly: false }]);
	});

	it("recognizes IPv6 loopback and wildcard listeners", () => {
		const text = [
			row("00000000000000000000000001000000", 4173, "loopback6"),
			row("00000000000000000000000000000000", 4174, "wildcard6"),
		].join("\n");
		expect(
			discoverPreviewPorts(
				[{ family: "ipv6", text }],
				new Set(["loopback6", "wildcard6"]),
			),
		).toEqual([
			{ port: 4173, loopbackOnly: true },
			{ port: 4174, loopbackOnly: false },
		]);
	});
});

describe("preview dev-task exit policy", () => {
	it("settles a successful check task instead of hot-looping it", () => {
		expect(decidePreviewExit(0, false)).toEqual({ kind: "no-service" });
	});

	it("restarts a server that shut down cleanly", () => {
		expect(decidePreviewExit(0, true)).toEqual({ kind: "restart" });
	});

	it("backs off after failures and signals", () => {
		expect(decidePreviewExit(1, false)).toEqual({ kind: "backoff" });
		expect(decidePreviewExit(null, true)).toEqual({ kind: "backoff" });
	});
});

describe("redacted preview logs", () => {
	it("replaces every occurrence of every real secret and ignores empty values", () => {
		const logs = new RedactedLogBuffer(["token-123", "123", ""], 1_000);
		logs.append("using token-123; again token-123; suffix 123");
		expect(logs.tail()).toBe(
			"using [REDACTED]; again [REDACTED]; suffix [REDACTED]",
		);
	});

	it("redacts a secret split across process-output chunks", () => {
		const logs = new RedactedLogBuffer(["live-secret"], 1_000);
		logs.append("credential=live-");
		logs.append("secret\n");
		expect(logs.tail()).toBe("credential=[REDACTED]\n");
	});

	it("keeps memory bounded while retaining enough overlap to redact the tail", () => {
		const logs = new RedactedLogBuffer(["secret"], 10);
		logs.append(`${"x".repeat(100)}secret-end`);
		expect(logs.storedCharacters).toBeLessThanOrEqual(16);
		expect(logs.tail()).not.toContain("secret");
	});
});

describe("agent preview handover", () => {
	it("announces only a serving preview", () => {
		expect(
			decidePreviewHandover({
				status: "serving",
				addresses: ["https://preview.example"],
			}),
		).toEqual({ kind: "announce", addresses: ["https://preview.example"] });
	});

	it("keeps fixing starting and failed previews", () => {
		expect(decidePreviewHandover({ status: "starting" })).toEqual({
			kind: "keep-fixing",
		});
		expect(
			decidePreviewHandover({ status: "failing", error: "build failed" }),
		).toEqual({ kind: "keep-fixing" });
	});

	it("reports a clean non-serving project as normal", () => {
		expect(decidePreviewHandover({ status: "no-service" })).toEqual({
			kind: "serves-nothing",
		});
	});
});
