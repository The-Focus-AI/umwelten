import fs from 'fs';
import { ModelResponse, ScoreResponse } from '../models/types.js';
import { Evaluation } from './base.js';

export abstract class EvaluationScorer extends Evaluation {
  constructor(evaluationId: string) {
    super(evaluationId);
  }

  abstract scoreResponse(response: ModelResponse): Promise<ScoreResponse>;

  async score() {
    const responses = await this.getModelResponses();

    for( const response of responses ) {
      const scoreFile = this.getScoreFile(response);
      if( fs.existsSync(scoreFile) ) {
        console.log(`Skipping ${response.metadata.model} because it already has a score`);
        continue;
      }

      const result = await this.scoreResponse(response);
      fs.writeFileSync(scoreFile, JSON.stringify(result, null, 2));
      console.log(result);
    }
    return 0;
  }
}