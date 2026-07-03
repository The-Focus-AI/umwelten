/**
 * Unit tests for the URL-based A2A sender and the shared payload decoder.
 * (The host:port sender is exercised by integration tests against real
 * containers; here we cover the pure/fetch-backed paths.)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { decodeA2ASendPayload, sendA2AMessageToUrl } from "./client.js";

const ORIGIN = "https://gaia.example.com";

function messageResult(text: string) {
	return {
		jsonrpc: "2.0",
		id: "1",
		result: { kind: "message", parts: [{ kind: "text", text }] },
	};
}

describe("decodeA2ASendPayload", () => {
	it("decodes a Message-shaped result", () => {
		expect(decodeA2ASendPayload(messageResult("hello"), ORIGIN).text).toBe(
			"hello",
		);
	});

	it("decodes a Task-shaped result (status.message.parts)", () => {
		const parsed = {
			result: {
				status: { message: { parts: [{ kind: "text", text: "done" }] } },
			},
		};
		expect(decodeA2ASendPayload(parsed, ORIGIN).text).toBe("done");
	});

	it("resolves relative artifact URIs against the origin", () => {
		const parsed = {
			result: {
				parts: [{ kind: "text", text: "t" }],
				artifacts: [
					{ name: "r.html", parts: [{ file: { uri: "/files/r.html" } }] },
				],
			},
		};
		const out = decodeA2ASendPayload(parsed, ORIGIN);
		expect(out.artifacts?.[0].uri).toBe(`${ORIGIN}/files/r.html`);
	});

	it("throws on a JSON-RPC error payload", () => {
		expect(() =>
			decodeA2ASendPayload({ error: { message: "unauthorized" } }, ORIGIN),
		).toThrow("unauthorized");
	});
});

describe("sendA2AMessageToUrl", () => {
	afterEach(() => vi.unstubAllGlobals());

	function stubFetch(status: number, body: unknown) {
		const fetchMock = vi.fn().mockResolvedValue({
			status,
			text: async () =>
				typeof body === "string" ? body : JSON.stringify(body),
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	it("appends /a2a to a bare origin and sends the bearer token", async () => {
		const fetchMock = stubFetch(200, messageResult("pong"));
		const out = await sendA2AMessageToUrl({
			endpoint: "https://gaia.example.com",
			text: "ping",
			apiKey: "tok",
		});
		expect(out.text).toBe("pong");
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://gaia.example.com/a2a");
		expect(init.headers.authorization).toBe("Bearer tok");
		const rpc = JSON.parse(init.body);
		expect(rpc.method).toBe("message/send");
		expect(rpc.params.message.parts[0].text).toBe("ping");
	});

	it("keeps an explicit /a2a path (no double append)", async () => {
		const fetchMock = stubFetch(200, messageResult("ok"));
		await sendA2AMessageToUrl({ endpoint: "http://172.17.0.1:7420/a2a", text: "x" });
		expect(fetchMock.mock.calls[0][0]).toBe("http://172.17.0.1:7420/a2a");
	});

	it("throws on HTTP error status with the body excerpt", async () => {
		stubFetch(401, "nope");
		await expect(
			sendA2AMessageToUrl({ endpoint: "https://gaia.example.com", text: "x" }),
		).rejects.toThrow(/HTTP 401/);
	});

	it("throws on invalid JSON", async () => {
		stubFetch(200, "<html>not json</html>");
		await expect(
			sendA2AMessageToUrl({ endpoint: "https://gaia.example.com", text: "x" }),
		).rejects.toThrow(/Invalid A2A response/);
	});
});
