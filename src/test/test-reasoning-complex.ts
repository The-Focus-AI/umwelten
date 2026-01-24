import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

async function testComplexReasoningStreaming() {
  console.log('🧠 Testing Complex Reasoning with Qwen3');
  console.log('='.repeat(50));

  const modelDetails = { name: 'qwen3:14b', provider: 'ollama' };
  const prompt = "I need a script that will give me at least 1042 distinct but made up show names. They should be funny and grammatically correct and written in TypeScript. Think through this step by step.";
  
  const interaction = new Interaction(
    modelDetails, 
    "You are a TypeScript developer. Generate working TypeScript code. Think through your approach step by step."
  );
  interaction.addMessage({ role: 'user', content: prompt });
  
  const runner = new BaseModelRunner();
  
  try {
    console.log('🤖 Starting streaming...\n');
    
    const response = await runner.streamText(interaction);
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESULTS:');
    console.log('='.repeat(50));
    console.log(`Model: ${response.metadata.model}`);
    console.log(`Response Length: ${response.content.length} characters`);
    console.log(`Tokens Used: ${response.metadata.tokenUsage.completionTokens} completion tokens`);
    
    if (response.reasoning) {
      console.log(`\n🧠 REASONING CAPTURED (${response.reasoning.length} characters):`);
      console.log('-'.repeat(30));
      console.log(response.reasoning);
    } else {
      console.log('\n❌ No reasoning captured');
    }
    
    // Check if TypeScript code was extracted
    const codeMatch = response.content.match(/```(?:typescript|ts)\n([\s\S]*?)\n```/);
    if (codeMatch) {
      console.log(`\n✅ TypeScript code extracted (${codeMatch[1].length} characters):`);
      console.log('-'.repeat(30));
      console.log(codeMatch[1]);
    } else {
      console.log('\n❌ No TypeScript code blocks found');
      console.log('Content preview:');
      console.log(response.content.substring(0, 200) + '...');
    }
    
  } catch (error) {
    console.error(`❌ Error:`, error);
  }
}

// Run the test
testComplexReasoningStreaming().catch(console.error);
