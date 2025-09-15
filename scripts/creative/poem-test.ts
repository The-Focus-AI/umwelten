import { Stimulus } from "../src/stimulus/stimulus.js";
import { Interaction } from "../src/interaction/interaction.js";

const model = { name: "llama3.2:latest", provider: "ollama" };

const poemStimulus = new Stimulus({
  role: "literary genius", 
  objective: "write a short poems",
  temperature: 0.5,
  maxTokens: 100,
  runnerType: 'base'
});
const interaction = new Interaction(model, poemStimulus);

interaction.addMessage({ role: "user", content: "Write a short poem about a cat." });
const response = await interaction.streamText();
console.log(response.content);

// console.log(response);