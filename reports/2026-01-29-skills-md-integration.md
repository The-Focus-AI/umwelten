---
title: "Agent Skills (SKILL.md) Integration for Stimulus/Runner"
date: 2026-01-29
topic: skills-integration
recommendation: Native SKILL.md Support via Stimulus Extension
version_researched: Agent Skills 1.0 (agentskills.io)
use_when:
  - You want to give agents domain-specific knowledge dynamically
  - You need portable, cross-platform skill definitions
  - You want to share skills across multiple agent instances
  - Teams need to codify organizational workflows as reusable skills
avoid_when:
  - You only need simple, static tool definitions
  - Skills are tightly coupled to a single agent implementation
  - Real-time tool execution is the primary concern (skills are context, not tools)
project_context:
  language: TypeScript
  relevant_dependencies: [ai, zod]
---

## Summary

Agent Skills is an open standard for giving AI agents new capabilities through portable instruction packages[1]. A skill is a directory containing a `SKILL.md` file with YAML frontmatter (name, description) and markdown instructions, optionally bundled with scripts, references, and assets[2]. The format was developed by Anthropic and adopted by Claude Code, OpenAI Codex CLI, Cursor, VS Code Copilot, and 20+ other tools[3].

The umwelten Stimulus/Runner architecture already has the extension points needed to support skills: Stimulus accepts `systemContext` for dynamic context injection, tools are registered via `addTool()`, and runner hooks enable side effects[4]. Skills can be integrated at three levels: as additional system context (instructions loaded into the prompt), as tool discovery (skills can define allowed-tools), and as runner hooks (for skill activation tracking).

Key metrics: Agent Skills spec has been adopted by 26+ tools including Claude Code, OpenAI Codex, Cursor, VS Code, and Gemini CLI[3]. The `anthropics/skills` repository contains production-ready examples[5]. The specification is maintained at agentskills.io with a reference validation library[6].

## Philosophy & Mental Model

Agent Skills implements **progressive disclosure of context**. Rather than loading all possible instructions at startup (which wastes context window), skills are discovered based on their descriptions and loaded on-demand when relevant[7].

```
┌─────────────────────────────────────────────────────────┐
│                     Context Budget                       │
├─────────────────────────────────────────────────────────┤
│  Metadata Layer (~100 tokens per skill)                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Skill A │ │ Skill B │ │ Skill C │ │ Skill D │  ...  │
│  │  name   │ │  name   │ │  name   │ │  name   │       │
│  │  desc   │ │  desc   │ │  desc   │ │  desc   │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│                         ▼                               │
│  Instructions Layer (<5000 tokens when activated)       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Skill B SKILL.md body (loaded on activation)   │   │
│  └─────────────────────────────────────────────────┘   │
│                         ▼                               │
│  Resources Layer (as needed)                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │  scripts/  references/  assets/                  │   │
│  │  (loaded only when referenced in instructions)   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Key abstractions:**

1. **Skill = Executable Knowledge Package**: A skill bundles instructions + optional code + references into a portable unit[8].

2. **Description = Activation Trigger**: The agent reads skill descriptions to decide when to activate them. Good descriptions include keywords users would naturally say[9].

3. **Invocation Modes**: Skills can be model-invoked (agent decides), user-invoked (/skill-name), or both[9].

4. **Context Injection**: When activated, the full SKILL.md body replaces placeholders like `$ARGUMENTS` and injects into the conversation[10].

## Setup

### Directory Structure

Create a skills directory in your project:

```bash
mkdir -p ~/.umwelten/skills/my-skill
# or per-project:
mkdir -p .umwelten/skills/my-skill
```

### SKILL.md File Format

Create `my-skill/SKILL.md`:

```yaml
---
name: my-skill
description: What this skill does and when to use it. Include keywords users would say.
---

# Instructions

Step-by-step instructions for the agent to follow when this skill is activated.

## Examples

- Example usage patterns
- Expected outputs
```

### Install Dependencies

No additional dependencies required—skills are parsed as markdown with YAML frontmatter:

```bash
pnpm add yaml gray-matter  # For YAML parsing
```

## Core Usage Patterns

### Pattern 1: Skill Loader Module

Create a skill loader that discovers and parses SKILL.md files:

```typescript
// src/stimulus/skills/loader.ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';

export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  path: string;
  // Optional fields from Agent Skills spec
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
  // Claude Code extensions
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'fork' | 'inline';
  argumentHint?: string;
}

