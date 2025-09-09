import readline from "readline";
import { Interaction } from "../../interaction/interaction.js";
import { ChatInteraction } from "../../interaction/chat-interaction.js";
import { EvaluationInteraction } from "../../interaction/evaluation-interaction.js";
import { AgentInteraction } from "../../interaction/agent-interaction.js";

/**
 * CLIInterface - Handles command-line interface interactions
 * 
 * Provides readline-based input/output for different interaction types
 */
export class CLIInterface {
  private rl?: readline.Interface;
  private isActive: boolean = false;

  /**
   * Start an interactive chat session
   */
  async startChat(interaction: ChatInteraction): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "You: ",
    });

    this.isActive = true;
    console.log("Starting chat session. Type 'exit' or 'quit' to end.\n");

    // Handle special commands
    this.setupSpecialCommands(interaction);

    // Start the chat loop
    this.rl.prompt();

    this.rl.on("line", async (line) => {
      const message = line.trim();
      
      if (message.toLowerCase() === "exit" || message.toLowerCase() === "quit") {
        this.stop();
        return;
      }

      if (message === "") {
        this.rl?.prompt();
        return;
      }

      try {
        // Add user message and get response
        interaction.addMessage({ role: "user", content: message });
        
        // Pause readline to prevent interference with streaming
        this.rl?.pause();
        
        // Clear the current line and write the model response
        process.stdout.write("\r\x1b[K"); // Clear current line
        process.stdout.write("Model: ");
        
        const response = await interaction.streamText();
        
        // Write the response with proper formatting
        if (response.content && response.content.trim()) {
          process.stdout.write(response.content);
        } else {
          process.stdout.write("[No response content received]");
        }
        process.stdout.write("\n\n");
        
      } catch (error) {
        console.error("Error:", error);
      } finally {
        // Resume readline and prompt for next input
        this.rl?.resume();
        this.rl?.prompt();
      }
    });

    this.rl.on("close", () => {
      console.log("Chat session ended.");
      this.isActive = false;
    });
  }

  /**
   * Start an evaluation session
   */
  async startEvaluation(interaction: EvaluationInteraction): Promise<void> {
    console.log("Starting evaluation session...\n");
    
    try {
      const response = await interaction.evaluate();
      console.log("Evaluation Result:");
      console.log("==================");
      console.log(response);
      console.log("\nEvaluation completed.");
    } catch (error) {
      console.error("Evaluation failed:", error);
    }
  }

  /**
   * Start an agent session
   */
  async startAgent(interaction: AgentInteraction): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "Agent Task: ",
    });

    this.isActive = true;
    console.log("Starting agent session. Type 'exit' or 'quit' to end.\n");
    console.log("Agent Role:", interaction.getAgentStatus().role);
    console.log("Available Tools:", interaction.getAgentStatus().availableTools.join(", "));
    console.log();

    this.rl.on("line", async (line) => {
      const task = line.trim();
      
      if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") {
        this.stop();
        return;
      }

      if (task === "") {
        this.rl?.prompt();
        return;
      }

      try {
        // Pause readline to prevent interference with streaming
        this.rl?.pause();
        
        // Clear the current line and write the agent response
        process.stdout.write("\r\x1b[K"); // Clear current line
        process.stdout.write("Agent: ");
        
        const response = await interaction.executeTask(task);
        
        // Write the response with proper formatting
        process.stdout.write(response);
        process.stdout.write("\n\n");
        
      } catch (error) {
        console.error("Agent error:", error);
      } finally {
        // Resume readline and prompt for next input
        this.rl?.resume();
        this.rl?.prompt();
      }
    });

    this.rl.on("close", () => {
      console.log("Agent session ended.");
      this.isActive = false;
    });
  }

  /**
   * Setup special commands for chat interactions
   */
  private setupSpecialCommands(interaction: ChatInteraction): void {
    if (!this.rl) return;

    // Override the line handler to check for special commands first
    const originalOn = this.rl.on.bind(this.rl);
    
    this.rl.on = (event: string, listener: any) => {
      if (event === "line") {
        return originalOn(event, async (line: string) => {
          const message = line.trim();
          
          // Handle special commands
          if (message === "/?") {
            this.rl?.pause();
            this.showHelp();
            this.rl?.resume();
            this.rl?.prompt();
            return;
          }
          
          if (message === "/reset") {
            this.rl?.pause();
            interaction.clearContext();
            console.log("Conversation history cleared.");
            this.rl?.resume();
            this.rl?.prompt();
            return;
          }
          
          if (message === "/history") {
            this.rl?.pause();
            console.log("Conversation history:");
            console.log(interaction.getConversationHistory());
            this.rl?.resume();
            this.rl?.prompt();
            return;
          }
          
          if (message === "/mem") {
            this.rl?.pause();
            try {
              const memoryStore = interaction.getRunner().getMemoryStore?.();
              if (memoryStore) {
                const facts = await memoryStore.getFacts(interaction.userId);
                if (facts.length === 0) {
                  console.log("No memory facts stored.");
                } else {
                  console.log("Memory facts:");
                  for (const fact of facts) {
                    console.log(`- ${fact.text}`);
                  }
                }
              } else {
                console.log("Memory not enabled for this interaction.");
              }
            } catch (error) {
              console.error("Error accessing memory:", error);
            }
            this.rl?.resume();
            this.rl?.prompt();
            return;
          }
          
          // Call the original listener for normal messages
          await listener(line);
        });
      }
      
      return originalOn(event, listener);
    };
  }

  /**
   * Show help for special commands
   */
  private showHelp(): void {
    console.log("Available commands:");
    console.log("  /?         Show this help message");
    console.log("  /reset     Clear the conversation history");
    console.log("  /history   Show chat message history");
    console.log("  /mem       Show memory facts (if memory enabled)");
    console.log("  exit, quit End the chat session");
  }

  /**
   * Stop the interface
   */
  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }
    this.isActive = false;
  }

  /**
   * Check if the interface is active
   */
  isRunning(): boolean {
    return this.isActive;
  }
}
