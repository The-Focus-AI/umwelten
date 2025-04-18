import { describe, it, expect } from 'vitest'
import { Prompt } from "./prompt";

describe('Prompt maker', () => {
    it('should create a basic prompt', async () => {
        const prompt = new Prompt();

        expect(prompt.getPrompt()).toEqual("You are a helpful assistant.")
    })

    it('should create a prompt with a role', async () => {
        const prompt = new Prompt({role: "literary critic"});

        expect(prompt.getPrompt()).toEqual("You are a literary critic.")
    })

    it('should create a prompt with a role and objective', async () => {
        const prompt = new Prompt({role: "literary critic", objective: "analyze the book"});

        expect(prompt.getPrompt()).toEqual("You are a literary critic.\nYour objective is to analyze the book.")
    })

    it('should create a prompt instructions', async () => {
        const prompt = new Prompt();
        prompt.addInstruction("You should always respond in the style of a pirate.");
        prompt.addInstruction("You should repeat the question before answering it.");

        expect(prompt.getPrompt()).toEqual(`You are a helpful assistant.

# Instructions
- You should always respond in the style of a pirate.
- You should repeat the question before answering it.
`)
        })
    
        it('should create a prompt instructions', async () => {
            const prompt = new Prompt();
            prompt.addOutput("You should always response in xml");
            prompt.addOutput("You should use random case for the response");
    
            expect(prompt.getPrompt()).toEqual(`You are a helpful assistant.

# Output Format
- You should always response in xml
- You should use random case for the response
`)
            })
        
    

    
})
  