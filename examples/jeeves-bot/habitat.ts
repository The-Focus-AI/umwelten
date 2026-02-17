/**
 * Jeeves Habitat: thin wrapper around Habitat setting Jeeves-specific defaults.
 * Sets envPrefix='JEEVES', defaultWorkDirName='.jeeves', adds Tavily + Dagger tools.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Habitat } from '../../src/habitat/index.js';
import { tavilySearchTool } from './tools/tavily.js';
import { createRunProjectTool } from '../../src/habitat/tools/run-project/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createJeevesHabitat(): Promise<Habitat> {
  return Habitat.create({
    envPrefix: 'JEEVES',
    defaultWorkDirName: '.jeeves',
    defaultSessionsDirName: '.jeeves-sessions',
    stimulusTemplatePath: join(__dirname, 'JEEVES_PROMPT.md'),
    registerCustomTools: async (habitat) => {
      habitat.addTool('search', tavilySearchTool);
      habitat.addTool('run_project', createRunProjectTool(habitat));
    },
  });
}
