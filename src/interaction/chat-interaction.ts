import { Interaction } from "./interaction.js";
import { ModelDetails, ModelOptions } from "../cognition/types.js";
// No default tools; caller must attach tools explicitly if desired

/**
 * ChatInteraction - Specialized interaction for conversational AI
 * 
 * Pre-configured with:
 * - Conversational system prompt
 * - Memory-enabled runner
 * - Common chat tools (calculator, weather, etc.)
 * - Multi-step tool calling support
 */
export class ChatInteraction extends Interaction {
  constructor(modelDetails: ModelDetails, options?: ModelOptions, useMemory: boolean = true) {
    const systemPrompt = `You are a helpful AI assistant. Be conversational, engaging, and helpful.

IMPORTANT: Always respond with text content first. Only use tools when you need specific information that you cannot provide from your knowledge.

For simple greetings, questions, or conversations, respond directly with text. Do not use tools unless the user specifically asks for:
- Weather information
- Mathematical calculations
- File analysis
- Random numbers
- Statistical analysis

When you do use tools, provide a clear text response explaining the results.`;
    super(modelDetails, systemPrompt, options, useMemory ? 'memory' : 'base'); // Use memory or base runner
    // Enable multi-step tool calling for complex tasks
    this.setMaxSteps(5);
  }

  /**
   * Add a user message and get a response
   */
  async chat(message: string): Promise<string> {
    this.addMessage({ role: "user", content: message });
    const response = await this.streamText();
    return response.content;
  }

  /**
   * Get conversation history as a formatted string
   */
  getConversationHistory(): string {
    return this.getMessages()
      .filter(msg => msg.role !== "system")
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
  }
}
