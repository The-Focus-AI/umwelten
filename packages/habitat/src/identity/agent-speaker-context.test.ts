import { describe, it, expect } from "vitest";
import { runWithSpeaker, getSpeaker } from "./agent-speaker-context.js";

describe("agent-speaker-context", () => {
  it("getSpeaker is undefined at the top level", () => {
    expect(getSpeaker()).toBeUndefined();
  });

  it("runWithSpeaker binds the speaker for the duration of fn", () => {
    let observed: string | undefined;
    runWithSpeaker({ userId: "user-123", displayName: "Alice" }, () => {
      observed = getSpeaker()?.userId;
    });
    expect(observed).toBe("user-123");
    // Cleared once fn returns.
    expect(getSpeaker()).toBeUndefined();
  });

  it("carries displayName and email", () => {
    runWithSpeaker(
      { userId: "u1", displayName: "Bob", email: "bob@example.com" },
      () => {
        const s = getSpeaker();
        expect(s?.displayName).toBe("Bob");
        expect(s?.email).toBe("bob@example.com");
      },
    );
  });

  it("undefined speaker runs fn with no speaker bound (dev fallback)", () => {
    let bound = true;
    const result = runWithSpeaker(undefined, () => {
      bound = getSpeaker() !== undefined;
      return 42;
    });
    expect(bound).toBe(false);
    expect(result).toBe(42);
  });

  it("follows the async call tree", async () => {
    let inner: string | undefined;
    await runWithSpeaker({ userId: "async-user" }, async () => {
      await Promise.resolve();
      inner = getSpeaker()?.userId;
    });
    expect(inner).toBe("async-user");
  });

  it("isolates concurrent speakers", async () => {
    const seen: Record<string, string | undefined> = {};
    await Promise.all([
      runWithSpeaker({ userId: "a" }, async () => {
        await Promise.resolve();
        seen.a = getSpeaker()?.userId;
      }),
      runWithSpeaker({ userId: "b" }, async () => {
        await Promise.resolve();
        seen.b = getSpeaker()?.userId;
      }),
    ]);
    expect(seen.a).toBe("a");
    expect(seen.b).toBe("b");
  });

  // The message/stream trap (prod, 2026-07-11): transportHandler.handle()
  // returns an async generator whose body — where the executor and tools run —
  // executes at CONSUMPTION time. These two tests pin the semantics: a
  // generator consumed outside the runWithSpeaker scope loses the speaker
  // (the bug), while wrapping the whole consumption keeps it (the fix in
  // container-server's /a2a route).
  it("async generator consumed OUTSIDE the scope loses the speaker (the trap)", async () => {
    async function* tools(): AsyncGenerator<string | undefined> {
      yield getSpeaker()?.userId;
    }
    // handle()-style: create the generator inside the scope…
    const gen = runWithSpeaker({ userId: "stream-user" }, () => tools());
    // …but consume it outside (what the /a2a route used to do).
    const seen: (string | undefined)[] = [];
    for await (const v of gen) seen.push(v);
    expect(seen).toEqual([undefined]);
  });

  it("async generator consumed INSIDE the scope keeps the speaker (the fix)", async () => {
    async function* tools(): AsyncGenerator<string | undefined> {
      await Promise.resolve();
      yield getSpeaker()?.userId;
    }
    const seen: (string | undefined)[] = [];
    await runWithSpeaker({ userId: "stream-user" }, async () => {
      for await (const v of tools()) seen.push(v);
    });
    expect(seen).toEqual(["stream-user"]);
  });
});