export async function loadSkillsFromDirectory(
  skillsDir: string
): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
      try {
        const content = await readFile(skillMdPath, 'utf-8');
        const { data, content: body } = matter(content);

        // Validate required fields per Agent Skills spec
        if (!data.name || typeof data.name !== 'string') {
          console.warn(`Skill ${entry.name}: missing or invalid 'name' field`);
          continue;
        }
        if (!data.description || typeof data.description !== 'string') {
          console.warn(`Skill ${entry.name}: missing or invalid 'description' field`);
          continue;
        }

        skills.push({
          name: data.name,
          description: data.description,
          instructions: body.trim(),
          path: join(skillsDir, entry.name),
          license: data.license,
          compatibility: data.compatibility,
          allowedTools: data['allowed-tools']?.split(/\s+/),
          metadata: data.metadata,
          disableModelInvocation: data['disable-model-invocation'],
          userInvocable: data['user-invocable'],
          context: data.context,
          argumentHint: data['argument-hint'],
        });
      } catch {
        // Skip directories without SKILL.md
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return skills;
}
```

### Pattern 2: Skills Registry for Stimulus

Create a registry that tracks loaded skills and generates context:

```typescript
// src/stimulus/skills/registry.ts
import { SkillDefinition, loadSkillsFromDirectory } from './loader.js';

export class SkillsRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private activatedSkills: Set<string> = new Set();

  async loadFromDirectories(dirs: string[]): Promise<void> {
    for (const dir of dirs) {
      const skills = await loadSkillsFromDirectory(dir);
      for (const skill of skills) {
        this.skills.set(skill.name, skill);
      }
    }
  }

  /**
   * Get skill metadata for system prompt (progressive disclosure layer 1)
   * Claude uses this to decide when to activate skills
   */
  getSkillsMetadataPrompt(): string {
    const available = Array.from(this.skills.values())
      .filter(s => !s.disableModelInvocation);

    if (available.length === 0) return '';

    const lines = ['# Available Skills', ''];
    for (const skill of available) {
      lines.push(`- **${skill.name}**: ${skill.description}`);
    }
    lines.push('');
    lines.push('To use a skill, invoke it by name. Skills provide specialized instructions.');

    return lines.join('\n');
  }

  /**
   * Activate a skill and return its instructions (layer 2)
   */
  activateSkill(name: string, args?: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) return null;

    this.activatedSkills.add(name);

    // Apply argument substitution per Claude Code spec
    let instructions = skill.instructions;
    if (args) {
      // Replace $ARGUMENTS with provided arguments
      if (instructions.includes('$ARGUMENTS')) {
        instructions = instructions.replace(/\$ARGUMENTS/g, args);
      } else {
        // Append if $ARGUMENTS not present
        instructions += `\n\nARGUMENTS: ${args}`;
      }

      // Handle positional arguments $0, $1, etc.
      const argParts = args.split(/\s+/);
      for (let i = 0; i < argParts.length; i++) {
        instructions = instructions.replace(
          new RegExp(`\\$ARGUMENTS\\[${i}\\]|\\$${i}`, 'g'),
          argParts[i]
        );
      }
    }

    return instructions;
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  listUserInvocableSkills(): SkillDefinition[] {
    return this.listSkills().filter(s => s.userInvocable !== false);
  }
}
```

### Pattern 3: Stimulus with Skills Support

Extend Stimulus to support skills:

```typescript
// src/stimulus/stimulus-with-skills.ts
import { Stimulus, StimulusOptions } from './stimulus.js';
import { SkillsRegistry } from './skills/registry.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StimulusWithSkillsOptions extends StimulusOptions {
  skillsDirs?: string[];
  autoLoadSkills?: boolean;
}

export class StimulusWithSkills extends Stimulus {
  public readonly skillsRegistry: SkillsRegistry = new SkillsRegistry();
  private skillsDirs: string[];

  constructor(options: StimulusWithSkillsOptions = {}) {
    super(options);
    this.skillsDirs = options.skillsDirs ?? [
      join(homedir(), '.umwelten', 'skills'),
      join(process.cwd(), '.umwelten', 'skills'),
    ];
  }

  async loadSkills(): Promise<void> {
    await this.skillsRegistry.loadFromDirectories(this.skillsDirs);
  }

  override getPrompt(): string {
    const basePrompt = super.getPrompt();
    const skillsMetadata = this.skillsRegistry.getSkillsMetadataPrompt();

    if (!skillsMetadata) return basePrompt;

    return `${basePrompt}\n\n${skillsMetadata}`;
  }

  /**
   * Activate a skill and inject its instructions into context
   */
  activateSkill(name: string, args?: string): boolean {
    const instructions = this.skillsRegistry.activateSkill(name, args);
    if (!instructions) return false;

    // Add skill instructions to system context
    const existingContext = this.options.systemContext ?? '';
    this.options.systemContext = existingContext
      ? `${existingContext}\n\n## Active Skill: ${name}\n\n${instructions}`
      : `## Active Skill: ${name}\n\n${instructions}`;

    return true;
  }
}
```

### Pattern 4: Skill Tool for Runtime Activation

Create a tool that allows the agent to activate skills:

```typescript
// src/stimulus/skills/skill-tool.ts
import { tool } from 'ai';
import { z } from 'zod';
import { SkillsRegistry } from './registry.js';

