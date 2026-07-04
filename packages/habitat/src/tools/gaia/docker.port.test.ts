/**
 * Unit tests for host-port selection (pickHostPort).
 *
 * The regression that motivated these: a rebuild counted the entry's OWN
 * registry-recorded port as "in use", so every rebuild hopped to the next
 * port — breaking anything pinned to the old one and slowly exhausting the
 * 7440–7499 range.
 */

import { describe, it, expect } from "vitest";
import { pickHostPort } from "./docker.js";
import type { GaiaHabitatEntry } from "./types.js";

function entry(id: string, containerPort?: number): GaiaHabitatEntry {
	return { id, containerPort } as GaiaHabitatEntry;
}

describe("pickHostPort", () => {
	it("starts at 7440 when nothing is allocated", () => {
		expect(pickHostPort([])).toBe(7440);
	});

	it("skips ports held by other entries", () => {
		expect(pickHostPort([entry("a", 7440), entry("b", 7441)])).toBe(7442);
	});

	it("a rebuild reuses the entry's own recorded port", () => {
		const self = entry("a", 7443);
		expect(pickHostPort([self, entry("b", 7440)], self)).toBe(7443);
	});

	it("does not treat the self port as taken even at range start", () => {
		const self = entry("a", 7440);
		expect(pickHostPort([self], self)).toBe(7440);
	});

	it("falls back to the next free port when the recorded port is now held by another entry", () => {
		const self = entry("a", 7440);
		// Registry drift: another entry got recorded on the same port.
		expect(pickHostPort([entry("b", 7440), self], self)).toBe(7441);
	});

	it("ignores an out-of-range recorded port", () => {
		const self = entry("a", 9999);
		expect(pickHostPort([self], self)).toBe(7440);
	});

	it("throws when the whole range is exhausted by other entries", () => {
		const others = Array.from({ length: 60 }, (_, i) =>
			entry(`e${i}`, 7440 + i),
		);
		expect(() => pickHostPort(others)).toThrow(/No available ports/);
	});
});
