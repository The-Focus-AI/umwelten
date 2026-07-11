import { describe, it, expect, vi } from "vitest";
import { createRoomHistoryTools } from "./room-history-tools.js";
import { runWithSpeaker } from "../identity/agent-speaker-context.js";

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("room_history tool (#102 v2)", () => {
	it("presents the speaker's grant back to its issuer and returns messages", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			return jsonResponse({
				habitatId: "h-1",
				messages: [{ author: "Will", text: "ship it", at: "2026-07-11T00:00:00Z" }],
			});
		}) as unknown as typeof fetch;

		const tools = createRoomHistoryTools({ fetchImpl });
		const out = await runWithSpeaker(
			{
				userId: "u-1",
				grant: "jwt-abc",
				issuer: "https://habitats.example.com",
			},
			() =>
				(tools.room_history as { execute: (a: { limit?: number }) => Promise<unknown> }).execute(
					{ limit: 5 },
				),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("https://habitats.example.com/api/agent/room-history");
		expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
			"Bearer jwt-abc",
		);
		expect(JSON.parse(String(calls[0].init.body))).toEqual({ limit: 5 });
		expect(out).toMatchObject({
			habitatId: "h-1",
			messages: [{ author: "Will", text: "ship it" }],
		});
	});

	it("refuses gracefully without a per-user grant (operator / dev runs)", async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const tools = createRoomHistoryTools({ fetchImpl });
		// No speaker bound at all:
		const out = await (
			tools.room_history as { execute: (a: object) => Promise<unknown> }
		).execute({});
		expect(out).toMatchObject({ kind: "no_room_scope" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("surfaces HTTP failures as tool errors, never throws", async () => {
		const fetchImpl = vi.fn(
			async () => new Response("membership required", { status: 403 }),
		) as unknown as typeof fetch;
		const tools = createRoomHistoryTools({ fetchImpl });
		const out = await runWithSpeaker(
			{ userId: "u-1", grant: "g", issuer: "https://x.example" },
			() =>
				(tools.room_history as { execute: (a: object) => Promise<unknown> }).execute({}),
		);
		expect(out).toMatchObject({
			error: expect.stringContaining("403"),
		});
	});
});
