import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

async function testReasoningStreaming() {
  console.log('🧠 Testing Streaming Reasoning Tokens with Gemma3');
  console.log('='.repeat(60));

  // Test with Gemma3 models that support reasoning
  const models = [
    { name: 'gemma3:12b', provider: 'ollama' },
    { name: 'gemma3:27b', provider: 'ollama' },
  ];

  for (const modelDetails of models) {
    console.log(`\n🔍 Testing ${modelDetails.name}...`);
    console.log('-'.repeat(40));

    const prompt = "I need a script that will give me at least 1042 distinct but made up show names. They should be funny and grammatically correct and written in TypeScript. Think through this step by step.";
    
    const interaction = new Interaction(
      modelDetails, 
      "You are a TypeScript developer. Generate working TypeScript code that compiles and runs successfully. Always wrap your code in ```typescript code blocks. Think through your approach step by step."
    );
    interaction.addMessage({ role: 'user', content: prompt });
    
    const runner = new BaseModelRunner();
    
    try {
      console.log('🤖 Starting streaming with reasoning...\n');
      
      const response = await runner.streamText(interaction);
      
      console.log('\n' + '='.repeat(60));
      console.log('📊 FINAL RESULTS:');
      console.log('='.repeat(60));
      console.log(`Model: ${response.metadata.model}`);
      console.log(`Provider: ${response.metadata.provider}`);
      console.log(`Response Length: ${response.content.length} characters`);
      console.log(`Tokens Used: ${response.metadata.tokenUsage.completionTokens} completion tokens`);
      
      if (response.reasoning) {
        console.log(`\n🧠 REASONING CAPTURED:`);
        console.log('-'.repeat(40));
        console.log(response.reasoning);
        console.log(`Reasoning Length: ${response.reasoning.length} characters`);
      } else {
        console.log('\n❌ No reasoning captured');
      }
      
      // Check if TypeScript code was extracted
      const codeMatch = response.content.match(/```typescript\n([\s\S]*?)\n```/);
      if (codeMatch) {
        console.log(`\n✅ TypeScript code extracted (${codeMatch[1].length} characters)`);
      } else {
        console.log('\n❌ No TypeScript code blocks found');
      }
      
    } catch (error) {
      console.error(`❌ Error testing ${modelDetails.name}:`, error);
    }
    
    console.log('\n' + '='.repeat(60));
  }
}

// Run the test
testReasoningStreaming().catch(console.error);
