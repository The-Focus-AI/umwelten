import { Stimulus } from '../stimulus.js';

/**
 * Creative Writing Templates
 * 
 * Generic templates for creative writing evaluations that can be reused
 * across different creative writing tests.
 */

export const LiteraryAnalysisTemplate = {
  role: "literary critic",
  objective: "analyze literary works",
  instructions: [
    "Provide deep literary analysis",
    "Consider themes, symbolism, and literary devices",
    "Support analysis with textual evidence",
    "Consider historical and cultural context",
    "Evaluate the work's artistic merit"
  ],
  output: [
    "Structured literary analysis",
    "Key themes and their development",
    "Evidence from the text",
    "Critical evaluation",
    "Cultural and historical context"
  ],
  temperature: 0.7,
  maxTokens: 1500,
  runnerType: 'base' as const
};

export const PoetryGenerationTemplate = {
  role: "poet",
  objective: "write poetry",
  instructions: [
    "Write in the specified poetic form",
    "Use vivid imagery and emotional language",
    "Follow poetic conventions and rhythm",
    "Create emotional resonance",
    "Maintain appropriate length and structure"
  ],
  output: [
    "Complete poem in specified form",
    "Appropriate line breaks and structure",
    "Rich imagery and emotional depth",
    "Proper poetic conventions",
    "Clear thematic coherence"
  ],
  temperature: 0.8,
  maxTokens: 1000,
  runnerType: 'base' as const
};

export const CreativeWritingTemplate = {
  role: "creative writer",
  objective: "write engaging creative content",
  instructions: [
    "Write creative, engaging content",
    "Use vivid descriptions and imagery",
    "Create compelling characters and dialogue",
    "Maintain narrative flow and pacing",
    "Show rather than tell"
  ],
  output: [
    "Engaging creative content",
    "Vivid descriptions and imagery",
    "Compelling characters and dialogue",
    "Smooth narrative flow",
    "Clear thematic elements"
  ],
  temperature: 0.7,
  maxTokens: 2000,
  runnerType: 'base' as const
};

export const StorytellingTemplate = {
  role: "master storyteller",
  objective: "craft compelling narratives",
  instructions: [
    "Create engaging story structure",
    "Develop interesting characters",
    "Build tension and conflict",
    "Use effective pacing and timing",
    "Provide satisfying resolution"
  ],
  output: [
    "Well-structured narrative",
    "Compelling character development",
    "Effective tension and conflict",
    "Appropriate pacing",
    "Satisfying conclusion"
  ],
  temperature: 0.6,
  maxTokens: 2500,
  runnerType: 'base' as const
};

export const HumorWritingTemplate = {
  role: "comedian and humor writer",
  objective: "write humorous content",
  instructions: [
    "Create appropriate humor for the context",
    "Use timing and wordplay effectively",
    "Consider the audience and appropriateness",
    "Balance humor with the main message",
    "Use various comedic techniques"
  ],
  output: [
    "Appropriate and effective humor",
    "Good comedic timing",
    "Creative wordplay and techniques",
    "Audience-appropriate content",
    "Balanced tone and message"
  ],
  temperature: 0.8,
  maxTokens: 1200,
  runnerType: 'base' as const
};

export const DialogueWritingTemplate = {
  role: "dialogue specialist",
  objective: "write natural, engaging dialogue",
  instructions: [
    "Write natural, realistic dialogue",
    "Give each character a distinct voice",
    "Use dialogue to advance plot and character",
    "Include appropriate subtext and emotion",
    "Maintain proper dialogue formatting"
  ],
  output: [
    "Natural, realistic dialogue",
    "Distinct character voices",
    "Plot and character advancement",
    "Appropriate emotional subtext",
    "Proper formatting and structure"
  ],
  temperature: 0.6,
  maxTokens: 1500,
  runnerType: 'base' as const
};

/**
 * Helper function to create a stimulus from a template
 */
export function createCreativeStimulus(
  template: typeof LiteraryAnalysisTemplate,
  overrides: Partial<typeof LiteraryAnalysisTemplate> = {}
): Stimulus {
  return new Stimulus({
    ...template,
    ...overrides
  });
}
