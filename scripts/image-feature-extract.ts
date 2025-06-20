import { z, ZodObject, ZodRawShape } from 'zod';
import { Prompt } from '../src/conversation/prompt.js';
import { ModelDetails, ModelResponse } from '../src/models/types.js';
import { Conversation } from '../src/conversation/conversation.js';
import { BaseModelRunner } from '../src/models/runner.js';

export const ImageFeatureSchema = z.object({
  able_to_parse: z.object({
    value: z.boolean().describe('Is the model able to parse and analyze the attached image? true only if you actually see and analyze the image, false otherwise.'),
    confidence: z.number().min(0).max(1).describe('Confidence score for image parsing ability (0-1)'),
  }),
  image_description: z.object({
    value: z.string().describe('A detailed description of the image'),
    confidence: z.number().min(0).max(1).describe('Confidence score for image description (0-1)'),
  }),
  contain_text: z.object({
    value: z.boolean().describe('Does the image contain captioned text or subtitles'),
    confidence: z.number().min(0).max(1).describe('Confidence score for text presence (0-1)'),
  }),
  color_palette: z.object({
    value: z.enum(["warm", "cool", "monochrome", "earthy", "pastel", "vibrant", "neutral", "unknown"]).describe('Dominant color palette'),
    confidence: z.number().min(0).max(1).describe('Confidence score for color palette (0-1)'),
  }),
  aesthetic_style: z.object({
    value: z.enum(["realistic", "cartoon", "abstract", "clean", "vintage", "moody", "minimalist", "unknown"]).describe('Aesthetic style of the image'),
    confidence: z.number().min(0).max(1).describe('Confidence score for aesthetic style (0-1)'),
  }),
  time_of_day: z.object({
    value: z.enum(["day", "night", "unknown"]).describe('Time of day depicted in the image. Allowed values: "day", "night", "unknown".'),
    confidence: z.number().min(0).max(1).describe('Confidence score for time of day (0-1)'),
  }).describe('Time of day (day, night, or unknown)'),
  scene_type: z.object({
    value: z.enum(["indoor", "outdoor", "unknown"]).describe('Is the scene indoors or outdoors? Allowed values: "indoor", "outdoor", "unknown".'),
    confidence: z.number().min(0).max(1).describe('Confidence score for scene type (0-1)'),
  }).describe('Scene type (indoor, outdoor, or unknown)'),
  people_count: z.object({
    value: z.number().int().describe('Number of people in the image (integer)'),
    confidence: z.number().min(0).max(1).describe('Confidence score for people count (0-1)'),
  }),
  dress_style: z.object({
    value: z.enum(["fancy", "casual", "unknown"]).describe('Are people dressed fancy or casual? Allowed values: "fancy", "casual", "unknown".'),
    confidence: z.number().min(0).max(1).describe('Confidence score for dress style (0-1)'),
  }).describe('Dress style (fancy, casual, or unknown)'),
});

export type ImageFeature = z.infer<typeof ImageFeatureSchema>;


const featurePrompt = new Prompt();
featurePrompt.setRole('You are an expert image analyst.');
featurePrompt.setObjective('Given an image, extract the following features and return them as a JSON object.');
// featurePrompt.setOutputSchema(ImageFeatureSchema);

export async function imageFeatureExtract(imagePath: string, model: ModelDetails): Promise<ModelResponse> {
  const conversation = new Conversation(model, featurePrompt.getPrompt());
  await conversation.addAttachmentFromPath(imagePath);
  const runner = new BaseModelRunner();
  return runner.streamObject(conversation, ImageFeatureSchema);
} 