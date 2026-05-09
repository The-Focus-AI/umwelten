import { z } from "zod";

export const factSchema = z.object({
  type: z.enum([
    "preference",
    "memory",
    "plan",
    "activity",
    "health",
    "professional",
    "miscellaneous",
  ]),
  text: z.string(),
});

export type Fact = z.infer<typeof factSchema>;

export const factsSchema = z.object({
  facts: z.array(factSchema),
});

export type FactSchema = z.infer<typeof factsSchema>;

export interface MemoryFact extends Fact {
  id: string;
}

// Memory item interface
export interface MemoryItem extends MemoryFact {
  hash: string;
  created_at: string;
  updated_at: string;
}

export const memoryOperationSchema = z.object({
  id: z.string().describe("The id of the memory item"),
  fact: factSchema,
  event: z
    .enum(["ADD", "UPDATE", "NONE"])
    .describe("how the memory item should be updated"),
  old_memory: z
    .string()
    .describe("The old memory item, if the event is UPDATE")
    .optional(),
});

export type MemoryOperation = z.infer<typeof memoryOperationSchema>;
export const memoryOperationResultSchema = z.object({
  memory: z.array(memoryOperationSchema),
});

export type MemoryOperationResult = z.infer<typeof memoryOperationResultSchema>;
