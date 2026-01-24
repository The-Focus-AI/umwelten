import { BaseModelRunner } from '../src/cognition/runner';
import { Interaction } from '../src/interaction/interaction';
import { Stimulus } from '../src/interaction/stimulus';

async function testModel(modelName: string) {
  console.log(`\n🧠 Testing ${modelName} with simple prompt`);
  console.log('='.repeat(50));
  
  const modelDetails = { name: modelName, provider: 'ollama' };
  const prompt = "I need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in typescript.";
  
  try {
    const interaction = new Interaction(modelDetails, "You are a helpful TypeScript developer.");
    interaction.addMessage({
      role: "user",
      content: prompt
    });
    
    const runner = new BaseModelRunner();
    console.log('🤖 Starting streaming...\n');
    
    const result = await runner.streamText(interaction);
    
    console.log('\n📝 Final Response:');
    console.log('='.repeat(50));
    console.log(result.content);
    
    console.log('\n🧠 Reasoning:');
    console.log('='.repeat(50));
    console.log(result.reasoning || 'No reasoning captured');
    
    console.log('\n📊 Metadata:');
    console.log('='.repeat(50));
    console.log(`Response Length: ${result.content.length} characters`);
    console.log(`Response Time: ${result.metadata.startTime && result.metadata.endTime ? `${new Date(result.metadata.endTime).getTime() - new Date(result.metadata.startTime).getTime()}ms` : 'N/A'}`);
    
  } catch (error) {
    console.error(`❌ Error testing ${modelName}:`, error);
  }
}

async function main() {
  // Test just one model first
  await testModel('llama3.2:latest');
}

main().catch(console.error);
