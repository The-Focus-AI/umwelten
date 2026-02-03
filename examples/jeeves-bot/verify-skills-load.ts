#!/usr/bin/env node
/**
 * Verify skills load: create stimulus and print loaded skills (from skillsDirs and skillsFromGit).
 * Run from examples/jeeves-bot with JEEVES_WORK_DIR set to your work dir (e.g. jeeves-bot-data-dir).
 *
 *   JEEVES_WORK_DIR="$(pwd)/jeeves-bot-data-dir" pnpm exec tsx verify-skills-load.ts
 */

import { createJeevesStimulus } from './stimulus.js';
import { getWorkDir } from './config.js';

async function main() {
  const workDir = getWorkDir();
  console.log('Work dir:', workDir);
  const stimulus = await createJeevesStimulus();
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
