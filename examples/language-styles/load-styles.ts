/**
 * Load the five language-style registers from their SKILL.md files.
 *
 * Each register is a standard agentskills-spec skill under ./skills/<id>/SKILL.md.
 * The SKILL.md body is the single source of truth for the style's rules: it is
 * injected into the generation stimulus, quoted to the judge, and rendered into
 * the report methodology. Frontmatter `metadata` carries label/role/temperature.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadSkillsFromDirectory } from '@umwelten/core/stimulus/skills/loader.js';
import type { SkillDefinition } from '@umwelten/core/stimulus/skills/types.js';

export const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'skills');

/** Baseline first, then increasing distance from standard prose. */
const STYLE_ORDER = [
  'standard-english',
  'strunk-white',
  'victorian-english',
  'will-self',
  'iambic-pentameter',
];

export interface StyleDef {
  /** Skill name, used as the eval section and in task ids. */
  id: string;
  /** Human label for reports. */
  label: string;
  /** Stimulus role ("You are a ..."). */
  role: string;
  /** The SKILL.md body — the rules of the register, verbatim. */
  rules: string;
  temperature: number;
  skill: SkillDefinition;
}

function toStyleDef(skill: SkillDefinition): StyleDef {
  const meta = skill.metadata ?? {};
  const temperature = Number(meta.temperature);
  return {
    id: skill.name,
    label: meta.label ?? skill.name,
    role: meta.role ?? 'writer',
    rules: skill.instructions,
    temperature: Number.isFinite(temperature) ? temperature : 0.7,
    skill,
  };
}

export async function loadStyles(): Promise<StyleDef[]> {
  const skills = await loadSkillsFromDirectory(SKILLS_DIR);
  if (skills.length === 0) {
    throw new Error(`No skills found in ${SKILLS_DIR} — each style needs a <id>/SKILL.md`);
  }
  const styles = skills.map(toStyleDef);
  return styles.sort((a, b) => {
    const ai = STYLE_ORDER.indexOf(a.id);
    const bi = STYLE_ORDER.indexOf(b.id);
    return (ai === -1 ? STYLE_ORDER.length : ai) - (bi === -1 ? STYLE_ORDER.length : bi)
      || a.id.localeCompare(b.id);
  });
}
