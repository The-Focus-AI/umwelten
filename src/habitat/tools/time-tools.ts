/**
 * Habitat time tool: returns current date and time, optionally in a given timezone.
 */

import { tool } from 'ai';
import { z } from 'zod';

const timeSchema = z.object({
  timezone: z
    .string()
    .optional()
    .describe(
      'IANA timezone (e.g. America/New_York, Europe/London, Asia/Tokyo). If omitted, uses the system/local timezone.'
    ),
});

export const currentTimeTool = tool({
  description:
    'Get the current date and time. Use when the user asks for the time, date, "now", or what time it is. Optionally pass a timezone for "time in X".',
  inputSchema: timeSchema,
  execute: async ({ timezone }) => {
    const now = new Date();
    try {
      const iso = now.toISOString();
      const locale = timezone
        ? now.toLocaleString('en-US', { timeZone: timezone })
        : now.toLocaleString();
      const dateOnly = timezone
        ? now.toLocaleDateString('en-CA', { timeZone: timezone })
        : now.toLocaleDateString('en-CA');
      return {
        iso,
        locale,
        date: dateOnly,
        ...(timezone && { timezone }),
      };
    } catch {
      return {
        error: `Invalid timezone: ${timezone}. Use IANA names (e.g. America/New_York, Europe/London).`,
        iso: now.toISOString(),
      };
    }
  },
});
