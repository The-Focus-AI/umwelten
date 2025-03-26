import { ModelOptions, ModelProvider, ModelResponse, ModelRunner } from './types';

export class BaseModelRunner implements ModelRunner {
  async execute(params: {
    prompt: string;
    model: ModelProvider;
    options?: ModelOptions;
  }): Promise<ModelResponse> {
    const startTime = new Date();
    
    try {
      const response = await params.model.execute(params.prompt, params.options);
      
      // Ensure the response has the correct timing metadata
      response.metadata.startTime = startTime;
      response.metadata.endTime = new Date();
      
      return response;
    } catch (error) {
      // Add proper error handling
      if (error instanceof Error) {
        throw new Error(`Model execution failed: ${error.message}`);
      }
      throw new Error('Model execution failed with unknown error');
    }
  }
} 