import { z } from 'zod';

export const schema = z.object({
  name: z.string().describe('Person\'s full name'),
  age: z.number().describe('Age in years'),
  email: z.string().optional(),
  active: z.boolean()
});

export default schema;