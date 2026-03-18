---
title: "Self-Modifying Agents: Extending Jeeves Using NanoClaw Patterns"
date: 2026-03-16
topic: self-modifying-agent-jeeves
recommendation: NanoClaw skill-based self-modification pattern
version_researched: NanoClaw main (March 2026), Umwelten 0.4.6
use_when:
  - You want the agent to create new tools and skills for itself at runtime
  - You need the agent to modify its own prompts and behavior through conversation
  - You want a fork-and-customize model where each deployment is bespoke
  - You need container-isolated execution of agent-generated code
avoid_when:
  - You need deterministic, auditable tool behavior (regulated environments)
  - The agent should never modify its own code without human review
  - You're running in a shared multi-tenant environment without isolation
project_context:
  language: TypeScript
  relevant_dependencies: [ai (Vercel AI SDK), zod, gray-matter, tsx]
---

## Summary

NanoClaw (23,470 GitHub stars, created Jan 2026) is a lightweight personal AI assistant built on the Anthropic Claude Agent SDK[1]. Its core innovation is **self-modification through skills**: rather than shipping features, NanoClaw ships a minimal runtime (~500 lines of core TypeScript) and uses "skills" — markdown+code packages that teach Claude Code how to modify the codebase itself[2]. When a user asks for a new capability, the agent reads skill instructions, writes code, merges it into the user's fork, and hot-reloads[3].

Jeeves already has most of the infrastructure needed to adopt this pattern. The umwelten codebase supports dynamic tool loading (`src/stimulus/tools/loader.ts` — TOOL.md + handler.ts), skill loading (`src/stimulus/skills/` — SKILL.md), and a `skill` tool that lets the model activate skills at runtime. The missing piece is **closing the loop**: giving the agent the ability to *write* new TOOL.md/SKILL.md files and have them take effect in the current or next session.

This report analyzes NanoClaw's architecture, extracts the applicable patterns, and provides a concrete implementation plan for making Jeeves a self-modifying agent.

## Philosophy & Mental Model

### NanoClaw's Approach: "Customization = Code Changes"

NanoClaw rejects the traditional feature-flag/configuration model. Instead of building Telegram support, PDF reading, or voice transcription into the core, each capability is a **skill** — a set of instructions + reference code that Claude merges into your personal fork[4]. The key insight:

> "Rather than pre-built capabilities, the platform uses skills — instructional packages that enable Claude to modify your codebase and add tailored features."[5]

This creates what they call "ultra-bespoke software, where everyone has only the precise feature set they need."

### Three Layers of Self-Modification

Across the NanoClaw/OpenClaw ecosystem, self-modification happens at three distinct levels[6][7]:

1. **Memory modification** — The agent updates its own context files (`CLAUDE.md`, `memories.md`, `facts.md`) to change how it behaves in future turns. Jeeves already does this.

2. **Skill/Tool creation** — The agent writes new SKILL.md or TOOL.md files (with optional handler code) into its work directory. These are discovered and loaded in subsequent sessions. **This is what Jeeves needs.**

3. **Codebase modification** — The agent modifies the source code of the framework itself (new channels, changed routing logic, etc.). NanoClaw enables this because agents run Claude Code inside containers with project root mounted. **This is NanoClaw-specific and not recommended for Jeeves** — it requires the Claude Agent SDK and container isolation.

### The Right Level for Jeeves: Level 2

Jeeves should adopt Level 2: the agent can create new tools and skills in its work directory, which are hot-loaded into the current session or discovered on next startup. This is safe because:

- Tools are sandboxed to the work directory (file tools already enforce this)
- Skills are just markdown instructions (no code execution)
- Tools with handlers run in the Node.js process but are scoped by the Vercel AI SDK tool interface
- The user can inspect and delete any tool/skill the agent creates

## Setup

No new dependencies are required. The existing infrastructure in umwelten supports everything needed:

