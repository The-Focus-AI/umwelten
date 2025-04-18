import { ModelDetails } from "../models/types.js";

export type PromptOptions = {
    role?: string,
    objective?: string,
    instructions?: string[],
    reasoning?: string,
    output?: string[],
    examples?: string[] 
}

export class Prompt {
    private options: PromptOptions;

    constructor(options?: PromptOptions) {
        this.options = options || {role: "helpful assistant"};
    }

    addInstruction(instruction: string) {
        this.options.instructions = this.options.instructions || [];
        this.options.instructions.push(instruction);
    }

    addOutput(output: string) {
        this.options.output = this.options.output || [];
        this.options.output.push(output);
    }

    getPrompt() {
        let prompt = [];
        if (this.options.role) {
            prompt.push(`You are a ${this.options.role}.`);
        }
        if (this.options.objective) {
            prompt.push(`Your objective is to ${this.options.objective}.`);
        }
        if (this.options.instructions) {
            prompt.push(`\n# Instructions\n- ${this.options.instructions.join( "\n- ")}\n`);
        }
        if (this.options.reasoning) {
            prompt.push(`Your reasoning is to ${this.options.reasoning}.`);
        }
        if (this.options.output) {
            prompt.push(`\n# Output Format\n- ${this.options.output.join( "\n- ")}\n`);
        }
        if (this.options.examples) {
            prompt.push(`Your examples are to ${this.options.examples}.`);
        }
        
        
        return prompt.join("\n");
    }
}