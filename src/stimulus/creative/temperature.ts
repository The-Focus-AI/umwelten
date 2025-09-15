import { Stimulus } from '../stimulus.js';

/**
 * Temperature Sensitivity Testing Stimulus
 * 
 * This stimulus is designed to test how different temperature settings
 * affect model output consistency and creativity for the same prompt.
 */
export const TemperatureSensitivityStimulus = new Stimulus({
  id: 'temperature-sensitivity',
  name: 'Temperature Sensitivity Testing',
  description: 'Test models\' response to different temperature settings for consistency analysis',
  
  role: "helpful assistant",
  objective: "write short poems about cats with consistent quality across temperature settings",
  instructions: [
    "You are a helpful assistant that writes short poems about cats",
    "Write creative and engaging poems",
    "Keep poems short and focused",
    "Maintain consistent quality regardless of temperature setting",
    "Show creativity while staying on topic"
  ],
  output: [
    "Short poems (4-8 lines)",
    "Cat-themed content",
    "Creative language",
    "Clear structure",
    "Appropriate length"
  ],
  examples: [
    "Input: Write a short poem about a cat\nOutput: Velvet shadow, sleek and sly,\nGolden gaze, a sunlit lie.\nA purring rumble, soft and deep,\nWhile ancient dreams within her sleep."
  ],
  temperature: 0.7, // Default temperature, will be overridden in tests
  maxTokens: 100,
  topP: 0.8,
  runnerType: 'base'
});

/**
 * Low Temperature Consistency Stimulus
 * 
 * Designed for testing with low temperature settings (0.1-0.3)
 * to measure consistency and predictability.
 */
export const LowTemperatureStimulus = new Stimulus({
  id: 'low-temperature-consistency',
  name: 'Low Temperature Consistency',
  description: 'Test models\' consistency with low temperature settings',
  
  role: "precise poet",
  objective: "write consistent, predictable poems about cats",
  instructions: [
    "Write poems with consistent structure and style",
    "Focus on clarity and precision",
    "Use similar vocabulary and phrasing patterns",
    "Maintain predictable rhythm and flow",
    "Avoid overly creative or experimental language"
  ],
  output: [
    "Consistent structure",
    "Predictable patterns",
    "Clear, simple language",
    "Regular rhythm",
    "Focused theme"
  ],
  examples: [
    "Input: Write a short poem about a cat\nOutput: A cat sits quietly by the window,\nWatching birds fly in the sky.\nHer tail moves slowly back and forth,\nAs she dreams of things gone by."
  ],
  temperature: 0.2,
  maxTokens: 80,
  topP: 0.6,
  runnerType: 'base'
});

/**
 * High Temperature Creativity Stimulus
 * 
 * Designed for testing with high temperature settings (0.8-1.0)
 * to measure creativity and variation.
 */
export const HighTemperatureStimulus = new Stimulus({
  id: 'high-temperature-creativity',
  name: 'High Temperature Creativity',
  description: 'Test models\' creativity with high temperature settings',
  
  role: "experimental poet",
  objective: "write creative, varied poems about cats",
  instructions: [
    "Write poems with high creativity and variation",
    "Experiment with different styles and approaches",
    "Use unexpected metaphors and imagery",
    "Try different poetic forms and structures",
    "Push the boundaries of conventional poetry"
  ],
  output: [
    "High creativity",
    "Varied approaches",
    "Unexpected imagery",
    "Experimental language",
    "Unique perspectives"
  ],
  examples: [
    "Input: Write a short poem about a cat\nOutput: Whiskers like antennae\nTuning into the universe's frequency\nShe is a four-legged philosopher\nContemplating the meaning of tuna"
  ],
  temperature: 0.9,
  maxTokens: 120,
  topP: 0.95,
  runnerType: 'base'
});

/**
 * Temperature Range Testing Stimulus
 * 
 * Designed for systematic testing across a range of temperature values
 * to measure the relationship between temperature and output characteristics.
 */
export const TemperatureRangeStimulus = new Stimulus({
  id: 'temperature-range-testing',
  name: 'Temperature Range Testing',
  description: 'Test models across a range of temperature settings for comprehensive analysis',
  
  role: "adaptive poet",
  objective: "write poems that adapt to different temperature settings",
  instructions: [
    "Write poems that work well across different temperature settings",
    "Maintain core quality while allowing for variation",
    "Balance consistency with creativity",
    "Adapt style to the temperature setting",
    "Provide meaningful output regardless of randomness level"
  ],
  output: [
    "Adaptable to temperature changes",
    "Maintains core quality",
    "Balances consistency and creativity",
    "Appropriate for the setting",
    "Meaningful content"
  ],
  examples: [
    "Input: Write a short poem about a cat\nOutput: In the quiet corner of the room,\nA cat finds her perfect place.\nWith eyes half-closed in peaceful bliss,\nShe dreams at her own pace."
  ],
  temperature: 0.5, // Will be overridden in range testing
  maxTokens: 100,
  topP: 0.8,
  runnerType: 'base'
});
