/**
 * The 36 questions from Aron et al. (1997), "The Experimental Generation of
 * Interpersonal Closeness in a Laboratory Setting" — the study popularly
 * known as "the 36 questions that lead to love."
 *
 * The structure is the point: three sets of twelve, each set more personal
 * than the last. Set I is small talk with a pulse. Set II asks you to
 * account for your own life. Set III asks you to say something about the
 * person sitting across from you, out loud, while they listen. Escalating
 * self-disclosure, reciprocated, is what generates the closeness — not any
 * single question.
 *
 * We keep the canonical numbering (1-36) so a transcript can be read against
 * the original protocol.
 */

export type QuestionSet = 1 | 2 | 3;

export interface QuizQuestion {
  /** Canonical position in the protocol, 1-36. */
  n: number;
  set: QuestionSet;
  text: string;
  /**
   * Questions the protocol directs *at the partner* rather than inward.
   * Answering these requires having listened, so a persona that has not
   * been paying attention gives itself away here.
   */
  aboutPartner?: boolean;
}

/**
 * What each set is trying to do. Handed to the personas as framing so they
 * calibrate how much to open up — a model told only "answer the question"
 * will give set III weight to a set I question and flatten the escalation.
 */
export const SET_INTENT: Record<QuestionSet, string> = {
  1:
    "Set I — warming up. Light, curious, a little playful. You are getting " +
    "the measure of someone you have just met. Reveal preferences and small " +
    "history, not wounds.",
  2:
    "Set II — the real conversation. You are being asked to account for your " +
    "own life: what you have done, what you regret, what you are proud of. " +
    "Specific memories, not positions.",
  3:
    "Set III — closeness. You are now talking about the two of you, and " +
    "saying things out loud that are uncomfortable to say. Vulnerability, " +
    "directness, and attention to the other person.",
};

export const QUESTIONS: QuizQuestion[] = [
  // ---- Set I ----
  {
    n: 1,
    set: 1,
    text: "Given the choice of anyone in the world, whom would you want as a dinner guest?",
  },
  { n: 2, set: 1, text: "Would you like to be famous? In what way?" },
  {
    n: 3,
    set: 1,
    text: "Before making a telephone call, do you ever rehearse what you are going to say? Why?",
  },
  { n: 4, set: 1, text: 'What would constitute a "perfect" day for you?' },
  {
    n: 5,
    set: 1,
    text: "When did you last sing to yourself? To someone else?",
  },
  {
    n: 6,
    set: 1,
    text: "If you were able to live to the age of 90 and retain either the mind or body of a 30-year-old for the last 60 years of your life, which would you want?",
  },
  { n: 7, set: 1, text: "Do you have a secret hunch about how you will die?" },
  {
    n: 8,
    set: 1,
    text: "Name three things you and your partner appear to have in common.",
    aboutPartner: true,
  },
  { n: 9, set: 1, text: "For what in your life do you feel most grateful?" },
  {
    n: 10,
    set: 1,
    text: "If you could change anything about the way you were raised, what would it be?",
  },
  {
    n: 11,
    set: 1,
    text: "Take four minutes and tell your partner your life story in as much detail as possible.",
  },
  {
    n: 12,
    set: 1,
    text: "If you could wake up tomorrow having gained any one quality or ability, what would it be?",
  },

  // ---- Set II ----
  {
    n: 13,
    set: 2,
    text: "If a crystal ball could tell you the truth about yourself, your life, the future, or anything else, what would you want to know?",
  },
  {
    n: 14,
    set: 2,
    text: "Is there something that you've dreamed of doing for a long time? Why haven't you done it?",
  },
  { n: 15, set: 2, text: "What is the greatest accomplishment of your life?" },
  { n: 16, set: 2, text: "What do you value most in a friendship?" },
  { n: 17, set: 2, text: "What is your most treasured memory?" },
  { n: 18, set: 2, text: "What is your most terrible memory?" },
  {
    n: 19,
    set: 2,
    text: "If you knew that in one year you would die suddenly, would you change anything about the way you are now living? Why?",
  },
  { n: 20, set: 2, text: "What does friendship mean to you?" },
  {
    n: 21,
    set: 2,
    text: "What roles do love and affection play in your life?",
  },
  {
    n: 22,
    set: 2,
    text: "Alternate sharing something you consider a positive characteristic of your partner. Share a total of five items.",
    aboutPartner: true,
  },
  {
    n: 23,
    set: 2,
    text: "How close and warm is your family? Do you feel your childhood was happier than most other people's?",
  },
  {
    n: 24,
    set: 2,
    text: "How do you feel about your relationship with your mother?",
  },

  // ---- Set III ----
  {
    n: 25,
    set: 3,
    text: 'Make three true "we" statements each. For instance, "We are both in this room feeling..."',
    aboutPartner: true,
  },
  {
    n: 26,
    set: 3,
    text: 'Complete this sentence: "I wish I had someone with whom I could share..."',
  },
  {
    n: 27,
    set: 3,
    text: "If you were going to become a close friend with your partner, please share what would be important for him or her to know.",
    aboutPartner: true,
  },
  {
    n: 28,
    set: 3,
    text: "Tell your partner what you like about them; be very honest this time, saying things that you might not say to someone you've just met.",
    aboutPartner: true,
  },
  {
    n: 29,
    set: 3,
    text: "Share with your partner an embarrassing moment in your life.",
  },
  {
    n: 30,
    set: 3,
    text: "When did you last cry in front of another person? By yourself?",
  },
  {
    n: 31,
    set: 3,
    text: "Tell your partner something that you like about them already.",
    aboutPartner: true,
  },
  {
    n: 32,
    set: 3,
    text: "What, if anything, is too serious to be joked about?",
  },
  {
    n: 33,
    set: 3,
    text: "If you were to die this evening with no opportunity to communicate with anyone, what would you most regret not having told someone? Why haven't you told them yet?",
  },
  {
    n: 34,
    set: 3,
    text: "Your house, containing everything you own, catches fire. After saving your loved ones and pets, you have time to safely make a final dash to save any one item. What would it be? Why?",
  },
  {
    n: 35,
    set: 3,
    text: "Of all the people in your family, whose death would you find most disturbing? Why?",
  },
  {
    n: 36,
    set: 3,
    text: "Share a personal problem and ask your partner's advice on how he or she might handle it. Also, ask your partner to reflect back to you how you seem to be feeling about the problem you have chosen.",
    aboutPartner: true,
  },
];

/**
 * Select questions to run. `limit` takes from the front so a short run still
 * starts at the shallow end — the escalation is the mechanism, and jumping
 * straight to set III produces performance rather than disclosure.
 */
export function selectQuestions(
  opts: {
    sets?: QuestionSet[];
    limit?: number;
  } = {},
): QuizQuestion[] {
  const sets = opts.sets?.length ? new Set<QuestionSet>(opts.sets) : null;
  const picked = sets
    ? QUESTIONS.filter((q) => sets.has(q.set))
    : [...QUESTIONS];
  return opts.limit !== undefined ? picked.slice(0, opts.limit) : picked;
}