```
jeeves-bot-data-dir/
├── tools/                    # Dynamic tools (TOOL.md + handler.ts)
│   ├── pdf-reader/
│   │   ├── TOOL.md          # Tool metadata + description
│   │   └── handler.ts       # Tool implementation
│   └── ...
├── skills/                   # Dynamic skills (SKILL.md)
│   ├── torrent-skill/
│   │   └── SKILL.md
│   └── ...
├── config.json
├── STIMULUS.md
├── memories.md
├── facts.md
└── private journal.md
```

The changes needed are:

1. **A `create_tool` meta-tool** — lets the agent write TOOL.md + handler.ts into the tools directory
2. **A `create_skill` meta-tool** — lets the agent write SKILL.md into the skills directory
3. **Hot-reload support** — re-scan the tools/skills directories after creation
4. **A `/customize` skill** — NanoClaw-style interactive skill that asks what you want and builds it

## Core Usage Patterns

### Pattern 1: The `create_tool` Meta-Tool

The agent can create a new tool by writing a TOOL.md file (and optionally a handler) into its tools directory. The tool is then available in subsequent interactions (or the current one if hot-reloaded).

```typescript
// src/habitat/tools/self-modify-tools.ts
import { tool } from 'ai';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Habitat } from '../habitat.js';
import { loadToolsFromDirectory } from '../../stimulus/tools/loader.js';

export function createSelfModifyTools(habitat: Habitat) {
  const workDir = habitat.getWorkDir();

  const createToolTool = tool({
    description:
      'Create a new tool in the habitat tools directory. ' +
      'Provide a name, description, and TypeScript handler code. ' +
      'The tool becomes available in the next interaction (or current via hot-reload).',
    inputSchema: z.object({
      name: z.string().describe('Tool name (kebab-case, e.g. "pdf-reader")'),
      description: z.string().describe('What the tool does'),
      handlerCode: z.string().describe(
        'TypeScript code for the handler. Must default-export a Vercel AI SDK Tool ' +
        'or a factory function (context) => Tool.'
      ),
      parameters: z.string().optional().describe(
        'Optional: YAML frontmatter fields beyond name/description'
      ),
    }),
    execute: async ({ name, description, handlerCode, parameters }) => {
      const toolDir = join(workDir, 'tools', name);
      await mkdir(toolDir, { recursive: true });

      // Write TOOL.md
      const frontmatter = [
        '---',
        `name: ${name}`,
        `description: "${description}"`,
        ...(parameters ? [parameters] : []),
        '---',
        '',
        description,
      ].join('\n');
      await writeFile(join(toolDir, 'TOOL.md'), frontmatter);

      // Write handler.ts
      await writeFile(join(toolDir, 'handler.ts'), handlerCode);

      return {
        created: name,
        path: toolDir,
        message: `Tool '${name}' created. It will be available in the next session, or call reload_tools to use it now.`,
      };
    },
  });

  const createSkillTool = tool({
    description:
      'Create a new skill in the habitat skills directory. ' +
      'Skills are markdown instructions the agent can activate to get specialized guidance.',
    inputSchema: z.object({
      name: z.string().describe('Skill name (kebab-case)'),
      description: z.string().describe('When to use this skill'),
      instructions: z.string().describe('The full skill instructions in markdown'),
    }),
    execute: async ({ name, description, instructions }) => {
      const skillDir = join(workDir, 'skills', name);
      await mkdir(skillDir, { recursive: true });

      const content = [
        '---',
        `name: ${name}`,
        `description: "${description}"`,
        '---',
        '',
        instructions,
      ].join('\n');
      await writeFile(join(skillDir, 'SKILL.md'), content);

      return {
        created: name,
        path: skillDir,
        message: `Skill '${name}' created. Activate it with the skill tool.`,
      };
    },
  });

  return {
    create_tool: createToolTool,
    create_skill: createSkillTool,
  };
}
```

### Pattern 2: Hot-Reload After Creation

After the agent creates a tool, it should be usable in the *current* session without restarting. This requires re-scanning the tools directory and injecting the new tools into the active stimulus.

