import { describe, expect, it } from "vitest";
import {
	AGENT_CHAIN_METADATA_KEY,
	MAX_WIRE_AGENT_ID_LENGTH,
	MAX_WIRE_CHAIN_LENGTH,
	decodeAgentChain,
	encodeAgentChain,
	extendAgentChain,
} from "./agent-call-wire.js";
import {
	checkAgentCall,
	withInboundAgentCallChain,
	withAgentCall,
} from "./agent-call-context.js";

describe("encode/decode round trip", () => {
	it("carries a chain across the wire unchanged", () => {
		const chain = ["ops", "upperhand"];
		expect(decodeAgentChain(encodeAgentChain(chain))).toEqual(chain);
	});

	it("uses a namespaced metadata key so it cannot collide", () => {
		expect(Object.keys(encodeAgentChain([]))).toEqual([AGENT_CHAIN_METADATA_KEY]);
	});
});

describe("decodeAgentChain — untrusted input", () => {
	it.each([
		["no metadata", undefined],
		["empty metadata", {}],
		["a non-array value", { [AGENT_CHAIN_METADATA_KEY]: "ops" }],
		["a null value", { [AGENT_CHAIN_METADATA_KEY]: null }],
		["a number", { [AGENT_CHAIN_METADATA_KEY]: 7 }],
	])("returns an empty chain for %s rather than throwing", (_label, metadata) => {
		expect(decodeAgentChain(metadata as Record<string, unknown> | undefined)).toEqual(
			[],
		);
	});

	it("drops non-string and blank entries", () => {
		expect(
			decodeAgentChain({ [AGENT_CHAIN_METADATA_KEY]: ["ops", 1, "", "  ", null, "uh"] }),
		).toEqual(["ops", "uh"]);
	});

	it("trims surrounding whitespace", () => {
		expect(decodeAgentChain({ [AGENT_CHAIN_METADATA_KEY]: ["  ops  "] })).toEqual([
			"ops",
		]);
	});

	it("truncates an oversized agent id", () => {
		const long = "x".repeat(MAX_WIRE_AGENT_ID_LENGTH + 50);
		expect(decodeAgentChain({ [AGENT_CHAIN_METADATA_KEY]: [long] })[0]).toHaveLength(
			MAX_WIRE_AGENT_ID_LENGTH,
		);
	});

	it("caps an oversized chain instead of rejecting the whole request", () => {
		const huge = Array.from({ length: MAX_WIRE_CHAIN_LENGTH + 20 }, (_, i) => `a${i}`);
		expect(
			decodeAgentChain({ [AGENT_CHAIN_METADATA_KEY]: huge }),
		).toHaveLength(MAX_WIRE_CHAIN_LENGTH);
	});
});

describe("extendAgentChain", () => {
	it("appends the receiving habitat so the next hop sees the full path", () => {
		expect(extendAgentChain(["ops"], "upperhand")).toEqual(["ops", "upperhand"]);
	});

	it("leaves the chain alone when the habitat has no name", () => {
		expect(extendAgentChain(["ops"], undefined)).toEqual(["ops"]);
	});
});

describe("the guard across a simulated hop", () => {
	it("detects a cycle that would otherwise restart at every container", async () => {
		// ops → upperhand, and upperhand is now asked to call ops back.
		const wire = encodeAgentChain(["ops"]);
		const inbound = extendAgentChain(decodeAgentChain(wire), "upperhand");

		await withInboundAgentCallChain(inbound, async () => {
			expect(checkAgentCall("ops")).toMatchObject({ ok: false, reason: "CYCLE" });
		});
	});

	it("allows a downward call that is not a cycle", async () => {
		const inbound = extendAgentChain(decodeAgentChain(encodeAgentChain(["ops"])), "upperhand");
		await withInboundAgentCallChain(inbound, async () => {
			expect(checkAgentCall("uh-api").ok).toBe(true);
		});
	});

	it("refuses once the chain reaches the depth limit", async () => {
		await withInboundAgentCallChain(["a", "b", "c"], async () => {
			expect(checkAgentCall("d")).toMatchObject({ ok: false, reason: "MAX_DEPTH" });
		});
	});

	it("without the inbound chain the same cycle looks fine — the bug this closes", async () => {
		// Simulates the old behaviour: the receiving habitat started empty.
		await withInboundAgentCallChain([], async () => {
			expect(checkAgentCall("ops").ok).toBe(true);
		});
	});

	it("keeps counting depth across a nested in-process call", async () => {
		await withInboundAgentCallChain(["ops"], async () => {
			await withAgentCall("upperhand", async () => {
				expect(checkAgentCall("ops")).toMatchObject({ ok: false, reason: "CYCLE" });
			});
		});
	});
});
