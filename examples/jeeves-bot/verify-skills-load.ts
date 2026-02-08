#!/usr/bin/env node
/**
 * Verify skills load: create stimulus and print loaded skills (from skillsDirs and skillsFromGit).
 * Run from examples/jeeves-bot with JEEVES_WORK_DIR set to your work dir (e.g. jeeves-bot-data-dir).
 *
 *   JEEVES_WORK_DIR="$(pwd)/jeeves-bot-data-dir" pnpm exec tsx verify-skills-load.ts
 */

import { createJeevesHabitat } from './habitat.js';

async function main() {
  const habitat = await createJeevesHabitat();
  console.log('Work dir:', habitat.workDir);
  const stimulus = await habitat.getStimulus();
  const registry = stimulus.getSkillsRegistry();
  if (!registry) {
    console.log('No skills registry.');
    return;
  }
  const skills = registry.listSkills();
  console.log('Loaded skills:', skills.length);
  for (const s of skills) {
    console.log(`  - ${s.name}: ${s.description}`);
    if (s.path) console.log(`    path: ${s.path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
