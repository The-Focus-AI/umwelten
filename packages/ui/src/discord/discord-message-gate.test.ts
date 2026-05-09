import { describe, it, expect } from "vitest";
import {
  ambientInboundAllowed,
  discordAmbientEligibility,
} from "./discord-message-gate.js";

describe("discordAmbientEligibility", () => {
  it("requires mention", () => {
    expect(
      discordAmbientEligibility({
        mentionsBot: false,
        isDm: true,
        isThread: true,
        isParentGuildText: true,
      }),
    ).toBe(false);
  });

  it("allows DM when mentioned", () => {
    expect(
      discordAmbientEligibility({
        mentionsBot: true,
        isDm: true,
        isThread: false,
        isParentGuildText: false,
      }),
    ).toBe(true);
  });

  it("allows guild thread when mentioned", () => {
    expect(
      discordAmbientEligibility({
        mentionsBot: true,
        isDm: false,
        isThread: true,
        isParentGuildText: false,
      }),
    ).toBe(true);
  });

  it("allows parent guild text when mentioned (bot will open a thread)", () => {
    expect(
      discordAmbientEligibility({
        mentionsBot: true,
        isDm: false,
        isThread: false,
        isParentGuildText: true,
      }),
    ).toBe(true);
  });

  it("blocks non-guild without thread/dm flag", () => {
    expect(
      discordAmbientEligibility({
        mentionsBot: true,
        isDm: false,
        isThread: false,
        isParentGuildText: false,
      }),
    ).toBe(false);
  });
});

describe("ambientInboundAllowed", () => {
  const unlocked = new Set(["thread-1"]);

  it("allows everything when unrestricted", () => {
    expect(
      ambientInboundAllowed({
        unrestricted: true,
        mentionedBot: false,
        channelId: "x",
        isDm: false,
        isThread: false,
        isParentGuildText: true,
        unlockedChannelIds: unlocked,
      }),
    ).toBe(true);
  });

  it("allows unlocked thread without mention", () => {
    expect(
      ambientInboundAllowed({
        unrestricted: false,
        mentionedBot: false,
        channelId: "thread-1",
        isDm: false,
        isThread: true,
        isParentGuildText: false,
        unlockedChannelIds: unlocked,
      }),
    ).toBe(true);
  });

  it("allows unlocked DM without mention", () => {
    expect(
      ambientInboundAllowed({
        unrestricted: false,
        mentionedBot: false,
        channelId: "dm-9",
        isDm: true,
        isThread: false,
        isParentGuildText: false,
        unlockedChannelIds: new Set(["dm-9"]),
      }),
    ).toBe(true);
  });

  it("blocks locked thread without mention", () => {
    expect(
      ambientInboundAllowed({
        unrestricted: false,
        mentionedBot: false,
        channelId: "other-thread",
        isDm: false,
        isThread: true,
        isParentGuildText: false,
        unlockedChannelIds: unlocked,
      }),
    ).toBe(false);
  });

  it("parent guild text still needs mention even if id coincidentally unlocked", () => {
    expect(
      ambientInboundAllowed({
        unrestricted: false,
        mentionedBot: false,
        channelId: "thread-1",
        isDm: false,
        isThread: false,
        isParentGuildText: true,
        unlockedChannelIds: unlocked,
      }),
    ).toBe(false);
  });

  it("parent guild text allows with mention", () => {
    expect(
      ambientInboundAllowed({
        unrestricted: false,
        mentionedBot: true,
        channelId: "ch",
        isDm: false,
        isThread: false,
        isParentGuildText: true,
        unlockedChannelIds: unlocked,
      }),
    ).toBe(true);
  });
});
