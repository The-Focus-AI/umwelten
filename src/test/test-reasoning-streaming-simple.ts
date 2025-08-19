import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';

async function testSimpleReasoningStreaming() {
  console.log('🧠 Testing Simple Streaming with GPT-OSS');
  console.log('='.repeat(50));

  const modelDetails = { name: 'qwen3:8b', provider: 'ollama' };
  const prompt = "Write a short TypeScript function that adds two numbers. Think through this step by step.";
  
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
testSimpleReasoningStreaming().catch(console.error);
