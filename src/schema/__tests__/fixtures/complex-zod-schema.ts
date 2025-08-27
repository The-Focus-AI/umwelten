import { z } from 'zod';

export const Schema = z.object({
  id: z.string(),
  status: z.enum(['active', 'inactive', 'pending']).describe('Current status'),
  tags: z.array(z.string()).describe('List of tags'),
  metadata: z.object({
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    version: z.number().default(1)
  }),
  count: z.number().optional().describe('Optional counter'),
  settings: z.object({
    theme: z.literal('dark').or(z.literal('light')),
    notifications: z.boolean().default(true)
  }).optional()
});