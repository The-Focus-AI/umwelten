import { z } from 'zod';

/**
 * Schema for extracting structured information from product reviews
 * 
 * Usage:
 * umwelten eval run \
 *   --prompt "Analyze this product review and extract key information" \
 *   --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
 *   --id "product-review-analysis" \
 *   --zod-schema "./examples/schemas/product-review.ts"
 */
export const schema = z.object({
  // Product information
  productName: z.string().describe('Name of the product being reviewed'),
  brand: z.string().describe('Brand or manufacturer name'),
  category: z.string().describe('Product category (e.g., Electronics, Clothing, Home)'),
  
  // Review details
  rating: z.number().int().min(1).max(5).describe('Star rating (1-5)'),
  reviewTitle: z.string().optional().describe('Title of the review if available'),
  
  // Sentiment analysis
  overallSentiment: z.enum(['very_positive', 'positive', 'neutral', 'negative', 'very_negative'])
    .describe('Overall sentiment of the review'),
  
  // Key aspects
  positiveAspects: z.array(z.string()).describe('Positive aspects mentioned in the review'),
  negativeAspects: z.array(z.string()).describe('Negative aspects or complaints'),
  
  // Detailed analysis
  priceValue: z.enum(['excellent', 'good', 'fair', 'poor', 'not_mentioned'])
    .describe('Assessment of price-to-value ratio'),
  qualityRating: z.enum(['excellent', 'good', 'fair', 'poor', 'not_mentioned'])
    .describe('Assessment of product quality'),
  
  // Purchase recommendation
  wouldRecommend: z.boolean().describe('Whether the reviewer would recommend this product'),
  targetAudience: z.string().optional().describe('Who this product is best suited for'),
  
  // Additional context
  verifiedPurchase: z.boolean().optional().describe('Whether this was a verified purchase'),
  helpfulnessScore: z.number().min(0).max(10).optional().describe('How helpful this review is (0-10)'),
  
  // Extract specific mentions
  competitors: z.array(z.object({
    name: z.string(),
    comparison: z.string().describe('How it compares to this product')
  })).optional().describe('Competitor products mentioned'),
  
  // Technical details if mentioned
  technicalSpecs: z.array(z.object({
    feature: z.string(),
    value: z.string(),
    satisfied: z.boolean().describe('Whether reviewer was satisfied with this spec')
  })).optional().describe('Technical specifications mentioned')
});

export type ProductReview = z.infer<typeof schema>;

export default schema;