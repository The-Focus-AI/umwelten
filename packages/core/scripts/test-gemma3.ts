import { createOllamaProvider } from '../src/providers/ollama.js';
import { BaseModelRunner } from '../src/model-runner.js';

async function testGemma3Model() {
  const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

  // Check if Ollama is available
  const checkOllamaConnection = async () => {
    try {
      const response = await fetch(`${OLLAMA_HOST}/api/tags`);
      return response.ok;
    } catch (e) {
      return false;
    }
  };

  const ollamaAvailable = await checkOllamaConnection();
  if (!ollamaAvailable) {
    console.warn('⚠️ Ollama not available, skipping test');
    return;
  }

  const provider = createOllamaProvider();
  const model = provider.getLanguageModel({ name: 'gemma3:12b', provider: 'ollama' });
  const prompt = 'Describe the features of gemma3:12b model';

  const modelRunner = new BaseModelRunner();

  try {
    console.log('Generating text for gemma3:12b using BaseModelRunner...');
    const response = await modelRunner.execute({
      prompt,
      model,
    });

    console.log('Generated text for gemma3:12b:', response.content);
  } catch (error) {
    console.error('Error generating text:', error);
  }
}

testGemma3Model(); 