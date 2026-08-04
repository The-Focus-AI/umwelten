/**
 * A person's accumulated self — the thing the quiz actually builds.
 *
 * A profile starts as a one-line sketch and fills in as its owner answers
 * questions. Three kinds of memory live here, and they are deliberately
 * separate:
 *
 * - `answers`  — what they actually said, verbatim. The raw record.
 * - `facts`    — distilled, reconciled claims about who they are (reusing
 *                @umwelten/core's memory fact types, so `determineOperations`
 *                can merge them).
 * - `impressions` — what they now believe about the *other* person. This is
 *                the half that makes a reconnection feel like a reconnection
 *                rather than a fresh chat with a stranger holding your file.
 *
 * `selfImage` is a rolling first-person paragraph rewritten as the quiz
 * deepens: the persona's own account of itself, which is what keeps a model
 * consistent across 36 questions without replaying the whole transcript.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Fact, MemoryFact } from "@umwelten/core/memory/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Where profiles live. Override with QUIZ_PROFILE_DIR. */
export const PROFILE_DIR = resolve(
  process.env.QUIZ_PROFILE_DIR ?? join(__dirname, "profiles"),
);

export interface ProfileFact extends MemoryFact {
  /** Question number this surfaced at — provenance for every claim. */
  learnedAt: number;
}

export interface Answer {
  n: number;
  set: number;
  question: string;
  text: string;
  at: string;
}

export interface Impression {
  /** Profile id of the person this impression is about. */
  about: string;
  text: string;
  /** Question number this impression was formed at. */
  at: number;
}

export interface PersonProfile {
  id: string;
  displayName: string;
  /**
   * The sparse starting sketch. Everything else on the profile is earned in
   * conversation — keep this thin or the persona has nothing to discover.
   */
  seed: string;
  createdAt: string;
  updatedAt: string;
  facts: ProfileFact[];
  answers: Answer[];
  /** Rolling first-person self-description, rewritten as the quiz deepens. */
  selfImage?: string;
  /** Impressions of other people, keyed by their profile id. */
  impressions: Record<string, Impression[]>;
}

export function profilePath(id: string): string {
  return join(PROFILE_DIR, `${id}.json`);
}

export function createProfile(opts: {
  id: string;
  displayName: string;
  seed: string;
}): PersonProfile {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    displayName: opts.displayName,
    seed: opts.seed,
    createdAt: now,
    updatedAt: now,
    facts: [],
    answers: [],
    impressions: {},
  };
}

export async function loadProfile(id: string): Promise<PersonProfile | null> {
  try {
    const raw = await readFile(profilePath(id), "utf-8");
    return JSON.parse(raw) as PersonProfile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveProfile(profile: PersonProfile): Promise<void> {
  profile.updatedAt = new Date().toISOString();
  await mkdir(PROFILE_DIR, { recursive: true });
  await writeFile(profilePath(profile.id), JSON.stringify(profile, null, 2));
}

export function recordAnswer(
  profile: PersonProfile,
  entry: { n: number; set: number; question: string; text: string },
): void {
  profile.answers.push({ ...entry, at: new Date().toISOString() });
}

export function recordImpression(
  profile: PersonProfile,
  impression: Impression,
): void {
  const list = (profile.impressions[impression.about] ??= []);
  list.push(impression);
}

/** Normalized form used for cheap duplicate detection. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merge new facts in without an LLM: drop exact restatements, keep anything
 * else. Cheap and predictable, but it cannot notice that "has a dog" and
 * "has a dog named Max" are the same fact getting sharper — that is what
 * `reconcileFacts` in reflect.ts is for.
 */
export function mergeFactsLocally(
  profile: PersonProfile,
  facts: Fact[],
  learnedAt: number,
): ProfileFact[] {
  const seen = new Set(profile.facts.map((f) => normalize(f.text)));
  const added: ProfileFact[] = [];
  for (const fact of facts) {
    const key = normalize(fact.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const stored: ProfileFact = { ...fact, id: randomUUID(), learnedAt };
    profile.facts.push(stored);
    added.push(stored);
  }
  return added;
}

/**
 * The persona's own memory, rendered for its system prompt. During the quiz
 * the live transcript carries the detail, so answers are left out; on a
 * reconnection there is no transcript and the answers *are* the memory.
 */
export function renderSelfContext(
  profile: PersonProfile,
  opts: { includeAnswers?: boolean } = {},
): string {
  const parts: string[] = [`# Who you are\n\n${profile.seed}`];

  if (profile.selfImage) {
    parts.push(
      `## How you would describe yourself right now\n\n${profile.selfImage}`,
    );
  }

  if (profile.facts.length) {
    const byType = new Map<string, string[]>();
    for (const fact of profile.facts) {
      const bucket = byType.get(fact.type) ?? [];
      bucket.push(fact.text);
      byType.set(fact.type, bucket);
    }
    const lines = [...byType].map(
      ([type, texts]) =>
        `**${type}**\n${texts.map((t) => `- ${t}`).join("\n")}`,
    );
    parts.push(`## True things about you\n\n${lines.join("\n\n")}`);
  }

  if (opts.includeAnswers && profile.answers.length) {
    const lines = profile.answers.map(
      (a) => `**Q${a.n}. ${a.question}**\nYou said: ${a.text}`,
    );
    parts.push(
      `## What you said when you were asked the 36 questions\n\n${lines.join("\n\n")}`,
    );
  }

  return parts.join("\n\n");
}

/**
 * What this person remembers about someone else: their own impressions plus
 * the things the other person told them. Written in second person about the
 * partner, so the persona reads it as memory rather than as a dossier.
 */
export function renderMemoryOfPartner(
  self: PersonProfile,
  partner: PersonProfile,
  opts: { includeAnswers?: boolean } = {},
): string {
  const impressions = self.impressions[partner.id] ?? [];

  // Only render what the partner has revealed if these two have actually been
  // in conversation. A profile holding facts is not permission to know them:
  // without this gate, sitting down with someone new hands you their file.
  //
  // The signal has to be *relational* — "the partner has answers" is a fact
  // about them alone and would let any stranger read those answers. An
  // impression in either direction means these two specific people have
  // talked. Both are empty before the first question, which is correct: they
  // have just sat down. (This does mean a run where every reflection pass
  // fails never establishes acquaintance; during the quiz the live transcript
  // still carries the conversation.)
  const haveTalked =
    impressions.length > 0 || (partner.impressions[self.id]?.length ?? 0) > 0;
  if (!haveTalked) {
    return (
      `# ${partner.displayName}\n\n` +
      `You have not talked with them yet. You know nothing about them beyond ` +
      `their name — ask.`
    );
  }

  const parts: string[] = [`# What you remember about ${partner.displayName}`];

  if (impressions.length) {
    parts.push(
      `## How they struck you\n\n${impressions
        .map((i) => `- (after Q${i.at}) ${i.text}`)
        .join("\n")}`,
    );
  }

  if (partner.facts.length) {
    parts.push(
      `## What they told you about themselves\n\n${partner.facts
        .map((f) => `- ${f.text}`)
        .join("\n")}`,
    );
  }

  if (opts.includeAnswers && partner.answers.length) {
    parts.push(
      `## Things they actually said, in their words\n\n${partner.answers
        .map(
          (a) =>
            `**Q${a.n}. ${a.question}**\n${partner.displayName}: ${a.text}`,
        )
        .join("\n\n")}`,
    );
  }

  return parts.join("\n\n");
}