export function createSkillTool(registry: SkillsRegistry) {
  return tool({
    description: `Activate a skill to get specialized instructions for a task. Available skills:\n${
      registry.listSkills()
        .filter(s => !s.disableModelInvocation)
        .map(s => `- ${s.name}: ${s.description}`)
        .join('\n')
    }`,
    parameters: z.object({
      skill: z.string().describe('Name of the skill to activate'),
      arguments: z.string().optional().describe('Arguments to pass to the skill'),
    }),
    execute: async ({ skill, arguments: args }) => {
      const instructions = registry.activateSkill(skill, args);
      if (!instructions) {
        return { error: `Skill '${skill}' not found` };
      }
      return {
        skill,
        instructions,
        message: `Skill '${skill}' activated. Follow the instructions above.`
      };
    },
  });
}
```

### Pattern 5: Integration with Jeeves-style Bots

Full integration example:

```typescript
// examples/jeeves-bot/stimulus-with-skills.ts
import { StimulusWithSkills } from '../../src/stimulus/stimulus-with-skills.js';
import { createSkillTool } from '../../src/stimulus/skills/skill-tool.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// ... other imports

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createJeevesStimulus(): Promise<StimulusWithSkills> {
  const stimulus = new StimulusWithSkills({
    role: 'Jeeves',
    objective: 'Assist with tasks using available tools and skills',
    skillsDirs: [
      join(__dirname, 'skills'),              // Bot-specific skills
      join(process.cwd(), '.umwelten/skills'), // Project skills
    ],
  });

  // Load skills from directories
  await stimulus.loadSkills();

  // Add existing tools
  stimulus.addTool('read_file', createReadFileTool());
  // ... other tools

  // Add the Skill tool for runtime activation
  stimulus.addTool('skill', createSkillTool(stimulus.skillsRegistry));

  return stimulus;
}
```

## Anti-Patterns & Pitfalls

### Don't: Load All Skill Instructions at Startup

```typescript
// BAD: Wastes context window on unused skills
async function loadAllSkillsIntoPrompt(skillsDir: string): Promise<string> {
  const skills = await loadSkillsFromDirectory(skillsDir);
  return skills.map(s => s.instructions).join('\n\n'); // Could be 50k+ tokens!
}
```

**Why it's wrong:** Skills are designed for progressive disclosure. Loading all instructions upfront defeats the purpose and wastes the context window[7].

### Instead: Use Metadata for Discovery, Instructions on Activation

```typescript
// GOOD: Only descriptions in system prompt, instructions on-demand
class SkillsRegistry {
  getSkillsMetadataPrompt(): string {
    // Only ~100 tokens per skill
    return this.skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
  }

  activateSkill(name: string): string | null {
    // Full instructions only when needed
    return this.skills.get(name)?.instructions ?? null;
  }
}
```

### Don't: Ignore Skill Scope

```typescript
// BAD: Single global skills directory
const SKILLS_DIR = '/global/skills';
```

**Why it's wrong:** Skills should follow a precedence hierarchy (user > project > global) to allow customization[9].

### Instead: Support Multiple Skill Sources with Precedence

```typescript
// GOOD: Layered skill discovery
const skillsDirs = [
  join(homedir(), '.umwelten/skills'),     // User skills
  join(process.cwd(), '.umwelten/skills'), // Project skills
  '/etc/umwelten/skills',                  // Global/enterprise skills
];

// Later entries override earlier ones with same name
for (const dir of skillsDirs) {
  const skills = await loadSkillsFromDirectory(dir);
  for (const skill of skills) {
    registry.set(skill.name, skill); // Overwrites if exists
  }
}
```

### Don't: Mix Skills and Tools

```typescript
// BAD: Trying to make skills execute code
const skill = {
  name: 'deploy',
  execute: async () => { /* run deployment */ }  // Skills don't execute!
};
```

**Why it's wrong:** Skills provide instructions, not execution. They're context, not tools[8].

### Instead: Skills Define What, Tools Define How

```typescript
// GOOD: Skill provides instructions, tools execute
// SKILL.md:
// ---
// name: deploy
// allowed-tools: Bash(docker *) Bash(kubectl *)
// ---
// To deploy:
// 1. Run docker build ...
// 2. Run kubectl apply ...

