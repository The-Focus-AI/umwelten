/**
 * Promotion — classify reflection answers and route to knowledge targets.
 */
export {
  classifyReflectionAnswer,
  extractTitle,
} from './classifier.js';
export type {
  PromotionTarget,
  PromotionDecision,
  ClassificationResult,
} from './classifier.js';

export { PromotionRouter } from './router.js';
export type { PromotionResult, PromotionRouterConfig } from './router.js';
