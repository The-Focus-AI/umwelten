#!/usr/bin/env tsx

/**
 * Example demonstrating the new Interaction + Interface pattern
 * 
 * This shows how the same interaction can be used with different interfaces
 */

import { 
  ChatInteraction, 
  EvaluationInteraction, 
  AgentInteraction,
  CLIInterface,
  WebInterface,
  ModelDetails 
} from '../src/ui/index.js';

async function demonstrateNewPattern() {
  console.log("🚀 Demonstrating New Interaction + Interface Pattern\n");

  // Example model details
  const modelDetails: ModelDetails = {
    name: "qwen3:latest",
    provider: "ollama"
  };

  // 1. Chat Interaction with CLI Interface
  console.log("1. Chat Interaction with CLI Interface");
  console.log("=====================================");
  
  const chatInteraction = new ChatInteraction(modelDetails);
  const cliInterface = new CLIInterface();
  
  console.log("Chat interaction created with:");
  console.log("- Conversational system prompt");
  console.log("- Memory-enabled runner");
  console.log("- Common chat tools:", Object.keys(chatInteraction.getVercelTools() || {}));
  console.log("- Multi-step tool calling (max 5 steps)");
  console.log();

  // 2. Evaluation Interaction
  console.log("2. Evaluation Interaction");
  console.log("========================");
  
  const evalInteraction = new EvaluationInteraction(
    modelDetails, 
    "Analyze the quality of this code and provide a score from 1-10"
  );
  
  console.log("Evaluation interaction created with:");
  console.log("- Evaluation-focused system prompt");
  console.log("- Base runner (no memory needed)");
  console.log("- Evaluation-specific tools:", Object.keys(evalInteraction.getVercelTools() || {}));
  console.log("- Structured output support");
  console.log();

  // 3. Agent Interaction
  console.log("3. Agent Interaction");
  console.log("===================");
  
  const agentInteraction = new AgentInteraction(
    modelDetails,
    "Data Analysis Agent",
    ["Analyze data", "Generate reports", "Make recommendations"]
  );
  
  console.log("Agent interaction created with:");
  console.log("- Agent-focused system prompt");
  console.log("- Memory-enabled runner for learning");
  console.log("- Comprehensive tool set:", Object.keys(agentInteraction.getVercelTools() || {}));
  console.log("- Extended multi-step capabilities (max 10 steps)");
  console.log();

  // 4. Web Interface Example
  console.log("4. Web Interface Example");
  console.log("========================");
  
  const webInterface = new WebInterface(chatInteraction);
  
  console.log("Web interface created with:");
  console.log("- React-compatible hooks");
  console.log("- State management");
  console.log("- Real-time streaming support");
  console.log("- Message history tracking");
  console.log();

  // 5. Usage Examples
  console.log("5. Usage Examples");
  console.log("=================");
  
  console.log("// CLI Usage:");
  console.log("const chatInteraction = new ChatInteraction(modelDetails);");
  console.log("const cliInterface = new CLIInterface();");
  console.log("await cliInterface.startChat(chatInteraction);");
  console.log();

  console.log("// Web Usage:");
  console.log("const chatInteraction = new ChatInteraction(modelDetails);");
  console.log("const webInterface = new WebInterface(chatInteraction);");
  console.log("const { sendMessage, messages, isLoading } = useWebInterface(chatInteraction);");
  console.log();

  console.log("// Agent Usage:");
  console.log("const agentInteraction = new AgentInteraction(modelDetails, 'Data Analyst', ['analyze', 'report']);");
  console.log("const agentInterface = new AgentInterface(modelDetails, 'Data Analyst');");
  console.log("await agentInterface.startAgent({ 'file-change': handler });");
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
