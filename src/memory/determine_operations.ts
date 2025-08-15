import {
  MemoryFact,
  MemoryOperationResult,
  memoryOperationResultSchema,
  MemoryOperation,
} from "./types.js";
import { Interaction } from "../interaction/interaction.js";
import { BaseModelRunner } from "../cognition/runner.js";
import { ModelDetails } from "../cognition/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Fact } from "./types.js";
// Memory operation prompt
const MEMORY_OPERATION_PROMPT = `You are a smart memory manager, who takes in a list of previous memories, and a list of new facts,
and returns a list of operations to update the memory.  For each time, you can do one of the following:

- ADD: Add a new memory
- UPDATE: Update an existing memory, for example if a user changes their name, then you should update the memory with the new name.
- NONE: Do nothing

You will receive a list of memory items with a unique ID and a list of retrieved facts.

The operations should be in the format of a JSON object with a "memory" array containing objects with "id", "fact", "event", and optionally "old_memory" fields.

If you are modifying the memory, then you should return the IDs in the output from the input IDs only and do not generate any new ID.

Alwyas return an operation for each memory item.

<example1>
<explanation>
The memory is empty, so we should add the new fact to the memory.
</explanation>
<old_memory>[]</old_memory>
<new_facts>[{"type":"personal", "text": "Name is John"}]</new_facts>
<output>
{
    "memory" : [
        {
            "id" : "0",
            "fact":{
                "text" : "Name is John",
                "type" : "personal"
            },
            "event" : "ADD"
        }
    ]
}
</output>
</example1>

<example2>
<explanation>
If a more detailed fact is added, then we should update the memory with the new information.
</explanation>
<old_memory>[{"id":"0", "fact":{"text":"Name is John", "type":"personal"}}]</old_memory>
<new_facts>[{"type":"personal", "text": "Name is John Smith"}]</new_facts>
<output>
{
    "memory" : [
        {
            "id" : "0",
            "fact":{
                "text" : "Name is John Smith",
                "type" : "personal"
            },
            "event" : "UPDATE",
            "old_memory" : "Name is John"
        }
    ]
}
</output>
</example2>


<example3>
<explanation>
If a more detailed fact is added, then we should update the memory with the new information.
</explanation>
<old_memory>[{"id":"0", "fact":{"text":"Name is John", "type":"personal"}},
{"id":"1", "fact":{"text":"I have a dog", "type":"personal"}},
{"id":"2", "fact":{"text":"I have children", "type":"personal"}}]</old_memory>
<new_facts>[{"type":"personal", "text": "I have 5 children"},
{"type":"personal", "text": "I have a dog named Max"}]</new_facts>
<output>
{ 
    "memory" : [
        {
            "id" : "0",
            "fact":{
                "text" : "Name is John",
                "type" : "personal"
            },
            "event" : "NONE",
            "old_memory" : "Name is John"
        },
        {
            "id" : "1",
            "fact":{
                "text" : "I have a dog named Max",
                "type" : "personal"
            },
            "event":"UPDATE",
            "old_memory" : "I have a dog"
        },
        {
            "id" : "2",
            "fact":{
                "text" : "I have 5 children",
                "type" : "personal"
            },
            "event" : "UPDATE"
            "old_memory" : "I have children"
        }
    ]
}
</output>
</example3>

<example4>
<explanation>
If we already know about a fact, then we should do nothing.
</explanation>
<old_memory>[{"id":"0", "fact":{"text":"Name is John", "type":"personal"}},
{"id":"1", "fact":{"text":"I have a dog", "type":"personal"}},
{"id":"2", "fact":{"text":"I have children", "type":"personal"}}]</old_memory>
<new_facts>[{"type":"preference", "text": "I have a dog"}]</new_facts>
<output>
{
    "memory" : [
        {
            "id" : "0",
            "fact":{ 
                "text" : "Name is John",
                "type" : "personal"
            },
            "event" : "NONE",
            "old_memory" : "Name is John"
        },      
        {
            "id" : "1",
            "fact":{
                "text" : "I have a dog",
                "type" : "personal"
            },
            "event" : "NONE",
            "old_memory" : "I have a dog"
        },
        {
            "id" : "2",
            "fact":{
                "text" : "I have children",
                "type" : "personal"
            },
            "event" : "NONE",
            "old_memory" : "I have children"
        }
    ]
}
</output>
</example4>
Below is the current content of my memory which I have collected till now. You have to update it in the following format only:

<previous_memory>
{previous_memory}
</previous_memory>

The new retrieved facts are mentioned in the triple backticks. You have to analyze the new retrieved facts and 
determine whether these facts should be added, updated, or deleted in the memory.

<new_facts>
{new_facts}
</new_facts>

Follow the instruction mentioned below:
- Do not return anything from the custom few shot prompts provided above.
- If the current memory is empty, then you have to add the new retrieved facts to the memory.
- You should return the updated memory in only JSON format as shown below. The memory key should be the same if no changes are made.
- If there is an addition, generate a new key and add the new memory corresponding to it.
- If there is a deletion, the memory key-value pair should be removed from the memory.
- If there is an update, the ID key should remain the same and only the value needs to be updated.

Do not return anything except the JSON format.`;

/**
 * Determine memory operations based on extracted facts and existing memories
 * @param facts The extracted facts
 * @param existingMemories Optional existing memories to consider
 * @returns Memory operation result
 */
export async function determineOperations(
  model: ModelDetails,
  facts: Fact[],
  existingMemories: MemoryFact[] = []
): Promise<MemoryOperationResult> {
  // If no facts, return empty result
  if (!facts.length) {
    return { memory: [] };
  }

  const factsContent = JSON.stringify(facts, null, 2);
  const previousMemory = JSON.stringify(existingMemories, null, 2);

  console.log("Previous Memory:", previousMemory);
  console.log("New Facts:", factsContent);
  console.log("--------------------------------");

  const prompt = MEMORY_OPERATION_PROMPT.replace(
    "{previous_memory}",
    previousMemory
  ).replace("{new_facts}", factsContent);

  const interaction = new Interaction(model, prompt);

  const runner = new BaseModelRunner();
  const result = await runner.generateObject(
    interaction,
    memoryOperationResultSchema
  );

  // Parse the content if it's a string, otherwise use it directly
  let memoryArray: MemoryOperationResult;
  if (typeof result.content === 'string') {
    memoryArray = JSON.parse(result.content) as MemoryOperationResult;
  } else {
    memoryArray = result.content as MemoryOperationResult;
  }

  console.log("Memory Operations:", JSON.stringify(memoryArray, null, 2));
  console.log("--------------------------------");

  // Ensure we return the correct structure
  return {
    memory: memoryArray.memory || []
  };
}
