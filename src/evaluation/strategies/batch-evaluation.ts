import { EvaluationStrategy, EvaluationResult, EvaluationMetadata } from '../types/evaluation-types.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { Interaction } from '../../interaction/interaction.js';

export interface BatchItem {
  id: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface BatchConfig {
  items: BatchItem[];
  maxConcurrent?: number;
  progressCallback?: (progress: BatchProgress) => void;
  groupByModel?: boolean;
}

export interface BatchProgress {
  completed: number;
  total: number;
  currentModel: string;
  currentItem: string;
  percentage: number;
}

export interface BatchResult extends EvaluationResult {
  item: BatchItem;
  itemIndex: number;
}

export class BatchEvaluation implements EvaluationStrategy {
  constructor(
    public stimulus: Stimulus,
    public models: ModelDetails[],
    public prompt: string,
    private cache: EvaluationCache,
    private config: BatchConfig
  ) {
    // Set defaults
    this.config = {
      maxConcurrent: 5,
      groupByModel: false,
      ...config
    };
  }

  async run(): Promise<BatchResult[]> {
    const results: BatchResult[] = [];
    let completed = 0;
    const total = this.models.length * this.config.items.length;

    if (this.config.groupByModel) {
      // Process all items for each model sequentially
      for (const model of this.models) {
        const modelResults = await this.processModelBatch(model, completed, total);
        results.push(...modelResults);
        completed += this.config.items.length;
      }
    } else {
      // Process all model-item combinations
      for (const item of this.config.items) {
        for (const model of this.models) {
          const result = await this.evaluateItem(model, item, completed, total);
          results.push(result);
          completed++;
        }
      }
    }

    return results;
  }

  private async processModelBatch(
    model: ModelDetails, 
    startCompleted: number, 
    total: number
  ): Promise<BatchResult[]> {
    const results: BatchResult[] = [];
    let completed = startCompleted;

    for (const item of this.config.items) {
      const result = await this.evaluateItem(model, item, completed, total);
      results.push(result);
      completed++;
    }

    return results;
  }

  private async evaluateItem(
    model: ModelDetails, 
    item: BatchItem, 
    completed: number, 
    total: number
  ): Promise<BatchResult> {
    const startTime = Date.now();

    try {
      // Create item-specific prompt
      const itemPrompt = this.createItemPrompt(item);
      
      // Create unique cache key for this item
      const itemKey = `item-${item.id}`;
      
      const response = await this.cache.getCachedModelResponse(
        model,
        `${this.stimulus.id}-${itemKey}`,
        async () => {
          const interaction = new Interaction(model, this.stimulus);
          interaction.addMessage({ role: 'user', content: itemPrompt });
          return await interaction.generateText();
        }
      );

      const duration = Date.now() - startTime;

      const metadata: EvaluationMetadata = {
        stimulusId: this.stimulus.id,
        evaluationId: this.cache.getWorkdir()?.split(require('path').sep).pop() || 'unknown',
        timestamp: new Date(),
        duration,
        cached: false
      };

      // Update progress
      if (this.config.progressCallback) {
        this.config.progressCallback({
          completed: completed + 1,
          total,
          currentModel: model.name,
          currentItem: item.id,
          percentage: ((completed + 1) / total) * 100
        });
      }

      return {
        model,
        response,
        metadata,
        item,
        itemIndex: this.config.items.findIndex(i => i.id === item.id)
      };

    } catch (error) {
      console.error(`Error evaluating item ${item.id} with model ${model.name}:`, error);
      
      const metadata: EvaluationMetadata = {
        stimulusId: this.stimulus.id,
        evaluationId: this.cache.getWorkdir()?.split(require('path').sep).pop() || 'unknown',
        timestamp: new Date(),
        duration: Date.now() - startTime,
        cached: false,
        error: error instanceof Error ? error.message : String(error)
      };

      return {
        model,
        response: {
          content: '',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { promptTokens: 0, completionTokens: 0 },
            provider: model.provider,
            model: model.name,
            cost: { total: 0, prompt: 0, completion: 0 }
          }
        },
        metadata,
        item,
        itemIndex: this.config.items.findIndex(i => i.id === item.id)
      };
    }
  }

  private createItemPrompt(item: BatchItem): string {
    // Replace placeholders in the prompt with item content
    let itemPrompt = this.prompt;
    
    // Replace {content} with the item content
    itemPrompt = itemPrompt.replace(/{content}/g, item.content);
    
    // Replace {id} with the item ID
    itemPrompt = itemPrompt.replace(/{id}/g, item.id);
    
    // Replace any metadata placeholders
    if (item.metadata) {
      for (const [key, value] of Object.entries(item.metadata)) {
        const placeholder = `{${key}}`;
        itemPrompt = itemPrompt.replace(new RegExp(placeholder, 'g'), String(value));
      }
    }
    
    return itemPrompt;
  }

  getItems(): BatchItem[] {
    return this.config.items;
  }

  getTotalItems(): number {
    return this.config.items.length;
  }

  getTotalEvaluations(): number {
    return this.models.length * this.config.items.length;
  }
}
