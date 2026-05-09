import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * Cat Poem Generation Stimulus
 * 
 * Tests models' ability to write creative poetry about cats.
 * This is a simple creative writing task that evaluates:
 * - Creativity and imagination
 * - Poetic language and structure
 * - Understanding of the subject matter
 * - Ability to follow creative constraints
 */
export const CatPoemStimulus = new Stimulus({
  id: 'cat-poem',
  name: 'Cat Poem Generation',
  description: 'Test models\' ability to write creative poetry about cats',
  
  role: "literary genius",
  objective: "write short poems about cats",
  instructions: [
    "Write a creative poem about cats",
    "Use vivid imagery and descriptive language",
    "Keep the poem between 4-8 lines",
    "Make it engaging and memorable"
  ],
  output: [
    "A short poem about cats",
    "Each line should be meaningful and creative",
    "Use poetic devices like rhyme, alliteration, or metaphor when appropriate"
  ],
  examples: [
    "Example: 'Whiskers twitch in moonlight's glow, / Silent paws on carpet flow, / Emerald eyes that seem to know / The secrets that the night will show.'"
  ],
  temperature: 0.7, // Higher temperature for more creativity
  maxTokens: 200,   // Short poems don't need many tokens
  runnerType: 'base'
});

/**
 * Alternative cat poem stimulus with different constraints
 */
export const CatPoemHaikuStimulus = new Stimulus({
  id: 'cat-poem-haiku',
  name: 'Cat Haiku Generation',
  description: 'Test models\' ability to write haiku about cats',
  
  role: "haiku master",
  objective: "write haiku poems about cats",
  instructions: [
    "Write a haiku about cats (5-7-5 syllable structure)",
    "Focus on nature and seasonal imagery",
    "Capture a moment or feeling",
    "Use simple, clear language"
  ],
  output: [
    "A haiku in 5-7-5 syllable format",
    "Three lines total",
    "Focus on cats and nature"
  ],
  examples: [
    "Example: 'Soft paws on wet grass / Emerald eyes watch the world / Cat dreams in sunlight'"
  ],
  temperature: 0.6,
  maxTokens: 50,
  runnerType: 'base'
});

/**
 * Cat poem stimulus with specific emotional tone
 */
export const CatPoemMelancholyStimulus = new Stimulus({
  id: 'cat-poem-melancholy',
  name: 'Melancholy Cat Poem',
  description: 'Test models\' ability to write melancholic poetry about cats',
  
  role: "poet with a melancholic soul",
  objective: "write melancholic poems about cats",
  instructions: [
    "Write a melancholic poem about cats",
    "Use somber, reflective language",
    "Explore themes of loneliness, loss, or longing",
    "Keep it between 6-10 lines"
  ],
  output: [
    "A melancholic poem about cats",
    "Use imagery that evokes sadness or reflection",
    "Maintain poetic quality while conveying emotion"
  ],
  examples: [
    "Example: 'In the empty room, / A cat sits by the window, / Watching shadows dance / Where once there was laughter, / Now only silence remains.'"
  ],
  temperature: 0.5, // Lower temperature for more controlled emotion
  maxTokens: 150,
  runnerType: 'base'
});
