#!/usr/bin/env tsx

/**
 * Example demonstrating the new Interaction + Interface pattern
 * 
 * This shows how the same interaction can be used with different interfaces
 */

import { 
  Interaction,
  CLIInterface,
  ModelDetails 
} from '../src/ui/index.js';
import { Stimulus } from '../src/stimulus/stimulus.js';

async function demonstrateNewPattern() {
  console.log("🚀 Demonstrating New Stimulus-Driven Interaction Pattern\n");

  // Example model details
  const modelDetails: ModelDetails = {
    name: "qwen3:latest",
    provider: "ollama"
  };

  // 1. Chat Interaction with CLI Interface
  console.log("1. Chat Interaction with CLI Interface");
  console.log("=====================================");
  
  const chatStimulus = new Stimulus({
    role: "helpful AI assistant",
    objective: "be conversational, engaging, and helpful",
    instructions: [
      "Always respond with text content first",
      "Only use tools when you need specific information",
      "Be conversational and engaging"
    ],
    runnerType: 'memory',
    maxToolSteps: 5
  });
  
  const chatInteraction = new Interaction(modelDetails, chatStimulus);
  const cliInterface = new CLIInterface();
  
  console.log("Chat interaction created with:");
  console.log("- Conversational stimulus with role and objective");
  console.log("- Memory-enabled runner");
  console.log("- Multi-step tool calling (max 5 steps)");
  console.log();

  // 2. Evaluation Interaction
  console.log("2. Evaluation Interaction");
  console.log("========================");
  
  const evalStimulus = new Stimulus({
    role: "evaluation system",
    objective: "provide accurate responses for evaluation",
    instructions: [
      "Be precise and factual",
      "Follow evaluation criteria exactly",
      "Provide structured responses when requested"
    ],
    runnerType: 'base'
  });
  
  const evalInteraction = new Interaction(modelDetails, evalStimulus);
  evalInteraction.addMessage({ 
    role: "user", 
    content: "Analyze the quality of this code and provide a score from 1-10" 
  });
  
  console.log("Evaluation interaction created with:");
  console.log("- Evaluation-focused stimulus");
  console.log("- Base runner (no memory needed)");
  console.log("- Structured output support");
  console.log();

  // 3. Agent Interaction
  console.log("3. Agent Interaction");
  console.log("===================");
  
  const agentStimulus = new Stimulus({
    role: "Data Analysis Agent",
    objective: "analyze data, generate reports, and make recommendations",
    instructions: [
      "Analyze data thoroughly",
      "Generate comprehensive reports",
      "Make actionable recommendations",
      "Learn from previous interactions"
    ],
    runnerType: 'memory',
    maxToolSteps: 10
  });
  
  const agentInteraction = new Interaction(modelDetails, agentStimulus);
  
  console.log("Agent interaction created with:");
  console.log("- Agent-focused stimulus with specific role");
  console.log("- Memory-enabled runner for learning");
  console.log("- Extended multi-step capabilities (max 10 steps)");
  console.log();

  // 4. Interface Examples
  console.log("4. Interface Examples");
  console.log("====================");
  
  console.log("CLI interface created with:");
  console.log("- Interactive command handling");
  console.log("- Real-time streaming support");
  console.log("- Message history tracking");
  console.log("- Special commands (/? /reset /mem /history)");
  console.log();

  // 5. Usage Examples
  console.log("5. Usage Examples");
  console.log("=================");
  
  console.log("// CLI Usage:");
  console.log("const chatStimulus = new Stimulus({ role: 'assistant', objective: 'help', runnerType: 'memory' });");
  console.log("const chatInteraction = new Interaction(modelDetails, chatStimulus);");
  console.log("const cliInterface = new CLIInterface();");
  console.log("await cliInterface.startChat(chatInteraction);");
  console.log();

  console.log("// Evaluation Usage:");
  console.log("const evalStimulus = new Stimulus({ role: 'evaluator', objective: 'assess', runnerType: 'base' });");
  console.log("const evalInteraction = new Interaction(modelDetails, evalStimulus);");
  console.log("evalInteraction.addMessage({ role: 'user', content: 'Evaluate this code' });");
  console.log();

  console.log("// Agent Usage:");
  console.log("const agentStimulus = new Stimulus({ role: 'Data Analyst', objective: 'analyze and report', runnerType: 'memory' });");
  console.log("const agentInteraction = new Interaction(modelDetails, agentStimulus);");
  console.log("// Add tools and messages as needed");
  console.log();

  console.log("✅ New pattern demonstration complete!");
  console.log("\nKey Benefits:");
  console.log("- Same interaction works with different interfaces");
  console.log("- Pre-configured for specific use cases");
  console.log("- Clean separation of concerns");
  console.log("- Easy to extend and customize");
  console.log("- Type-safe and well-documented");
}

// Run the demonstration
if (import.meta.url.endsWith(process.argv[1])) {
  demonstrateNewPattern().catch(console.error);
}
