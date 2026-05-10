import { describe, it, expect } from "vitest";
import {
  checkAgentCall,
  withAgentCall,
  withFreshAgentCallContext,
  getAgentCallContext,
  DEFAULT_AGENT_CALL_DEPTH,
} from "./agent-call-context.js";

describe("agent-call-context", () => {
  it("checkAgentCall is OK at the top level (no chain)", () => {
    const result = checkAgentCall("alice");
    expect(result.ok).toBe(true);
    expect(result.chain).toEqual([]);
  });

  it("withAgentCall pushes the agent onto the chain", async () => {
    let observed: string[] = [];
    await withAgentCall("alice", async () => {
      observed = getAgentCallContext()?.chain ?? [];
    });
    expect(observed).toEqual(["alice"]);
  });

  it("rejects cycles", async () => {
    await withAgentCall("alice", async () => {
      await withAgentCall("bob", async () => {
        const result = checkAgentCall("alice");
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("CYCLE");
        expect(result.chain).toEqual(["alice", "bob"]);
      });
    });
  });

  it("rejects when chain reaches max depth", async () => {
    await withFreshAgentCallContext(async () => {
      await withAgentCall("a", async () => {
        await withAgentCall("b", async () => {
          await withAgentCall("c", async () => {
            // chain is [a, b, c], length 3 = MAX_DEPTH
            const result = checkAgentCall("d");
            expect(result.ok).toBe(false);
            expect(result.reason).toBe("MAX_DEPTH");
          });
        });
      });
    });
  });

  it("allows fresh top-level calls between siblings", async () => {
    await withAgentCall("alice", async () => {
      const ok1 = checkAgentCall("bob");
      expect(ok1.ok).toBe(true);
    });
    // After the first call returns, alice is no longer in the chain.
    const ok2 = checkAgentCall("alice");
    expect(ok2.ok).toBe(true);
    expect(ok2.chain).toEqual([]);
  });

  it("default max depth is 3", () => {
    expect(DEFAULT_AGENT_CALL_DEPTH).toBe(3);
  });
});
