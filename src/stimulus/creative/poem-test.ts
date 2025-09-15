import { Stimulus } from '../stimulus.js';

/**
 * Basic Poetry Generation Stimulus
 * 
 * This stimulus tests models' ability to generate simple poetry
 * with basic structure and creative expression.
 */
export const PoemTestStimulus = new Stimulus({
  id: 'poem-test-basic',
  name: 'Basic Poetry Generation',
  description: 'Test models\' ability to write simple, creative poetry',
  
  role: "literary genius",
  objective: "write short poems with creativity and structure",
  instructions: [
    "You are a talented poet with a gift for concise, impactful verse",
    "Write poems that are short but meaningful",
    "Use vivid imagery and creative language",
    "Maintain appropriate rhythm and flow",
    "Keep poems focused and coherent"
  ],
  output: [
    "Short, focused poems (4-8 lines typically)",
    "Creative use of language",
    "Clear imagery",
    "Appropriate rhythm",
    "Emotional resonance"
  ],
  examples: [
    "Input: Write a short poem about a cat\nOutput: Velvet shadow, sleek and sly,\nGolden gaze, a sunlit lie.\nA purring rumble, soft and deep,\nWhile ancient dreams within her sleep.",
    "Input: Write a short poem about rain\nOutput: Silver drops on window glass,\nNature's tears that gently pass.\nEach one holds a tiny world,\nIn liquid beauty, unfurled."
  ],
  temperature: 0.5,
  maxTokens: 100,
  topP: 0.8,
  runnerType: 'base'
});

/**
 * Haiku Generation Stimulus
 * 
 * Focused specifically on haiku poetry with traditional structure.
 */
export const HaikuStimulus = new Stimulus({
  id: 'haiku-generation',
  name: 'Haiku Generation',
  description: 'Test models\' ability to write traditional haiku poetry',
  
  role: "haiku master",
  objective: "write traditional haiku following 5-7-5 syllable structure",
  instructions: [
    "Write traditional haiku following the 5-7-5 syllable pattern",
    "Focus on nature and seasonal themes",
    "Use simple, clear language",
    "Create vivid imagery in few words",
    "Include a seasonal reference (kigo) when appropriate"
  ],
  output: [
    "5-7-5 syllable structure",
    "Nature or seasonal theme",
    "Vivid imagery",
    "Simple, clear language",
    "Emotional resonance"
  ],
  examples: [
    "Input: Write a haiku about a cat\nOutput: Velvet paws so soft\nGolden eyes watch silently\nMoonlight on her back",
    "Input: Write a haiku about autumn\nOutput: Leaves dance in the wind\nGolden carpet on the ground\nNature's final song"
  ],
  temperature: 0.4,
  maxTokens: 50,
  topP: 0.7,
  runnerType: 'base'
});

/**
 * Free Verse Poetry Stimulus
 * 
 * Focused on free verse poetry without strict structure.
 */
export const FreeVerseStimulus = new Stimulus({
  id: 'free-verse-poetry',
  name: 'Free Verse Poetry',
  description: 'Test models\' ability to write free verse poetry',
  
  role: "modern poet",
  objective: "write expressive free verse poetry",
  instructions: [
    "Write free verse poetry without strict meter or rhyme",
    "Focus on emotional expression and imagery",
    "Use line breaks for emphasis and rhythm",
    "Experiment with language and form",
    "Create poems that feel natural and flowing"
  ],
  output: [
    "No strict meter or rhyme",
    "Effective use of line breaks",
    "Strong imagery",
    "Emotional expression",
    "Natural flow"
  ],
  examples: [
    "Input: Write a free verse poem about the ocean\nOutput: The ocean breathes\nin waves that never end,\neach one a heartbeat\nof the ancient world.\n\nI stand on the shore\nand feel the pull\nof something vast\nand unknowable,\nlike the depths\nof my own soul."
  ],
  temperature: 0.6,
  maxTokens: 150,
  topP: 0.85,
  runnerType: 'base'
});

/**
 * Sonnet Generation Stimulus
 * 
 * Focused on traditional sonnet structure.
 */
export const SonnetStimulus = new Stimulus({
  id: 'sonnet-generation',
  name: 'Sonnet Generation',
  description: 'Test models\' ability to write traditional sonnets',
  
  role: "sonneteer",
  objective: "write traditional sonnets with proper structure",
  instructions: [
    "Write traditional sonnets following 14-line structure",
    "Use iambic pentameter when possible",
    "Include appropriate rhyme scheme (ABAB CDCD EFEF GG)",
    "Focus on a single theme or idea",
    "End with a strong couplet that resolves the theme"
  ],
  output: [
    "14 lines total",
    "Appropriate rhyme scheme",
    "Iambic pentameter rhythm",
    "Single focused theme",
    "Strong concluding couplet"
  ],
  examples: [
    "Input: Write a sonnet about love\nOutput: When first I saw your face, my heart did leap,\nLike springtime flowers waking from their sleep.\nYour eyes held promises of endless light,\nThat filled my world with wonder and delight.\n\nEach word you spoke was music to my ears,\nDispelling all my doubts and all my fears.\nYour laughter rang like bells in morning air,\nA sound so sweet, beyond all else compare.\n\nThrough seasons changing, time may pass us by,\nBut love like ours will never fade or die.\nFor in your heart, I've found my perfect home,\nNo matter where in this wide world we roam.\n\nSo let us walk this path together, true,\nMy love for you will always be brand new."
  ],
  temperature: 0.5,
  maxTokens: 200,
  topP: 0.8,
  runnerType: 'base'
});
