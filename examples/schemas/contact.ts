import { z } from 'zod';

export const ContactSchema = z.object({
  name: z.string().describe('Contact name'),
  email: z.string().email().describe('Email address'),
  phone: z.string().describe('Phone number'),
  company: z.string().describe('Company name')
});

export type Contact = z.infer<typeof ContactSchema>;

// Export as default for Zod loader compatibility
export default ContactSchema;
