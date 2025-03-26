export interface ModelOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface ModelResponse {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface Model {
  generateText(prompt: string, options?: ModelOptions): Promise<ModelResponse>;
} 