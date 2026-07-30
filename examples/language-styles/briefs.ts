/**
 * The four shared briefs. Every style renders the same briefs, so content is
 * held constant while the register varies.
 *
 * `retell` is the control: its source passage is fixed and fact-dense, so
 * content fidelity is directly checkable against the listed facts.
 */

export interface Brief {
  id: string;
  name: string;
  kind: 'technical' | 'narrative' | 'persuasive' | 'style-transfer';
  prompt: string;
  /** What the judge should check survived the register. */
  contentChecklist: string[];
}

const LENGTH_NOTE =
  'Aim for roughly 150-250 words; if your voice writes in verse, 12-20 lines instead.';

export const RETELL_SOURCE = `When a honeybee finds a good patch of flowers, she returns to the hive and performs a waggle dance on the vertical comb. The angle of the dance relative to straight up encodes the direction of the flowers relative to the sun, and the duration of each waggle run encodes the distance — roughly one second of waggling for every kilometer of flight. Other bees follow the dancer, read the angle and duration with their antennae in the dark, and fly out to a patch they have never seen.`;

export const BRIEFS: Brief[] = [
  {
    id: 'explain',
    name: 'Explain next-word prediction',
    kind: 'technical',
    prompt: `Explain how a large language model predicts the next word in a sentence, for an interested reader with no technical background. ${LENGTH_NOTE}`,
    contentChecklist: [
      'Training on large amounts of text',
      'Predicting a likely next word/token given the words so far',
      'Probabilities or likelihood over many candidate words',
      'Repetition of the process to generate longer text',
    ],
  },
  {
    id: 'scene',
    name: 'Dawn rain on a country road',
    kind: 'narrative',
    prompt: `Describe walking along a country road at dawn as rain begins to fall. ${LENGTH_NOTE}`,
    contentChecklist: [
      'A walker on a country road',
      'Dawn light',
      'The onset of rain (beginning, not ongoing downpour)',
    ],
  },
  {
    id: 'argue',
    name: 'Walking improves thinking',
    kind: 'persuasive',
    prompt: `Make the case that walking improves thinking. ${LENGTH_NOTE}`,
    contentChecklist: [
      'A clear claim that walking aids thought',
      'At least two distinct supporting reasons',
      'Some acknowledgment of mechanism (rhythm, blood flow, detachment from desk, etc.)',
    ],
  },
  {
    id: 'retell',
    name: 'Retell the waggle dance',
    kind: 'style-transfer',
    prompt: `Rewrite the following passage in your own voice, preserving every factual claim it makes:\n\n"""\n${RETELL_SOURCE}\n"""\n\n${LENGTH_NOTE}`,
    contentChecklist: [
      'Bee returns to the hive after finding flowers',
      'Waggle dance performed on the vertical comb',
      'Angle relative to vertical/straight up encodes direction relative to the sun',
      'Waggle duration encodes distance (~1 second per kilometer)',
      'Other bees read the dance in the dark (antennae) and find the unseen patch',
    ],
  },
];
