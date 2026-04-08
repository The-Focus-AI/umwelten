import { describe, it, expect } from "vitest";
import {
  resolveDiscordChannelRoute,
  discordRouteSignature,
  coerceDiscordChannelBinding,
} from "./discord-routing.js";

describe("coerceDiscordChannelBinding", () => {
  it("parses legacy string", () => {
    expect(coerceDiscordChannelBinding("  ops  ")).toEqual({
      agentId: "ops",
      runtime: "default",
    });
  });

  it("parses object with claude-sdk", () => {
    expect(
      coerceDiscordChannelBinding({
        agentId: "x",
        runtime: "claude-sdk",
        infoMessageId: "99",
      }),
    ).toEqual({
      agentId: "x",
      runtime: "claude-sdk",
      infoMessageId: "99",
    });
  });
});

describe("resolveDiscordChannelRoute", () => {
  it("uses channels map first", () => {
    expect(
      resolveDiscordChannelRoute("111", {
        channels: { 111: "ops", 222: "other" },
        mainChannelId: "111",
      }),
    ).toEqual({ kind: "agent", agentId: "ops", runtime: "default" });
  });

  it("uses binding object runtime", () => {
    expect(
      resolveDiscordChannelRoute("111", {
        channels: { 111: { agentId: "ops", runtime: "claude-sdk" } },
      }),
    ).toEqual({ kind: "agent", agentId: "ops", runtime: "claude-sdk" });
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
    ).toEqual({ kind: "agent", agentId: "fallback", runtime: "default" });
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
        {
          channels: { parent111: { agentId: "ops", runtime: "claude-sdk" } },
        },
        "parent111",
      ),
    ).toEqual({ kind: "agent", agentId: "ops", runtime: "claude-sdk" });
  });

  it("thread’s own mapping wins over parent", () => {
    expect(
      resolveDiscordChannelRoute(
        "thread999",
        {
          channels: {
            thread999: { agentId: "special", runtime: "default" },
            parent111: "ops",
          },
        },
        "parent111",
      ),
    ).toEqual({ kind: "agent", agentId: "special", runtime: "default" });
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
    ).toEqual({ kind: "agent", agentId: "fallback", runtime: "default" });
  });
});

describe("discordRouteSignature", () => {
  it("includes runtime for agents", () => {
    expect(
      discordRouteSignature({
        kind: "agent",
        agentId: "a",
        runtime: "claude-sdk",
      }),
    ).toBe("agent:a:claude-sdk");
  });
});
