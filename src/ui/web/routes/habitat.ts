import type { RouteHandler } from '../types.js';

/**
 * GET /api/habitat — summary of the habitat: name, model, agents, tools, skills.
 * Shape preserved from gaia-server.ts for compatibility with existing Gaia UI.
 */
export const habitatRoute: RouteHandler = {
  method: 'GET',
  path: '/api/habitat',
  async handle(ctx) {
    const config = ctx.habitat.getConfig();
    const tools = Object.keys(ctx.habitat.getTools());
    const agents = ctx.habitat.getAgents();
    const skills = ctx.habitat
      .getSkills()
      .map((s) => ({ name: s.name, description: s.description }));
    const stimulus = await ctx.habitat.getStimulus();
    const stimulusText = stimulus.getPrompt();

    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(
      JSON.stringify({
        name: config.name ?? 'Unnamed Habitat',
        provider: config.defaultProvider,
        model: config.defaultModel,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          projectPath: a.projectPath,
          gitRemote: a.gitRemote,
          commands: a.commands ? Object.keys(a.commands) : [],
          logPatterns: a.logPatterns,
          statusFile: a.statusFile,
        })),
        tools,
        skills,
        stimulus: stimulusText.slice(0, 2000),
        memoryFiles: config.memoryFiles,
        workDir: ctx.habitat.getWorkDir(),
      }),
    );
  },
};