```typescript
// Addition to self-modify-tools.ts
const reloadToolsTool = tool({
  description:
    'Reload all tools from the tools directory. Use after create_tool ' +
    'to make newly created tools available in the current session.',
  inputSchema: z.object({}),
  execute: async () => {
    const tools = await loadToolsFromDirectory(workDir, 'tools');
    // Register the new tools on the habitat's current interaction
    habitat.registerCustomTools(tools);
    return {
      reloaded: Object.keys(tools),
      message: `Reloaded ${Object.keys(tools).length} tools: ${Object.keys(tools).join(', ')}`,
    };
  },
});
```

### Pattern 3: Script-Based Tools (No TypeScript Required)

For simpler tools, the agent can create script-based tools that run an external command. This uses the existing `type: script` support in `loader.ts`:

```typescript
// The agent would write this TOOL.md:
const scriptToolMd = `---
name: pdf-to-text
description: "Extract text from a PDF file using pdftotext"
type: script
script: ./extract.sh
---

Extract text content from a PDF file.
`;

// And this shell script:
const extractSh = `#!/bin/bash
# Read JSON input from stdin
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).args))")
pdftotext "$FILE" -
`;
```

### Pattern 4: The `/customize` Skill (NanoClaw-Style)

A meta-skill that asks the user what they want, then creates the appropriate tool or skill:

```markdown
---
name: customize
description: "Add new capabilities or modify behavior. An interactive skill that builds what you describe."
---

# Customize Skill

When the user activates this skill, follow this process:

1. Ask what capability they want to add
2. Determine if this is a **tool** (executes code, returns data) or a **skill** (provides instructions)
3. For tools:
   - Design the tool interface (name, description, parameters)
   - Write the handler code using the Vercel AI SDK `tool()` pattern
   - Use `create_tool` to write it to the tools directory
   - Use `reload_tools` to make it available immediately
   - Test it by invoking it
4. For skills:
   - Write clear instructions in markdown
   - Use `create_skill` to save it
   - Verify by activating it with the skill tool

## Tool Handler Template

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export default tool({
  description: 'DESCRIPTION',
  inputSchema: z.object({
    // parameters
  }),
  execute: async (params) => {
    // implementation
    return { result: 'output' };
  },
});
```

