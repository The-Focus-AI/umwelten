# Walkthroughs

Practical, step-by-step guides demonstrating real-world usage of umwelten features.

## Habitat

### [Setting Up an Agent in Habitat](./habitat-setup-walkthrough.md)

Build a complete agent environment from scratch with a custom persona, tools, sub-agents, and multiple interfaces:

- Create and customize a habitat work directory
- Write a custom persona (STIMULUS.md)
- Add tools (direct export and factory pattern)
- Register and delegate to sub-agents
- Run as CLI REPL and Telegram bot
- Configure environment variables and model defaults

**Time Required:** 15-20 minutes
**Prerequisites:** Node.js 20+, pnpm, a provider API key
**Optional:** Telegram bot token, Tavily API key

### [Habitat Bridge Walkthrough](./habitat-bridge-walkthrough.md)

Use the Habitat Bridge System to manage remote repositories in isolated, auto-provisioned containers:

- Create BridgeAgents with zero configuration
- Automatic iterative provisioning (detects npm, pip, cargo, etc.)
- Execute commands in persistent containers via MCP
- Work with git repositories programmatically
- Debug and monitor bridge containers

**Time Required:** 10-15 minutes
**Prerequisites:** Docker, Dagger CLI, GITHUB_TOKEN env var
**Best For:** Remote repo execution, complex containerized workflows

## Session Management

### [Session Analysis Walkthrough](./session-analysis-walkthrough.md)

Learn how to use the session management tools to understand your Claude Code work:

- List and inspect sessions
- Index sessions with LLM analysis
- Search through your work semantically
- Analyze patterns and trends
- Find past solutions quickly

**Time Required:** 10-15 minutes
**Prerequisites:** Claude Code sessions in a project
**Cost:** ~$0.03 per 100 sessions indexed

### [TRMNL Project Analysis](./trmnl-project-analysis.md)

Real example of analyzing a project using session management tools:

- **Project:** TRMNL Image Agent (automated e-ink dashboard)
- **Sessions Analyzed:** 42
- **Insights:** Success rates, technology stack, key learnings, optimization patterns
- **Outcome:** Comprehensive understanding of 44 Claude sessions

This walkthrough demonstrates the actual output and insights you can gain from analyzing your own projects.

## Coming Soon

- **Multi-Model Evaluation** - Compare different LLMs on the same task
- **Batch Processing Workflows** - Process large document sets efficiently
- **Cost Optimization Strategies** - Minimize API costs while maximizing quality
- **Custom Tool Integration** - Build and integrate your own tools

## Contributing Walkthroughs

Have an interesting use case or workflow? We'd love to feature it!

1. Create a markdown file in `docs/walkthroughs/`
2. Follow the format: Overview → Prerequisites → Step-by-step → Results
3. Include real commands and actual output where possible
4. Submit a PR with your walkthrough

See our [Contributing Guide](../../CONTRIBUTING.md) for details.
