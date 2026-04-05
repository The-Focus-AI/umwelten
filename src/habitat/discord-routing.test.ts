import { describe, it, expect } from "vitest";
import { resolveDiscordChannelRoute } from "./discord-routing.js";

describe("resolveDiscordChannelRoute", () => {
  it("uses channels map first", () => {
    expect(
      resolveDiscordChannelRoute("111", {
        channels: { 111: "ops", 222: "other" },
        mainChannelId: "111",
      }),
    ).toEqual({ kind: "agent", agentId: "ops" });
  });

  it("uses main channel when not in map", () => {
    expect(
      resolveDiscordChannelRoute("lobby", {
        channels: {},
        mainChannelId: "lobby",
      }),
    ).toEqual({ kind: "main" });
  });

  it("uses defaultAgentId when set and channel unmapped", () => {
    expect(
      resolveDiscordChannelRoute("999", {
        channels: {},
        defaultAgentId: "fallback",
      }),
    ).toEqual({ kind: "agent", agentId: "fallback" });
  });

  it("defaults to main", () => {
    expect(resolveDiscordChannelRoute("999", { channels: {} })).toEqual({
      kind: "main",
    });
  });

  it("inherits parent channel agent when thread is unmapped", () => {
    expect(
      resolveDiscordChannelRoute(
        "thread999",
        { channels: { parent111: "ops" } },
        "parent111",
      ),
    ).toEqual({ kind: "agent", agentId: "ops" });
  });

  it("thread’s own mapping wins over parent", () => {
    expect(
      resolveDiscordChannelRoute(
        "thread999",
        { channels: { thread999: "special", parent111: "ops" } },
        "parent111",
      ),
    ).toEqual({ kind: "agent", agentId: "special" });
  });

  it("inherits mainChannelId from parent for unmapped thread", () => {
    expect(
      resolveDiscordChannelRoute(
        "thread999",
        { channels: {}, mainChannelId: "parent111" },
        "parent111",
      ),
    ).toEqual({ kind: "main" });
  });

  it("uses defaultAgentId only after parent inheritance fails", () => {
    expect(
      resolveDiscordChannelRoute(
        "thread999",
        { channels: {}, defaultAgentId: "fallback" },
        "unmappedParent",
      ),
    ).toEqual({ kind: "agent", agentId: "fallback" });
  });
});
