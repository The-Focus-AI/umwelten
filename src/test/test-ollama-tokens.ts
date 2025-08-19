import { ollama } from "ai-sdk-ollama";
import { generateText } from "ai";

async function testOllamaTokenUsage() {
  console.log('🧪 Testing Ollama token usage...');
  console.log('='.repeat(50));
  
  try {
    // Test with a simple prompt
    const model = ollama('llama3.2:latest');
    
    console.log('🤖 Generating text with Ollama...');
    const result = await generateText({
      model,
      prompt: "Hello, how are you today?",
    });
    
    console.log('\n📝 Response:');
    console.log('='.repeat(30));
    console.log(result.text);
    
    console.log('\n🔍 Raw result object:');
    console.log('='.repeat(30));
    console.log(JSON.stringify(result, null, 2));
    
    console.log('\n📊 Token Usage Analysis:');
    console.log('='.repeat(30));
    console.log('Has usage property:', 'usage' in result);
    console.log('Usage object:', result.usage);
    console.log('Usage type:', typeof result.usage);
    
    if (result.usage) {
      console.log('Prompt tokens:', result.usage.promptTokens);
      console.log('Completion tokens:', result.usage.completionTokens);
      console.log('Total tokens:', result.usage.totalTokens);
    }
    
  } catch (error) {
    console.error('❌ Error testing Ollama:', error);
  }
}

testOllamaTokenUsage().catch(console.error);
