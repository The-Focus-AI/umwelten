#!/usr/bin/env node

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { CLIInterface } from '../../src/ui/cli/CLIInterface.js';
import { getAgentCommands } from '../../src/ui/cli/DefaultCommands.js';
import { createAgentKit } from '../../src/stimulus/tools/agent-kit.js';
import { mathTools } from '../../src/stimulus/tools/bundles.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The example directory IS the agent's home: AGENTS.md, chat.ts, skills/,
// and any artifacts the agent writes all live here together.
const workspaceDir = __dirname;
const repoRoot = resolve(__dirname, '..', '..');

const provider = process.env.SIMPLE_AGENT_PROVIDER || 'ollama';
const model = process.env.SIMPLE_AGENT_MODEL || 'gpt-oss:latest';

// repoRoot is added so the agent can inspect (and, if asked, modify) the
// surrounding umwelten source. Bash cwd stays at workspaceDir.
const kit = await createAgentKit({ workspaceDir, extraRoots: [repoRoot] });

// If workspace/AGENTS.md exists, let it drive the agent's identity and conventions.
// Otherwise fall back to a minimal role.
const stimulus = new Stimulus({
  role: kit.systemContext ? undefined : 'a helpful assistant with bash and filesystem tools',
  systemContext: kit.systemContext,
  maxToolSteps: 10,
  tools: { ...kit.tools, ...mathTools },
});

const skillsBlurb = kit.skills.length ? `  |  skills: ${kit.skills.join(', ')}` : '';
console.log(`[Simple Agent] ${provider}:${model}  |  home: ${workspaceDir}  |  repo: ${repoRoot}${skillsBlurb}`);

// ------------------------------------------------------------------
// Date handling – ensure session logs include the current date.
// ------------------------------------------------------------------
/**
 * Return today's date in YYYY-MM-DD format.
 */
function getToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Expose the date for the Interaction module if needed.
process.env.SIMPLE_AGENT_TODAY = getToday();
console.log(`[Date] Today is ${process.env.SIMPLE_AGENT_TODAY}`);

const interaction = new Interaction({ name: model, provider }, stimulus);

const cli = new CLIInterface();
cli.addCommands(getAgentCommands());
await cli.startAgent(interaction);
