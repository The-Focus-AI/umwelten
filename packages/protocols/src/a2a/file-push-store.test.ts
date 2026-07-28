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
import { FilePushNotificationStore } from "./file-push-store.js";

async function tempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "push-store-test-"));
}

describe("FilePushNotificationStore", () => {
	it("returns no registrations for an unknown task", async () => {
		const store = new FilePushNotificationStore({ dir: await tempDir() });
		expect(await store.load("nope")).toEqual([]);
	});

	it("survives the process that registered it", async () => {
		const dir = await tempDir();
		await new FilePushNotificationStore({ dir }).save("task-1", {
			url: "https://caller.example/hook",
			token: "shhh",
		});

		// A new instance reads the volume, exactly like the next container.
		const configs = await new FilePushNotificationStore({ dir }).load("task-1");
		expect(configs).toHaveLength(1);
		expect(configs[0].url).toBe("https://caller.example/hook");
		expect(configs[0].token).toBe("shhh");
	});

	it("names an unnamed registration after its task", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		const config = { url: "https://caller.example/hook" };
		await store.save("task-1", config);

		// Matching InMemoryPushNotificationStore: the caller's object is stamped
		// too, because the SDK returns that object to the caller as the result of
		// tasks/pushNotificationConfig/set.
		expect(config).toHaveProperty("id", "task-1");
		expect((await store.load("task-1"))[0].id).toBe("task-1");
	});

	it("replaces a registration with the same id and keeps the others", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", { id: "a", url: "https://one.example" });
		await store.save("task-1", { id: "b", url: "https://two.example" });
		await store.save("task-1", { id: "a", url: "https://one-updated.example" });

		const configs = await new FilePushNotificationStore({ dir }).load("task-1");
		expect(configs).toHaveLength(2);
		expect(configs.find((c) => c.id === "a")?.url).toBe(
			"https://one-updated.example",
		);
		expect(configs.find((c) => c.id === "b")?.url).toBe("https://two.example");
	});

	it("keeps registrations for different tasks apart", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", { url: "https://one.example" });
		await store.save("task-2", { url: "https://two.example" });

		const reopened = new FilePushNotificationStore({ dir });
		expect((await reopened.load("task-1"))[0].url).toBe("https://one.example");
		expect((await reopened.load("task-2"))[0].url).toBe("https://two.example");
	});

	it("deletes the registration named after the task when given no id", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", { url: "https://one.example" });
		await store.delete("task-1");

		expect(await new FilePushNotificationStore({ dir }).load("task-1")).toEqual(
			[],
		);
		// Nothing left to read means nothing left on disk — an empty record would
		// be a file a later reader has to interpret.
		expect(await readdir(dir)).toHaveLength(0);
	});

	it("deletes one registration by id and leaves the rest", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", { id: "a", url: "https://one.example" });
		await store.save("task-1", { id: "b", url: "https://two.example" });
		await store.delete("task-1", "a");

		const configs = await new FilePushNotificationStore({ dir }).load("task-1");
		expect(configs.map((c) => c.id)).toEqual(["b"]);
	});

	it("deleting something that was never registered is not an error", async () => {
		const store = new FilePushNotificationStore({ dir: await tempDir() });
		await expect(store.delete("ghost", "nope")).resolves.toBeUndefined();
	});

	it("serialises concurrent saves for one task", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				store.save("task-1", { id: `c${i}`, url: `https://${i}.example` }),
			),
		);

		const configs = await new FilePushNotificationStore({ dir }).load("task-1");
		expect(configs).toHaveLength(8);
	});

	it("treats an unreadable record as no registrations rather than throwing", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("task-1", { url: "https://one.example" });

		const [file] = await readdir(dir);
		await writeFile(join(dir, file), "{ not json", "utf-8");

		// A caller silently not notified is bad; a habitat that will not boot
		// because someone hand-edited a file is worse.
		expect(await new FilePushNotificationStore({ dir }).load("task-1")).toEqual(
			[],
		);
	});

	it("does not let a task id escape its directory", async () => {
		const dir = await tempDir();
		const store = new FilePushNotificationStore({ dir });
		await store.save("../../etc/passwd", { url: "https://one.example" });

		const entries = await readdir(dir);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatch(/^[0-9a-f]{64}\.push\.json$/);
		expect((await store.load("../../etc/passwd"))[0].url).toBe(
			"https://one.example",
		);
	});
});
