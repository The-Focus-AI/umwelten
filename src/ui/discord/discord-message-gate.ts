import type { Message } from "discord.js";

/**
 * When the bot is in "ambient" mode (no dedicated sub-agent for this context),
 * we only reply if the bot is @mentioned and the message is in a DM, a thread,
 * or a normal guild text channel (parent channel → we open a thread from that message).
 */
export function discordAmbientEligibility(opts: {
  mentionsBot: boolean;
  isDm: boolean;
  isThread: boolean;
  /** Guild text/news channel, not a thread (mention opens a new thread). */
  isParentGuildText: boolean;
}): boolean {
  if (!opts.mentionsBot) return false;
  if (opts.isDm) return true;
  if (opts.isThread) return true;
  return opts.isParentGuildText;
}

/** Uses live Discord.js message shape (mentions + channel). */
export function messagePassesAmbientDiscordGate(message: Message): boolean {
  const botId = message.client.user?.id;
  if (!botId) return false;
  if (!message.mentions.users.has(botId)) return false;
  const ch = message.channel;
  if (!ch?.isTextBased()) return false;
  const isDm = ch.isDMBased();
  const isThread =
    "isThread" in ch &&
    typeof ch.isThread === "function" &&
    ch.isThread();
  const isParentGuildText = message.inGuild() && !isDm && !isThread;
  return discordAmbientEligibility({
    mentionsBot: true,
    isDm,
    isThread,
    isParentGuildText,
  });
}

export function channelAmbientFlags(message: Message): {
  channelId: string;
  mentionedBot: boolean;
  isDm: boolean;
  isThread: boolean;
  isParentGuildText: boolean;
} {
  const botId = message.client.user?.id;
  const ch = message.channel;
  const mentionedBot = Boolean(
    botId && message.mentions.users.has(botId),
  );
  const isDm = Boolean(ch?.isTextBased() && ch.isDMBased());
  const isThread = Boolean(
    ch &&
      "isThread" in ch &&
      typeof ch.isThread === "function" &&
      ch.isThread(),
  );
  const isParentGuildText = Boolean(
    message.inGuild() && ch && !isDm && !isThread,
  );
  return {
    channelId: message.channelId,
    mentionedBot,
    isDm,
    isThread,
    isParentGuildText,
  };
}

/**
 * Ambient routing: dedicated-agent channels are unrestricted.
 * Otherwise, first contact needs @mention; after the bot has replied in this DM/thread,
 * follow-ups do not need a mention. Parent text channels always need @mention (bot opens a thread).
 */
export function ambientInboundAllowed(opts: {
  unrestricted: boolean;
  mentionedBot: boolean;
  channelId: string;
  isDm: boolean;
  isThread: boolean;
  isParentGuildText: boolean;
  unlockedChannelIds: ReadonlySet<string>;
}): boolean {
  if (opts.unrestricted) {
    return true;
  }
  if (
    (opts.isDm || opts.isThread) &&
    opts.unlockedChannelIds.has(opts.channelId)
  ) {
    return true;
  }
  return discordAmbientEligibility({
    mentionsBot: opts.mentionedBot,
    isDm: opts.isDm,
    isThread: opts.isThread,
    isParentGuildText: opts.isParentGuildText,
  });
}
