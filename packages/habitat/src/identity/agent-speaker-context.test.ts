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
});
