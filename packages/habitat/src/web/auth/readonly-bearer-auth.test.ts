import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import {
	READONLY_PRINCIPAL,
	readonlyBearerAuth,
} from "./readonly-bearer-auth.js";
import { bearerAuth } from "./bearer-auth.js";
import { compositeAuth } from "./composite-auth.js";

const req = (authorization?: string) =>
	({ headers: authorization ? { authorization } : {} }) as IncomingMessage;

describe("readonlyBearerAuth", () => {
	const auth = readonlyBearerAuth("ro-key");

	it("authenticates its own key to a read-only principal", async () => {
		expect(await auth.authenticate(req("Bearer ro-key"))).toEqual({
			userId: READONLY_PRINCIPAL,
			provider: "oauth",
			operator: false,
			readOnly: true,
		});
	});

	/**
	 * `operator` gates writing a habitat's declared credentials. A watching
	 * credential must never satisfy it.
	 */
	it("is never an operator", async () => {
		const user = await auth.authenticate(req("Bearer ro-key"));
		expect(user?.operator).toBe(false);
	});

	it("rejects a wrong key, a missing header and a non-bearer scheme", async () => {
		expect(await auth.authenticate(req("Bearer nope"))).toBeNull();
		expect(await auth.authenticate(req())).toBeNull();
		expect(await auth.authenticate(req("Basic ro-key"))).toBeNull();
		expect(await auth.authenticate(req("Bearer"))).toBeNull();
	});
});

describe("composition with the operator key", () => {
	/**
	 * The read-only provider is always tried LAST. If the two keys were ever
	 * set to the same value, the caller must still come out an operator rather
	 * than being silently downgraded to a scope that refuses half its tools.
	 */
	it("cannot shadow the operator key when both are the same value", async () => {
		const auth = compositeAuth("bearer+readonly", [
			bearerAuth("same"),
			readonlyBearerAuth("same"),
		]);

		const user = await auth.authenticate(req("Bearer same"));
		expect(user?.userId).toBe("bearer-user");
		expect(user?.readOnly).toBeUndefined();
	});

	it("resolves each key to its own scope when they differ", async () => {
		const auth = compositeAuth("bearer+readonly", [
			bearerAuth("op-key"),
			readonlyBearerAuth("ro-key"),
		]);

		expect((await auth.authenticate(req("Bearer op-key")))?.userId).toBe(
			"bearer-user",
		);
		expect((await auth.authenticate(req("Bearer ro-key")))?.readOnly).toBe(true);
		expect(await auth.authenticate(req("Bearer neither"))).toBeNull();
	});
});
