// Stimulus definitions and templates
// This file exports all available stimuli organized by category

// Creative stimuli
export * from './creative/cat-poem';
export * from './creative/advanced-creative';
export * from './creative/frankenstein';
export * from './creative/poem-test';
export * from './creative/temperature';

// Coding stimuli  
export * from './coding/typescript';
export * from './coding/advanced-typescript';
export * from './coding/python';
export * from './coding/debugging';

// Analysis stimuli
export * from './analysis/pdf-analysis';
export * from './analysis/advanced-analysis';
export * from './analysis/pdf-identification';
export * from './analysis/pdf-parsing';
export * from './analysis/transcription';
export * from './analysis/tools';
export * from './analysis/image-analysis';

// Stimulus templates
export * from './templates';

// Stimulus tools
export * from './tools';

// Re-export base Stimulus class for convenience
export { Stimulus } from './stimulus';
