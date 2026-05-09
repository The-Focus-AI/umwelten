/**
 * Build one user turn from recent Discord history: consecutive user messages after
 * the last bot message in the fetched window (messages oldest → newest).
 */
export function collectUnansweredUserTexts(
  messages: Array<{ authorIsBot: boolean; content: string }>,
): string | null {
  if (messages.length === 0) {
    return null;
  }
  let lastBotIdx = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].authorIsBot) {
      lastBotIdx = i;
    }
  }
  const after = messages
    .slice(lastBotIdx + 1)
    .filter((m) => !m.authorIsBot && m.content.trim().length > 0);
  if (after.length === 0) {
    return null;
  }
  return after.map((m) => m.content.trim()).join("\n\n");
}
