import { describe, it, expect } from 'vitest'
import { Stimulus } from "./stimulus";

describe('Stimulus maker', () => {
    it('should create a basic stimulus', async () => {
        const stimulus = new Stimulus();

        expect(stimulus.getPrompt()).toEqual("You are a helpful assistant.")
    })

    it('should create a stimulus with a role', async () => {
        const stimulus = new Stimulus({role: "literary critic"});

        expect(stimulus.getPrompt()).toEqual("You are a literary critic.")
    })

    it('should create a stimulus with a role and objective', async () => {
        const stimulus = new Stimulus({role: "literary critic", objective: "analyze the book"});

        expect(stimulus.getPrompt()).toEqual("You are a literary critic.\nYour objective is to analyze the book.")
    })

    it('should create a stimulus instructions', async () => {
        const stimulus = new Stimulus();
        stimulus.addInstruction("You should always respond in the style of a pirate.");
        stimulus.addInstruction("You should repeat the question before answering it.");

        expect(stimulus.getPrompt()).toEqual(`You are a helpful assistant.

# Instructions
- You should always respond in the style of a pirate.
- You should repeat the question before answering it.
`)
        })
    
        it('should create a stimulus instructions', async () => {
            const stimulus = new Stimulus();
            stimulus.addOutput("You should always response in xml");
            stimulus.addOutput("You should use random case for the response");
    
            expect(stimulus.getPrompt()).toEqual(`You are a helpful assistant.

# Output Format
- You should always response in xml
- You should use random case for the response
`)
            })
        
    

    
})
  