// Stimulus definitions and templates
// This file exports all available stimuli organized by category

// Creative stimuli
export * from './creative/cat-poem.js';
export * from './creative/advanced-creative.js';
export * from './creative/frankenstein.js';
export * from './creative/poem-test.js';
export * from './creative/temperature.js';

// Coding stimuli
export * from './coding/typescript.js';
export * from './coding/advanced-typescript.js';
export * from './coding/python.js';
export * from './coding/debugging.js';

// Analysis stimuli
export * from './analysis/pdf-analysis.js';
export * from './analysis/advanced-analysis.js';
export * from './analysis/pdf-identification.js';
export * from './analysis/pdf-parsing.js';
export * from './analysis/transcription.js';
export * from './analysis/tools.js';
export * from './analysis/image-analysis.js';

// Stimulus templates
export * from './templates/index.js';

// Stimulus tools
export * from './tools/index.js';

// Re-export base Stimulus class for convenience
export { Stimulus } from './stimulus.js';
