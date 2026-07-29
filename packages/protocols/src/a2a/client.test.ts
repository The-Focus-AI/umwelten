/**
 * Unit tests for the URL-based A2A sender and the shared payload decoder.
 * (The host:port sender is exercised by integration tests against real
 * containers; here we cover the pure/fetch-backed paths.)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { decodeA2ASendPayload, sendA2AMessageToUrl } from "./client.js";

const ORIGIN = "https://gaia.example.com";

function messageResult(text: string) {
	// The v1 SDK's compat transport validates the wire Message strictly —
	// `messageId` (and a role) are required, as any real 0.3 server sends.
	return {
		jsonrpc: "2.0",
		id: "1",
		result: {
			kind: "message",
			role: "agent",
			messageId: "m1",
			parts: [{ kind: "text", text }],
		},
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

	/**
	 * Returns a real `Response`. The previous stub was a bare
	 * `{ status, text() }` object — enough for the hand-rolled sender that read
	 * only those two, but not something `fetch` ever actually produces, and the
	 * SDK transport reads `ok` and the headers too.
	 */
	function stubFetch(status: number, body: unknown) {
		const fetchMock = vi.fn().mockImplementation(
			async (_url: string, init?: RequestInit) => {
				let payload = body;
				// Echo the request's JSON-RPC id, as a real server does. The SDK
				// checks that ids match — a fixture with a hardcoded id fails that
				// check, which the hand-rolled sender never performed.
				if (typeof payload === "object" && payload !== null && "id" in payload) {
					try {
						const request = JSON.parse(String(init?.body ?? "{}"));
						payload = { ...(payload as object), id: request.id };
					} catch {
						/* leave the fixture's id alone */
					}
				}
				return new Response(
					typeof payload === "string" ? payload : JSON.stringify(payload),
					{ status, headers: { "content-type": "application/json" } },
				);
			},
		);
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

	// The SDK transport words transport failures differently from the
	// hand-rolled sender it replaced, so these assert on the substance an
	// operator needs — which agent, what status, what came back — rather than
	// on an exact phrase.
	it("throws on HTTP error status, naming the endpoint, the status and the body", async () => {
		stubFetch(401, "nope");
		const err = await sendA2AMessageToUrl({
			endpoint: "https://gaia.example.com",
			text: "x",
		}).catch((e: unknown) => e as Error);

		expect(err).toBeInstanceOf(Error);
		expect(err.message).toContain("https://gaia.example.com");
		expect(err.message).toContain("401");
		expect(err.message).toContain("nope");
	});

	it("throws on a non-JSON response, surfacing what came back instead", async () => {
		stubFetch(200, "<html>not json</html>");
		const err = await sendA2AMessageToUrl({
			endpoint: "https://gaia.example.com",
			text: "x",
		}).catch((e: unknown) => e as Error);

		expect(err).toBeInstanceOf(Error);
		expect(err.message).toContain("https://gaia.example.com");
		expect(err.message).toContain("not json");
	});

	it("surfaces a JSON-RPC error returned by the agent", async () => {
		stubFetch(200, {
			jsonrpc: "2.0",
			id: "1",
			error: { code: -32603, message: "agent exploded" },
		});
		await expect(
			sendA2AMessageToUrl({ endpoint: "https://gaia.example.com", text: "x" }),
		).rejects.toThrow(/agent exploded/);
	});
});