// The skill tells the agent what to do
// The tools (Bash, etc.) actually execute it
```

## Why This Choice

### Decision Criteria

| Criterion | Weight | How Agent Skills Scored |
|-----------|--------|------------------------|
| Cross-platform compatibility | High | Excellent - 26+ tools support the standard[3] |
| Integration complexity | High | Low - Just markdown parsing + context injection |
| Context efficiency | High | Excellent - Progressive disclosure by design[7] |
| Existing patterns alignment | Medium | Perfect fit with Stimulus's systemContext |
| Community/ecosystem | Medium | Growing - 500+ skills available[11] |
| Learning curve | Low | Minimal - Simple YAML + markdown format |

### Key Factors

- **Standards Alignment**: Agent Skills is the emerging standard adopted by Claude Code, OpenAI Codex, Cursor, and others. Implementing it makes umwelten skills portable[3].

- **Architecture Fit**: Stimulus already has `systemContext` for injecting dynamic content and `addTool()` for tool registration. Skills slot into these existing patterns without architectural changes.

- **Progressive Disclosure**: The three-layer model (metadata → instructions → resources) aligns with how the Stimulus/Interaction model already works—core prompt at initialization, additional context added as needed.

## Alternatives Considered

### Alternative 1: Direct Tool Generation from Skills

- **What it is:** Parse SKILL.md and auto-generate Vercel AI SDK tools
- **Why not chosen:** Skills are instructions/context, not executable code. The spec explicitly separates concerns—skills tell agents what to do, tools execute actions[8].
- **Choose this instead when:**
  - Your skills are simple wrappers around specific API calls
  - You need programmatic tool execution without agent reasoning
- **Key tradeoff:** Loses the flexibility of human-readable instructions

### Alternative 2: Runtime Prompt Expansion Only

- **What it is:** Load skills only when explicitly referenced in prompts
- **Why not chosen:** Loses model-invoked activation—the agent can't discover and use skills based on context[9].
- **Choose this instead when:**
  - You only need user-invoked skills (/skill-name)
  - Context window is extremely limited
- **Key tradeoff:** Agent can't proactively use relevant skills

### Alternative 3: Custom Skill Format

- **What it is:** Define a proprietary skill format specific to umwelten
- **Why not chosen:** Agent Skills is an open standard with broad adoption. Custom formats create ecosystem friction.
- **Choose this instead when:**
  - You need features not in the Agent Skills spec
  - Skills are internal-only and won't be shared
- **Key tradeoff:** Skills aren't portable to Claude Code, Cursor, etc.

## Caveats & Limitations

- **Context Window Pressure**: Even with progressive disclosure, many skills (50+) can consume significant context just for metadata. Monitor with budget tracking similar to Claude Code's `SLASH_COMMAND_TOOL_CHAR_BUDGET`[9].

- **No Built-in Script Execution**: The Agent Skills spec allows bundled scripts, but execution depends on the runtime. You'll need to implement script runners if skills reference `scripts/*.py`[2].

- **Dynamic Context Injection (`!` backtick syntax)**: Claude Code supports `!`command\`` to run shell commands before skill content is sent. This is Claude Code-specific and would need custom implementation[10].

- **Subagent Context (`context: fork`)**: Claude Code can run skills in isolated subagents. Umwelten would need runner modifications to support this pattern[9].

- **Allowed-Tools Enforcement**: The `allowed-tools` frontmatter field requires runtime enforcement. You'd need to filter available tools when a skill is activated.

## References

[1] [Agent Skills Overview](https://agentskills.io) - Open standard homepage explaining the format and adoption

[2] [Agent Skills Specification](https://agentskills.io/specification) - Complete technical specification for SKILL.md format

[3] [Agent Skills Adoption](https://agentskills.io) - List of 26+ tools supporting the standard including Claude Code, Codex, Cursor

[4] [Umwelten Stimulus Source](src/stimulus/stimulus.ts) - Stimulus class with systemContext and tool management

[5] [Anthropic Skills Repository](https://github.com/anthropics/skills) - Official example skills from Anthropic

[6] [skills-ref Library](https://github.com/agentskills/agentskills/tree/main/skills-ref) - Reference library for validating skills

[7] [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills) - Official documentation on progressive disclosure

[8] [What Are Skills?](https://agentskills.io/what-are-skills) - Conceptual overview of skills vs tools

[9] [Extend Claude with Skills](https://code.claude.com/docs/en/skills) - Complete Claude Code skills documentation including invocation modes

[10] [Inside Claude Code Skills](https://mikhail.io/2025/10/claude-code-skills/) - Technical deep-dive on skill invocation and context injection

[11] [Claude Code Plugins Hub](https://claude-plugins.dev/) - Community registry with 500+ skills and plugins
