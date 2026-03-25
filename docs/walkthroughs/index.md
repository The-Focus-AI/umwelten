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

Use the Habitat Bridge System to manage remote repositories in isolated containers:

- Three-phase design: Create, Start, Inspect
- Saved provisioning for instant subsequent starts
- Execute commands in persistent containers via MCP
- Work with git repositories programmatically
- Debug and monitor bridge containers

**Time Required:** 10-15 minutes
**Prerequisites:** Docker running (Dagger uses Docker)
**Best For:** Remote repo execution, complex containerized workflows

### [Bridge MCP Test](./habitat-bridge-mcp-test.md)

Manual testing guide for the Bridge MCP system:

- Start a bridge and test MCP tools with curl
- Use the TypeScript client programmatically
- Inspect saved provisioning and logs

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

## Evaluation

### [Building a Multi-Model Evaluation with LLM Judging](./car-wash-evaluation.md)

Build a complete evaluation pipeline from scratch — the "Car Wash Test" that benchmarks 131 models on common-sense reasoning:

- Define model lists across Google, OpenRouter, and Ollama
- Configure Stimulus and SimpleEvaluation with caching
- Build an LLM judge with Zod-validated structured output
- Run-based caching for resumable, comparable evaluations
- Analyze and categorize results (correct / lucky / failed)

**Time Required:** 30 minutes to build, 15 minutes to run
**Prerequisites:** Node.js 20+, pnpm, Google + OpenRouter API keys
**Cost:** ~$0.50 for a full 131-model run

### [Building a Multi-Dimension Model Showdown](./model-showdown.md)

Build a comprehensive evaluation suite that tests models across 5 dimensions and generates a unified leaderboard with narrative analysis:

- Define 5 evaluation dimensions (reasoning, knowledge, instruction, coding, MCP tool use)
- Combine LLM-judged and deterministic scoring in one suite
- Use the `eval combine` system for cross-evaluation aggregation
- Generate narrative reports with per-dimension analysis and judge explanations
- Compare cost efficiency and speed across providers

**Time Required:** 30 minutes to build, 2–4 hours to run
**Prerequisites:** Node.js 20+, pnpm, Google + OpenRouter + DeepInfra API keys
**Cost:** ~$4.63 for a full 49-model run

### [Model Showdown Results](./model-showdown-results.md)

Detailed analysis of 49 models tested across 5 dimensions — reasoning, knowledge, instruction following, coding, and MCP tool use:

- **49 models** across 4 providers + local Ollama, **41 with full 5-dim MCP scores**
- Claude Sonnet 4.6 leads at 93.8% across all 5 dimensions
- `openai/gpt-oss-120b` scores 89.9% for $0.01
- Local `nemotron-3-nano:latest` on Ollama scores 84.0% for free
- Deep dives into each dimension with judge explanations
- Provider effect analysis: same weights, different results

## Coming Soon

- **Batch Processing Workflows** - Process large document sets efficiently
- **Cost Optimization Strategies** - Minimize API costs while maximizing quality
- **Custom Tool Integration** - Build and integrate your own tools

## Contributing Walkthroughs

Have an interesting use case or workflow? We'd love to feature it!

1. Create a markdown file in `docs/walkthroughs/`
2. Follow the format: Overview -> Prerequisites -> Step-by-step -> Results
3. Include real commands and actual output where possible
4. Submit a PR with your walkthrough

See our [Contributing Guide](../../CONTRIBUTING.md) for details.
