/**
 * `FilePushNotificationStore` — the durable half of #275.
 *
 * The behaviour that matters is what a *second* instance reads: every
 * persistence test constructs a new store over the same directory, because a
 * cached answer proves nothing about what survives a container.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { TaskPushNotificationConfig } from "@a2a-js/sdk";
import { FilePushNotificationStore } from "./file-push-store.js";
import { buildServerCallContext } from "./server.js";

async function tempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "push-store-test-"));
}

/** Default context: no A2A-Version header, i.e. the 0.3 wire. */
const ctx = buildServerCallContext();

/** Full v1 config from the fields a test cares about. */
function cfg(
	fields: Partial<TaskPushNotificationConfig> & { url: string },
): TaskPushNotificationConfig {
	return {
		tenant: "",
		id: "",
		taskId: "",
		token: "",
		authentication: undefined,
		...fields,
	};
}

describe("FilePushNotificationStore", () => {
	it("returns no registrations for an unknown task", async () => {
		const store = new FilePushNotificationStore({ dir: await tempDir() });
		expect(await store.load("nope", ctx)).toEqual([]);
	});

	it("survives the process that registered it", async () => {
		const dir = await tempDir();
		await new FilePushNotificationStore({ dir }).save(
			"task-1",
			ctx,
			cfg({ url: "https://caller.example/hook", token: "shhh" }),
		);

		// A new instance reads the volume, exactly like the next container.
		const configs = await new FilePushNotificationStore({ dir }).load("task-1", ctx);
		expect(configs).toHaveLength(1);
		expect(configs[0].url).toBe("https://caller.example/hook");
		expect(configs[0].token).toBe("shhh");
	});

	it("names an unnamed registration after its task", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		const config = cfg({ url: "https://caller.example/hook" });
		await store.save("task-1", ctx, config);

		// The v1 contract: the caller's object is stamped in place, because the
		// SDK returns that object to the caller as the result of the set call.
		expect(config).toHaveProperty("id", "task-1");
		expect((await store.load("task-1", ctx))[0].id).toBe("task-1");
	});

	it("replaces a registration with the same id and keeps the others", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", ctx, cfg({ id: "a", url: "https://one.example" }));
		await store.save("task-1", ctx, cfg({ id: "b", url: "https://two.example" }));
		await store.save("task-1", ctx, cfg({ id: "a", url: "https://one-updated.example" }));

		const configs = await new FilePushNotificationStore({ dir }).load("task-1", ctx);
		expect(configs).toHaveLength(2);
		expect(configs.find((c) => c.id === "a")?.url).toBe(
			"https://one-updated.example",
		);
		expect(configs.find((c) => c.id === "b")?.url).toBe("https://two.example");
	});

	it("keeps registrations for different tasks apart", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", ctx, cfg({ url: "https://one.example" }));
		await store.save("task-2", ctx, cfg({ url: "https://two.example" }));

		const reopened = new FilePushNotificationStore({ dir });
		expect((await reopened.load("task-1", ctx))[0].url).toBe("https://one.example");
		expect((await reopened.load("task-2", ctx))[0].url).toBe("https://two.example");
	});

	it("deletes the registration named after the task when given no id", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", ctx, cfg({ url: "https://one.example" }));
		await store.delete("task-1", ctx);

		expect(
			await new FilePushNotificationStore({ dir }).load("task-1", ctx),
		).toEqual([]);
		// Nothing left to read means nothing left on disk — an empty record would
		// be a file a later reader has to interpret.
		expect(await readdir(dir)).toHaveLength(0);
	});

	it("deletes one registration by id and leaves the rest", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", ctx, cfg({ id: "a", url: "https://one.example" }));
		await store.save("task-1", ctx, cfg({ id: "b", url: "https://two.example" }));
		await store.delete("task-1", ctx, "a");

		const configs = await new FilePushNotificationStore({ dir }).load("task-1", ctx);
		expect(configs.map((c) => c.id)).toEqual(["b"]);
	});

	it("deleting something that was never registered is not an error", async () => {
		const store = new FilePushNotificationStore({ dir: await tempDir() });
		await expect(store.delete("ghost", ctx, "nope")).resolves.toBeUndefined();
	});

	it("serialises concurrent saves for one task", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				store.save("task-1", ctx, cfg({ id: `c${i}`, url: `https://${i}.example` })),
			),
		);

		const configs = await new FilePushNotificationStore({ dir }).load("task-1", ctx);
		expect(configs).toHaveLength(8);
	});

	it("treats an unreadable record as no registrations rather than throwing", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", ctx, cfg({ url: "https://one.example" }));

		const [file] = await readdir(dir);
		await writeFile(join(dir, file), "{ not json", "utf-8");

		// A caller silently not notified is bad; a habitat that will not boot
		// because someone hand-edited a file is worse.
		expect(
			await new FilePushNotificationStore({ dir }).load("task-1", ctx),
		).toEqual([]);
	});

	it("does not let a task id escape its directory", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("../../etc/passwd", ctx, cfg({ url: "https://one.example" }));

		const entries = await readdir(dir);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatch(/^[0-9a-f]{64}\.push\.json$/);
		expect((await store.load("../../etc/passwd", ctx))[0].url).toBe(
			"https://one.example",
		);
	});

	describe("wire versions and disk compatibility", () => {
		it("records the wire version a registration arrived over", async () => {
			const dir = await tempDir();
			const store = new FilePushNotificationStore({ dir });
			await store.save(
				"task-1",
				buildServerCallContext({ requestedVersion: "1.0" }),
				cfg({ id: "v1", url: "https://one.example" }),
			);
			await store.save("task-1", ctx, cfg({ id: "legacy", url: "https://two.example" }));

			const stored = await new FilePushNotificationStore({ dir }).loadWithMetadata(
				"task-1",
				ctx,
			);
			expect(stored.find((s) => s.config.id === "v1")?.wireVersion).toBe("1.0");
			// No A2A-Version header means the spec-mandated default of 0.3.
			expect(stored.find((s) => s.config.id === "legacy")?.wireVersion).toBe("0.3");
		});

		it("reads a record written by the 0.3-era store", async () => {
			const dir = await tempDir();
			// The old on-disk envelope: flat 0.3 configs, no wire versions.
			const hashed = `${createHash("sha256").update("task-1").digest("hex")}.push.json`;
			await writeFile(
				join(dir, hashed),
				JSON.stringify({
					version: 1,
					taskId: "task-1",
					configs: [
						{
							id: "task-1",
							url: "https://caller.example/hook",
							token: "shhh",
							authentication: { schemes: ["Bearer"], credentials: "cred" },
						},
					],
				}),
				"utf-8",
			);

			const store = new FilePushNotificationStore({ dir });
			const configs = await store.load("task-1", ctx);
			expect(configs).toHaveLength(1);
			expect(configs[0]).toMatchObject({
				id: "task-1",
				taskId: "task-1",
				url: "https://caller.example/hook",
				token: "shhh",
				authentication: { scheme: "Bearer", credentials: "cred" },
			});

			// Records that predate the migration were registered over the only
			// wire that existed at the time.
			const stored = await store.loadWithMetadata("task-1", ctx);
			expect(stored[0].wireVersion).toBe("0.3");
		});

		it("upgrades a 0.3-era record in place the next time it is saved", async () => {
			const dir = await tempDir();
			const hashed = `${createHash("sha256").update("task-1").digest("hex")}.push.json`;
			await writeFile(
				join(dir, hashed),
				JSON.stringify({
					version: 1,
					taskId: "task-1",
					configs: [{ id: "old", url: "https://old.example" }],
				}),
				"utf-8",
			);

			const store = new FilePushNotificationStore({ dir });
			await store.save("task-1", ctx, cfg({ id: "new", url: "https://new.example" }));

			// A fresh instance must read both through the upgraded (v2) record.
			const configs = await new FilePushNotificationStore({ dir }).load("task-1", ctx);
			expect(configs.map((c) => c.id).sort()).toEqual(["new", "old"]);
			const raw = JSON.parse(
				(await import("node:fs/promises").then((fs) => fs.readFile(join(dir, hashed), "utf-8"))),
			);
			expect(raw.version).toBe(2);
		});
	});
});
