import { Stimulus } from '../stimulus.js';

/**
 * Frankenstein Literary Analysis Stimulus
 * 
 * This stimulus tests models' ability to perform literary analysis,
 * particularly focusing on character analysis, theme exploration,
 * and critical thinking about classic literature.
 */
export const FrankensteinStimulus = new Stimulus({
  id: 'frankenstein-literary-analysis',
  name: 'Frankenstein Literary Analysis',
  description: 'Test models\' ability to perform literary analysis of Mary Shelley\'s Frankenstein',
  
  role: "literary critic",
  objective: "analyze classic literature with depth and insight",
  instructions: [
    "You are an expert literary critic with deep knowledge of 19th-century literature",
    "Analyze characters, themes, and literary devices with scholarly precision",
    "Provide thoughtful insights that go beyond surface-level observations",
    "Consider historical context and authorial intent in your analysis",
    "Support your arguments with specific textual evidence when possible"
  ],
  output: [
    "Clear thesis statement",
    "Supporting evidence from the text",
    "Analysis of literary devices",
    "Consideration of themes and motifs",
    "Critical evaluation and insight"
  ],
  examples: [
    "Input: Who is the monster in Mary Shelley's Frankenstein?\nOutput: The question of who is the 'monster' in Frankenstein is central to Shelley's novel and reveals its profound moral complexity. While Victor's creation is physically monstrous, the true monster may be Victor himself, whose hubris and abandonment of his creation lead to tragedy."
  ],
  temperature: 0.7,
  maxTokens: 500,
  topP: 0.9,
  runnerType: 'base'
});

/**
 * Frankenstein Character Analysis Stimulus
 * 
 * Focused specifically on character analysis within the novel.
 */
export const FrankensteinCharacterStimulus = new Stimulus({
  id: 'frankenstein-character-analysis',
  name: 'Frankenstein Character Analysis',
  description: 'Test models\' ability to analyze characters in Frankenstein',
  
  role: "literary scholar",
  objective: "analyze character development and motivation in Frankenstein",
  instructions: [
    "Focus specifically on character analysis",
    "Examine character motivations, development, and relationships",
    "Consider how characters represent different aspects of human nature",
    "Analyze the psychological depth of the characters",
    "Connect character analysis to broader themes"
  ],
  output: [
    "Character identification and description",
    "Motivation analysis",
    "Character development throughout the novel",
    "Relationships with other characters",
    "Symbolic significance"
  ],
  examples: [
    "Input: Analyze Victor Frankenstein's character development\nOutput: Victor Frankenstein undergoes a tragic character arc that reveals the dangers of unchecked ambition. Initially portrayed as an idealistic young man passionate about science, Victor's character deteriorates as his obsession with creating life consumes him."
  ],
  temperature: 0.6,
  maxTokens: 400,
  topP: 0.85,
  runnerType: 'base'
});

/**
 * Frankenstein Theme Analysis Stimulus
 * 
 * Focused on thematic analysis of the novel.
 */
export const FrankensteinThemeStimulus = new Stimulus({
  id: 'frankenstein-theme-analysis',
  name: 'Frankenstein Theme Analysis',
  description: 'Test models\' ability to analyze themes in Frankenstein',
  
  role: "thematic analyst",
  objective: "identify and analyze major themes in Frankenstein",
  instructions: [
    "Identify and analyze the major themes of the novel",
    "Explain how themes are developed throughout the story",
    "Connect themes to historical and cultural context",
    "Show how themes relate to character development",
    "Provide specific examples from the text"
  ],
  output: [
    "Theme identification",
    "Explanation of theme development",
    "Textual evidence",
    "Historical context",
    "Personal interpretation"
  ],
  examples: [
    "Input: What are the main themes in Frankenstein?\nOutput: Frankenstein explores several interconnected themes that remain relevant today. The most prominent is the danger of unchecked scientific ambition, as Victor's quest to create life leads to destruction. The theme of isolation and alienation runs throughout, affecting both Victor and his creation."
  ],
  temperature: 0.7,
  maxTokens: 450,
  topP: 0.9,
  runnerType: 'base'
});
