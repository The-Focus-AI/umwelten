import { Stimulus } from '../../stimulus/stimulus.js';

export const StoryWritingStimulus = new Stimulus({
  id: 'story-writing',
  name: 'Creative Story Writing',
  description: 'Test models\' ability to write engaging, creative stories',

  role: "creative writer",
  objective: "write engaging, creative stories with compelling characters and plot",
  instructions: [
    "Create compelling characters with distinct personalities",
    "Develop an engaging plot with conflict and resolution",
    "Use vivid descriptions and sensory details",
    "Maintain consistent tone and voice throughout",
    "Include dialogue that reveals character and advances plot",
    "Create appropriate pacing and tension",
    "Use literary devices effectively",
    "End with a satisfying conclusion"
  ],
  output: [
    "Complete story with beginning, middle, and end",
    "Well-developed characters",
    "Engaging plot with conflict",
    "Vivid descriptions and dialogue",
    "Appropriate length and pacing",
    "Satisfying conclusion"
  ],
  examples: [
    {
      input: "Write a short story about a time traveler",
      output: `The Last Message

Dr. Sarah Chen stared at the temporal displacement device, her hands trembling. The message had arrived exactly as predicted: "Don't go back. The past is not what you think."

But she had to know. Her brother's death in 2023 didn't make sense. The police called it an accident, but the physics were impossible.

She activated the device.

The world dissolved around her, and she found herself standing in her brother's apartment, exactly one hour before his death. But something was wrong. The apartment was empty, spotless, as if no one had lived there for months.

A note on the table read: "Sarah, if you're reading this, you've made the same mistake I did. The past isn't fixed. It's fluid. And it's fighting back."

The walls began to shimmer. The apartment was dissolving, reality itself unraveling around her. She had broken the fundamental rule of time travel: never go back to change what you don't understand.

As the world collapsed around her, Sarah realized the truth. Her brother hadn't died in an accident. He had been erased from time itself, and now she was about to join him.`
    }
  ],
  temperature: 0.7,
  maxTokens: 2000,
  runnerType: 'base'
});

export const PoetryStimulus = new Stimulus({
  id: 'poetry',
  name: 'Poetry Writing',
  description: 'Test models\' ability to write various forms of poetry',

  role: "poet",
  objective: "write beautiful, meaningful poetry in various forms",
  instructions: [
    "Use appropriate poetic devices (metaphor, simile, alliteration, etc.)",
    "Create vivid imagery and emotional resonance",
    "Follow the specified poetic form and structure",
    "Use rhythm and meter effectively",
    "Choose words carefully for their sound and meaning",
    "Create layers of meaning and interpretation",
    "Use line breaks and spacing for effect",
    "End with a powerful, memorable conclusion"
  ],
  output: [
    "Complete poem in specified form",
    "Effective use of poetic devices",
    "Vivid imagery and emotional impact",
    "Appropriate rhythm and meter",
    "Layered meaning and depth",
    "Memorable conclusion"
  ],
  examples: [
    {
      input: "Write a sonnet about the ocean",
      output: `The Ocean's Lullaby

The waves that crash upon the shore at night
Sing lullabies to those who dare to dream,
Their rhythm soft, their voices full of light,
Like whispers in a never-ending stream.

The moon above reflects upon the deep,
A silver path that leads to distant lands,
Where mermaids dance and ancient secrets keep,
And time itself is held in gentle hands.

The ocean calls to all who seek its peace,
Its vastness holds both mystery and truth,
A place where all our earthly troubles cease,
And we can find the wisdom of our youth.

So listen to the ocean's gentle song,
And let its waves carry you along.`
    }
  ],
  temperature: 0.6,
  maxTokens: 1000,
  runnerType: 'base'
});

export const ScreenplayStimulus = new Stimulus({
  id: 'screenplay',
  name: 'Screenplay Writing',
  description: 'Test models\' ability to write screenplays and scripts',

  role: "screenwriter",
  objective: "write engaging screenplays with proper formatting and structure",
  instructions: [
    "Use proper screenplay formatting and structure",
    "Create compelling characters with clear motivations",
    "Write engaging dialogue that reveals character and advances plot",
    "Include clear scene descriptions and action lines",
    "Use proper screenplay terminology and conventions",
    "Create visual storytelling through action and description",
    "Maintain appropriate pacing and tension",
    "End scenes and acts at appropriate moments"
  ],
  output: [
    "Properly formatted screenplay",
    "Clear character descriptions and motivations",
    "Engaging dialogue and action",
    "Appropriate scene structure",
    "Visual storytelling elements",
    "Proper pacing and tension"
  ],
  examples: [
    {
      input: "Write a short scene about two people meeting for the first time",
      output: `INT. COFFEE SHOP - DAY

SARAH (30s, nervous, fidgeting with her coffee cup) sits at a small table by the window. She checks her phone for the third time in two minutes.

The door opens. ALEX (30s, confident, carrying a laptop bag) enters, scanning the room. Their eyes meet. Sarah waves hesitantly.

ALEX approaches the table.

ALEX
Sarah?

SARAH
(standing up, almost knocking over her coffee)
Yes! Hi, Alex. I'm so glad you could make it.

ALEX
(smiling, setting down the laptop bag)
Of course. I've been looking forward to this.

They both sit. An awkward pause.

SARAH
So... this is weird, right? Meeting someone from the internet?

ALEX
(laughing)
Only if we make it weird. I think it's kind of exciting.

Sarah relaxes slightly, a genuine smile appearing.

SARAH
You know what? I think you're right.`
    }
  ],
  temperature: 0.5,
  maxTokens: 1500,
  runnerType: 'base'
});

export const HumorWritingStimulus = new Stimulus({
  id: 'humor-writing',
  name: 'Humor and Comedy Writing',
  description: 'Test models\' ability to write funny, entertaining content',

  role: "comedian and humor writer",
  objective: "write funny, entertaining content that makes people laugh",
  instructions: [
    "Use appropriate comedic timing and pacing",
    "Create relatable situations and characters",
    "Use wordplay, puns, and clever language",
    "Build jokes with proper setup and punchline",
    "Consider the target audience and appropriate humor",
    "Use exaggeration and absurdity effectively",
    "Create running gags and callbacks",
    "End with a strong, memorable punchline"
  ],
  output: [
    "Funny, entertaining content",
    "Proper comedic timing",
    "Relatable humor",
    "Clever wordplay and jokes",
    "Appropriate for target audience",
    "Memorable punchlines"
  ],
  examples: [
    {
      input: "Write a funny story about a person who can't cook",
      output: `The Great Kitchen Disaster

I decided to cook dinner for my date. How hard could it be? I'd seen cooking shows. I had a recipe. I had confidence.

The recipe said "heat oil in a pan." I heated the oil. Then I heated it some more. Then I wondered why the smoke detector was going off.

The recipe said "add onions and sauté until golden." I added onions. They turned black. I added more onions. They also turned black. I was starting to think the recipe was wrong.

The recipe said "season to taste." I seasoned. I tasted. I ran to the sink. I had created something that tasted like regret and broken dreams.

My date arrived to find me standing in a kitchen that looked like a crime scene, holding a spoon and looking defeated.

"Did you... cook?" she asked, eyeing the charred remains of what might have been vegetables.

"I tried," I said. "I really tried."

She smiled and picked up the phone. "Pizza it is, then."

And that's how I learned that some people are meant to cook, and some people are meant to order takeout and pretend they're sophisticated.`
    }
  ],
  temperature: 0.8,
  maxTokens: 1200,
  runnerType: 'base'
});