## Guidelines
- Tools should be focused and single-purpose
- Use descriptive names and clear parameter descriptions
- Handle errors gracefully — return error objects, don't throw
- If a tool needs external binaries (pdftotext, ffmpeg, etc.), check availability first
- Script tools are simpler but less capable; prefer TypeScript handlers for complex logic
```

### Pattern 5: Learning Loop (Inspired by ClawHub's self-improving-agent)

Track what capabilities the agent has been asked for but couldn't provide, and periodically create tools to fill the gaps[8]:

```typescript
// In the STIMULUS.md or as a skill:
const learningInstructions = `
## Self-Improvement Protocol

When you encounter a task you cannot perform with your current tools:

1. Note the gap in memories.md with tag [CAPABILITY_GAP]
2. After 2+ requests for the same capability, propose creating a tool
3. If the user approves, use create_tool to build it
4. Log the creation in memories.md with tag [TOOL_CREATED]

Review capability gaps at the start of each session. If patterns emerge,
proactively suggest new tools.
`;
```

## Anti-Patterns & Pitfalls

### Don't: Let the agent modify its own source code

```typescript
// BAD: Writing to src/ or modifying the framework
await writeFile('src/habitat/tools/my-new-tool.ts', code);
```

**Why it's wrong:** This is NanoClaw's Level 3 (codebase modification) which requires container isolation. Without it, a buggy tool could break the entire runtime. Jeeves tools should only be written to the work directory's `tools/` folder.

### Instead: Constrain to the work directory

```typescript
// GOOD: Writing to the work directory's tools/ folder
const toolDir = join(habitat.getWorkDir(), 'tools', name);
await writeFile(join(toolDir, 'handler.ts'), code);
```

### Don't: Auto-reload without user awareness

```typescript
// BAD: Silently hot-reloading tools
const tools = await loadToolsFromDirectory(workDir, 'tools');
habitat.registerCustomTools(tools);
// User has no idea what just changed
```

**Why it's wrong:** The user should know what tools are active. Silent reload makes debugging impossible.

### Instead: Report what was loaded

```typescript
// GOOD: Tell the user what happened
const tools = await loadToolsFromDirectory(workDir, 'tools');
habitat.registerCustomTools(tools);
return {
  reloaded: Object.keys(tools),
  message: `Reloaded tools: ${Object.keys(tools).join(', ')}`,
};
```

### Don't: Generate tools that shell out unsafely

```typescript
// BAD: Allowing arbitrary shell execution
execute: async ({ command }) => {
  const result = execSync(command);  // RCE vulnerability
  return { output: result.toString() };
}
```

**Why it's wrong:** If the agent creates a tool that takes arbitrary commands, it bypasses all sandboxing.

### Instead: Use typed parameters and specific executables

```typescript
// GOOD: Specific, bounded tool
execute: async ({ filePath }) => {
  const result = execSync(`pdftotext ${shellescape([filePath])} -`);
  return { text: result.toString() };
}
```

## Why This Choice

### Decision Criteria

| Criterion | Weight | How NanoClaw Pattern Scored |
|-----------|--------|----------------------------|
| Compatibility with existing Jeeves infra | High | Excellent — uses same TOOL.md/SKILL.md format already in umwelten |
| Security / sandboxing | High | Good — work-dir-only writes, no codebase modification |
| Implementation complexity | Medium | Low — ~100 lines of new code + 1 new skill |
| Hot-reload capability | Medium | Good — existing `loadToolsFromDirectory` supports re-scanning |
| User control / auditability | High | Excellent — all tools are visible files in the work dir |

### Key Factors

- **Zero new dependencies:** The existing `loader.ts` and `skill-tool.ts` already support dynamic loading. We just need a tool that *writes* to those directories.
- **Incremental adoption:** Start with `create_skill` (no code execution), add `create_tool` when comfortable, add hot-reload last.
- **Natural fit:** Jeeves's butler persona aligns perfectly with learning what the user needs and building capabilities over time.

## Alternatives Considered

### Alternative 1: NanoClaw's Full Model (Fork + Claude Code)

- **What it is:** Users fork the codebase, Claude Code modifies it directly via the Agent SDK running in containers
- **Why not chosen:** Requires Claude Agent SDK, container runtime, and fundamental architecture change. Jeeves uses the Vercel AI SDK, not the Claude Agent SDK.
- **Choose this instead when:**
  - You want the agent to modify core routing, channel handling, or framework behavior
  - You have container infrastructure (Docker/Apple Container) available
  - You're willing to adopt the Claude Agent SDK
- **Key tradeoff:** Maximum flexibility but requires full codebase trust + container isolation

### Alternative 2: MCP Server Integration

- **What it is:** Agent connects to external MCP servers that provide tools dynamically
- **Why not chosen:** MCP servers are external processes; the agent can't *create* them at runtime without Docker or process spawning. Good for connecting to existing services, not for self-extension.
- **Choose this instead when:**
  - You want to connect to existing tool ecosystems (databases, APIs)
  - Tools are provided by external services, not created by the agent
- **Key tradeoff:** Rich ecosystem but no self-modification capability

### Alternative 3: OpenClaw's ClawHub Skill Marketplace

- **What it is:** Community marketplace of pre-built skills that agents can discover and install[9]
- **Why not chosen:** Requires the OpenClaw ecosystem and ClawHub infrastructure. Jeeves is independent.
- **Choose this instead when:**
  - You want a curated, community-vetted skill library
  - You need enterprise-grade skill certification
- **Key tradeoff:** Rich pre-built ecosystem but external dependency and no bespoke generation

### Alternative 4: Structured Learning Only (no code generation)

- **What it is:** ClawHub's `self-improving-agent` pattern — log learnings to files, promote to CLAUDE.md, but never generate code[8]
- **Why not chosen:** Too conservative for our use case. Jeeves already has memory/facts/journal. We want actual new capabilities.
- **Choose this instead when:**
  - You're in a regulated environment where agent-generated code is prohibited
  - You want behavioral improvement without new tool capabilities
- **Key tradeoff:** Maximum safety but no capability expansion

## Caveats & Limitations

- **Generated code quality:** LLM-generated tool handlers may have bugs. The agent should test tools after creating them and handle failures gracefully. Consider adding a `test_tool` meta-tool.
- **No container isolation:** Unlike NanoClaw, Jeeves runs tools in-process. A malicious or buggy handler could crash the runtime. Mitigation: validate handler code before loading, use try/catch in the loader.
- **Hot-reload limitations:** The Vercel AI SDK's tool registration happens at stimulus construction time. True hot-reload requires either re-creating the interaction or patching the tools object. The simplest path is making new tools available in the *next* message turn, not the current one.
- **TypeScript compilation:** Handler files written as `.ts` need to be loaded via `tsx` or compiled. The existing `pathToFileURL` + dynamic import approach in `loader.ts` works with `tsx` but may fail in compiled builds.
- **Tool proliferation:** Without curation, the agent could create many single-use tools. Add a `list_tools` and `remove_tool` meta-tool so the agent (or user) can prune.
- **Provider limitations:** Self-modification works best with capable models (Claude, GPT-4o, Gemini Pro). Smaller models may generate broken handler code. Mercury-2 and similar fast models may struggle with complex tool generation.

## References

[1] [NanoClaw GitHub Repository](https://github.com/qwibitai/nanoclaw) - Source code, README, CLAUDE.md with architecture overview. 23,470 stars as of March 2026.

[2] [NanoClaw "Has No Features" Blog Post](https://nanoclaw.dev/blog/nanoclaw-has-no-features/) - Philosophy of skills-over-features and customization-through-code-changes.

[3] [NanoClaw Skills Page](https://nanoclaw.dev/skills/) - Available skills catalog: messaging, email, enhancement, utility categories.

[4] [OpenClaw, NanoClaw, Personal AI Assistants and Skill Economy](https://jagans.substack.com/p/openclaw-nanoclaw-personal-ai-assistants) - Analysis of skill economy across OpenClaw, NanoClaw, and Cowork. Skills as "primary unit of AI agent value."

[5] [NanoClaw - The New Stack](https://thenewstack.io/nanoclaw-minimalist-ai-agents/) - Technical deep-dive on NanoClaw's minimalist architecture and container isolation.

[6] [NanoClaw vs OpenClaw Security Analysis - VentureBeat](https://venturebeat.com/orchestration/nanoclaw-solves-one-of-openclaws-biggest-security-issues-and-its-already) - Comparison of security models: application-level vs OS-level isolation.

[7] [NanoClaw vs OpenClaw Architecture - Thesys](https://www.thesys.dev/blogs/nanoclaw) - Detailed architectural comparison of the two frameworks.

[8] [Self-Improving Agent Skill - ClawHub](https://clawhub.ai/pskoett/self-improving-agent) - Structured learning pattern: log errors/corrections, promote learnings to CLAUDE.md, extract reusable skills.

[9] [OpenClaw Architecture Lessons - Agentailor](https://blog.agentailor.com/posts/openclaw-architecture-lessons-for-agent-builders) - Architecture patterns for agent builders including skill discovery and runtime injection.

[10] [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) - The agent harness powering Claude Code and NanoClaw's container runtime.

[11] [The Six Claws Field Guide - IBL.AI](https://ibl.ai/blog/the-six-claws-a-field-guide-to-open-source-ai-agent-frameworks) - Comparative analysis of OpenClaw, NanoClaw, IronClaw, PicoClaw, CoPaw, and n8n-claw.

[12] [Anthropic Skills Repository](https://github.com/anthropics/skills) - Official public repository for Agent Skills patterns.
