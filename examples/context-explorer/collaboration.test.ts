import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { collaborationResponse } from "./collaboration.js";
import { createFixture, fixtureId } from "./collaboration-fixture.js";

test("read-only trace snapshot preserves decision evidence, event order, and historical blobs", async () => {
  const fixture = await createFixture();
  try {
    const path = `/api/collaboration/runs/${fixtureId}`;
    const before = await readFile(join(fixture.dir, "collaboration.sqlite"));
    assert.deepEqual(
      await collaborationResponse(fixture.root, "/api/collaboration/runs"),
      { runs: [fixtureId] },
    );
    const trace = await collaborationResponse(fixture.root, path);
    assert.ok(trace.events && trace.agents && trace.artifacts);
    assert.deepEqual(
      trace.events.map((e) => e.id),
      Array.from({ length: 13 }, (_, i) => i + 1),
    );
    assert.deepEqual(trace.events[4].data.deliveredEventIds, [4]);
    assert.equal(trace.events[6].data.usage.totalTokens, 9999);
    assert.equal(
      trace.agents.find((a) => a.id === "researcher")?.parentId,
      "coordinator",
    );
    assert.equal(trace.artifacts[0].version, 2);
    assert.deepEqual(
      await collaborationResponse(
        fixture.root,
        `${path}/blobs/${fixture.hashes[0]}`,
      ),
      { hash: fixture.hashes[0], content: fixture.contents[0] },
    );
    assert.deepEqual(
      await readFile(join(fixture.dir, "collaboration.sqlite")),
      before,
    );
    assert.deepEqual((await readdir(fixture.dir)).sort(), [
      "blobs",
      "collaboration.sqlite",
    ]);
    await assert.rejects(collaborationResponse(fixture.root, path, "POST"), {
      status: 405,
    });
    await assert.rejects(collaborationResponse(undefined, path), {
      status: 503,
    });
    await assert.rejects(
      collaborationResponse(fixture.root, `${path}/blobs/${"a".repeat(64)}`),
      { status: 404 },
    );
    await assert.rejects(
      collaborationResponse(fixture.root, `${path}/blobs/%2e%2e`),
      { status: 400 },
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects traversal and run, database, sidecar, and blob symlinks", async () => {
  const fixture = await createFixture();
  const alias = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const path = `/api/collaboration/runs/${fixtureId}`;
  try {
    for (const id of ["..", "%2e%2e", "etc%2fpasswd", "not-a-uuid"]) {
      await assert.rejects(
        collaborationResponse(fixture.root, `/api/collaboration/runs/${id}`),
        { status: 400 },
      );
    }
    await symlink(fixture.dir, join(fixture.root, alias));
    assert.deepEqual(
      await collaborationResponse(fixture.root, "/api/collaboration/runs"),
      { runs: [fixtureId] },
    );
    await assert.rejects(
      collaborationResponse(fixture.root, `/api/collaboration/runs/${alias}`),
      { status: 404 },
    );
    const blob = join(fixture.dir, "blobs", fixture.hashes[0]);
    await rm(blob);
    await symlink(join(fixture.dir, "collaboration.sqlite"), blob);
    await assert.rejects(
      collaborationResponse(fixture.root, `${path}/blobs/${fixture.hashes[0]}`),
      { status: 404 },
    );
    await symlink(blob, join(fixture.dir, "collaboration.sqlite-wal"));
    await assert.rejects(collaborationResponse(fixture.root, path), {
      status: 404,
    });
    await rm(join(fixture.dir, "collaboration.sqlite-wal"));
    await rm(join(fixture.root, alias));
    await mkdir(join(fixture.root, alias));
    await symlink(
      join(fixture.dir, "collaboration.sqlite"),
      join(fixture.root, alias, "collaboration.sqlite"),
    );
    await assert.rejects(
      collaborationResponse(fixture.root, `/api/collaboration/runs/${alias}`),
      { status: 404 },
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("artifact previews reject oversized and binary content", async () => {
  const fixture = await createFixture();
  try {
    const path = `/api/collaboration/runs/${fixtureId}/blobs/${fixture.hashes[0]}`;
    const file = join(fixture.dir, "blobs", fixture.hashes[0]);
    await writeFile(file, "x".repeat(1024 * 1024));
    const boundary = await collaborationResponse(fixture.root, path);
    assert.equal(boundary.content?.length, 1024 * 1024);
    await writeFile(file, Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(collaborationResponse(fixture.root, path), {
      status: 413,
    });
    await writeFile(file, Buffer.from([0xff]));
    await assert.rejects(collaborationResponse(fixture.root, path), {
      status: 415,
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
