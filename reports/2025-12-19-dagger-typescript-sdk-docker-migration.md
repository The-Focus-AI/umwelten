---
title: "Container Execution: Dagger TypeScript SDK"
date: 2025-12-19
topic: dagger-typescript-docker
recommendation: Dagger TypeScript SDK
version_researched: 0.19.8
use_when:
  - Building CI/CD pipelines that need local debugging
  - Requiring cross-language module composition
  - Needing intelligent caching for repeated container operations
  - Managing complex multi-container workflows
avoid_when:
  - Simple one-off container executions with minimal setup
  - Requiring hard execution timeouts (Dagger lacks native timeout support)
  - Cold start latency is critical (20-30s overhead on first run)
  - Already have working Docker automation that just needs minor tweaks
project_context:
  language: TypeScript
  relevant_dependencies:
    - child_process (exec for Docker CLI)
    - fs (temporary file management)
---

## Summary

Dagger is an open-source runtime for composable workflows, created by Docker co-founder Solomon Hykes, that provides programmatic container management through type-safe SDKs in TypeScript, Python, and Go [1]. With **15.2k GitHub stars**, **833 forks**, and **284+ contributors**, it represents a mature alternative to shell-based Docker automation [2].

Your current `DockerRunner` implementation manually generates Dockerfiles, builds images via CLI, and handles cleanup—a pattern that Dagger can significantly improve through its fluent API, automatic caching, and cross-platform compatibility. However, Dagger introduces cold-start overhead (20-30s on first run) and lacks native execution timeouts, requiring shell-level timeout commands [3].

The TypeScript SDK (`@dagger.io/dagger@0.19.2`) provides the same primitives as your current code—container creation, file mounting, command execution—but with better caching, observability, and error handling. For your code execution use case specifically, Dagger's `container-use` project offers purpose-built sandboxing for AI agents [4].

## Philosophy & Mental Model

Dagger treats **containers as programmable objects** rather than CLI commands. The core mental model:

1. **Everything is immutable**: Each operation (`.from()`, `.withExec()`, `.withFile()`) returns a new container snapshot, not a mutation
2. **Lazy evaluation**: Pipelines are built as a DAG (Directed Acyclic Graph) and only executed when you call `.sync()`, `.stdout()`, or similar terminal methods
3. **Function chaining**: Operations compose fluently, similar to builder patterns in TypeScript [5]
4. **Content-addressable caching**: Every step produces cached artifacts keyed by content, not time—identical operations are automatically deduplicated [6]

```typescript
// Dagger mental model: declarative pipeline definition
const result = await dag
  .container()
  .from("python:3.11-alpine")     // Snapshot 1: base image
  .withNewFile("/app/code.py", code)  // Snapshot 2: add file
  .withExec(["python", "/app/code.py"]) // Snapshot 3: run code
  .stdout();                       // Terminal: execute and get output
```

Compare to your current imperative approach:
```typescript
// Current model: imperative Docker CLI calls
await execAsync(`docker build -t ${containerName} .`);
await execAsync(`docker run --rm ${containerName}`);
await execAsync(`docker rmi ${containerName}`);
```

## Setup

### Installation

```bash
# Install Dagger CLI (required for SDK)
curl -fsSL https://dl.dagger.io/dagger/install.sh | sh

# Or via Homebrew
brew install dagger/tap/dagger

# Install TypeScript SDK
pnpm add @dagger.io/dagger --save-dev
```

### Configuration

Update `tsconfig.json` for ESM compatibility:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022"
  }
}
```

Update `package.json`:

```json
{
  "type": "module"
}
```

### Basic Connection Pattern

```typescript
import { dag, connection } from "@dagger.io/dagger";

// Wrap all Dagger operations in connection()
await connection(
  async () => {
    const output = await dag
      .container()
      .from("alpine")
      .withExec(["echo", "Hello Dagger"])
      .stdout();
    console.log(output);
  },
  { LogOutput: process.stderr }
);
```

## Core Usage Patterns

### Pattern 1: Code Execution (Replacing DockerRunner)

This pattern directly replaces your `DockerRunner.runCode()` method:

```typescript
import { dag, connection } from "@dagger.io/dagger";

interface LanguageConfig {
  extension: string;
  baseImage: string;
  runCommand: string[];
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  typescript: {
    extension: ".ts",
    baseImage: "node:20-alpine",
    runCommand: ["npx", "tsx", "/app/code.ts"],
  },
  python: {
    extension: ".py",
    baseImage: "python:3.11-alpine",
    runCommand: ["python", "/app/code.py"],
  },
  // ... other languages
};

async function runCode(code: string, language: string): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  const config = LANGUAGE_CONFIGS[language];
  if (!config) {
    return { success: false, error: `Unsupported language: ${language}` };
  }

  try {
    let output: string = "";

    await connection(async () => {
      output = await dag
        .container()
        .from(config.baseImage)
        .withNewFile(`/app/code${config.extension}`, code)
        .withWorkdir("/app")
        .withExec(config.runCommand)
        .stdout();
    });

    return { success: true, output };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

### Pattern 2: Timeout Handling via Shell

Dagger lacks native timeout support. Use shell-level timeouts [7]:

```typescript
async function runCodeWithTimeout(
  code: string,
  language: string,
  timeoutSeconds: number = 30
): Promise<{ success: boolean; output?: string; error?: string }> {
  const config = LANGUAGE_CONFIGS[language];

  try {
    let output: string = "";

    await connection(async () => {
      // Wrap command in timeout
      const timeoutCommand = [
        "sh", "-c",
        `timeout ${timeoutSeconds} ${config.runCommand.join(" ")} 2>&1 || ` +
        `([ $? -eq 124 ] && echo "Execution timed out after ${timeoutSeconds}s" >&2 && exit 124)`
      ];

      output = await dag
        .container()
        .from(config.baseImage)
        .withNewFile(`/app/code${config.extension}`, code)
        .withWorkdir("/app")
        .withExec(["apk", "add", "--no-cache", "coreutils"]) // For timeout command
        .withExec(timeoutCommand)
        .stdout();
    });

    return { success: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("124") || message.includes("timed out")) {
      return { success: false, error: `Execution timed out after ${timeoutSeconds}s` };
    }
    return { success: false, error: message };
  }
}
```

### Pattern 3: Caching Dependencies

Leverage Dagger's cache volumes for package managers [8]:

```typescript
async function runTypeScriptWithDeps(
  code: string,
  packageJson: string
): Promise<string> {
  let output = "";

  await connection(async () => {
    const npmCache = dag.cacheVolume("npm-cache");

    output = await dag
      .container()
      .from("node:20-alpine")
      .withMountedCache("/root/.npm", npmCache)
      .withNewFile("/app/package.json", packageJson)
      .withNewFile("/app/code.ts", code)
      .withWorkdir("/app")
      .withExec(["npm", "install"])
      .withExec(["npx", "tsx", "code.ts"])
      .stdout();
  });

  return output;
}
```

### Pattern 4: Multi-Language Matrix Execution

Test code across multiple language versions:

```typescript
async function runAcrossVersions(
  code: string,
  versions: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  await connection(async () => {
    // Execute in parallel using Promise.all
    const executions = versions.map(async (version) => {
      const output = await dag
        .container()
        .from(`python:${version}-alpine`)
        .withNewFile("/app/code.py", code)
        .withExec(["python", "/app/code.py"])
        .stdout();
      return { version, output };
    });

    const outputs = await Promise.all(executions);
    outputs.forEach(({ version, output }) => results.set(version, output));
  });

  return results;
}
```

### Pattern 5: Capturing Exit Codes and Stderr

Handle both stdout and stderr with exit code checking:

```typescript
interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runWithFullOutput(
  code: string,
  language: string
): Promise<ExecutionResult> {
  const config = LANGUAGE_CONFIGS[language];

  let result: ExecutionResult = { stdout: "", stderr: "", exitCode: 0 };

  await connection(async () => {
    const container = dag
      .container()
      .from(config.baseImage)
      .withNewFile(`/app/code${config.extension}`, code)
      .withWorkdir("/app")
      .withExec(config.runCommand);

    // Capture all outputs
    result.stdout = await container.stdout();
    result.stderr = await container.stderr();
    result.exitCode = await container.exitCode();
  });

  return result;
}
```

## Anti-Patterns & Pitfalls

### Don't: Forget to Wrap in connection()

```typescript
// BAD: dag is undefined outside connection()
const output = await dag.container().from("alpine").stdout();
```

**Why it's wrong:** The `dag` global client only works within a `connection()` context.

### Instead: Always Use connection()

```typescript
// GOOD: Properly scoped connection
await connection(async () => {
  const output = await dag.container().from("alpine").stdout();
  console.log(output);
});
```

---

### Don't: Expect Automatic Timeout

```typescript
// BAD: No timeout - infinite loop will hang forever
await dag
  .container()
  .from("python:3.11")
  .withNewFile("/app/code.py", "while True: pass")
  .withExec(["python", "/app/code.py"])
  .stdout();
```

**Why it's wrong:** Dagger has no native `withExec` timeout parameter [7].

### Instead: Use Shell Timeout

```typescript
// GOOD: Explicit timeout via shell
await dag
  .container()
  .from("python:3.11")
  .withNewFile("/app/code.py", "while True: pass")
  .withExec(["timeout", "30", "python", "/app/code.py"])
  .stdout();
```

---

### Don't: Shell Commands as Array Elements

```typescript
// BAD: This won't work - shell syntax in exec array
await dag.container().withExec(["ls -la | grep foo"]).stdout();
```

**Why it's wrong:** `withExec` uses `exec()` semantics, not shell parsing [9].

### Instead: Explicitly Invoke Shell

```typescript
// GOOD: Use sh -c for shell commands
await dag.container().withExec(["sh", "-c", "ls -la | grep foo"]).stdout();
```

---

### Don't: Ignore Cold Start Overhead

```typescript
// BAD: Using Dagger for single quick operations
async function quickCheck() {
  await connection(async () => {
    return dag.container().from("alpine").withExec(["echo", "hi"]).stdout();
  });
}
// This takes 20-30s on first run even for a simple echo!
```

**Why it's wrong:** Dagger has significant cold-start overhead for TypeScript SDK (20-30s) [3].

### Instead: Batch Operations

```typescript
// GOOD: Batch multiple operations in one connection
await connection(async () => {
  const results = await Promise.all([
    dag.container().from("python:3.11").withExec(["python", "-V"]).stdout(),
    dag.container().from("node:20").withExec(["node", "-v"]).stdout(),
    dag.container().from("ruby:3.2").withExec(["ruby", "-v"]).stdout(),
  ]);
  return results;
});
```

## Why This Choice

### Decision Criteria

| Criterion | Weight | How Dagger Scored |
|-----------|--------|-------------------|
| TypeScript-native API | High | Excellent - fluent, type-safe SDK |
| Caching | High | Excellent - content-addressable, automatic |
| Cleanup automation | High | Excellent - no manual image/container cleanup |
| Timeout support | High | Poor - requires shell-level workarounds |
| Cold start time | Medium | Poor - 20-30s overhead on first run |
| Local debugging | Medium | Excellent - full tracing and terminal access |
| Community/support | Medium | Good - 15.2k stars, active development |

### Key Factors

- **Eliminates manual cleanup**: Your current code has `finally` blocks for cleaning up temp dirs and Docker images. Dagger handles this automatically.
- **Content-addressable caching**: Repeated executions with same code skip build steps entirely.
- **Cross-platform consistency**: Same pipeline runs identically on dev machines and CI.
- **Better error messages**: Dagger 0.15+ provides rich error context with traces [10].

## Alternatives Considered

### Keep Current Docker CLI Approach

- **What it is:** Your existing `DockerRunner` using `child_process.exec()`
- **Why not chosen:** Manual cleanup, no caching, imperative error handling
- **Choose this instead when:**
  - Minimal dependencies are critical
  - Cold start time is paramount (your approach starts faster)
  - You need precise timeout control
- **Key tradeoff:** Full control vs. convenience and caching

### E2B.dev

- **What it is:** Firecracker microVM-based code sandbox service
- **Why not chosen:** External dependency, 24-hour session limit, paid service
- **Choose this instead when:**
  - Stronger isolation needed (microVM vs container)
  - Running untrusted code from external users
  - Sub-200ms cold starts required [11]
- **Key tradeoff:** Stronger security vs. self-hosted simplicity

### Modal Sandboxes

- **What it is:** Serverless container fabric with gVisor isolation
- **Why not chosen:** Python-focused, hosted service, different mental model
- **Choose this instead when:**
  - Python-heavy workloads
  - Need autoscaling from 0 to 10,000+ concurrent executions
  - Stateless function-based execution model fits [12]
- **Key tradeoff:** Serverless scale vs. local development experience

### Dagger container-use

- **What it is:** Dagger's purpose-built sandbox for AI coding agents [4]
- **Why not chosen:** Focused on agent development environments, not ephemeral execution
- **Choose this instead when:**
  - Running AI coding agents (Claude Code, Cursor)
  - Need persistent environments with Git worktrees
  - Require real-time visibility into agent actions
- **Key tradeoff:** Agent-focused features vs. general code execution

## Caveats & Limitations

- **Cold start latency**: First run takes 20-30 seconds for TypeScript SDK initialization. Subsequent runs with warm cache are much faster, but this matters for user-facing latency [3].

- **No native timeouts**: Unlike `docker run --timeout`, Dagger's `withExec` has no timeout parameter. You must implement timeouts via shell commands (`timeout`) or application-level Promise racing.

- **Requires Dagger Engine**: The SDK communicates with the Dagger Engine (containerized daemon). This adds a runtime dependency beyond just Docker.

- **ESM-only**: The TypeScript SDK requires ES modules. If your project uses CommonJS, you'll need configuration changes.

- **Not 100% backward compatible**: Dagger's "Compat Mode" doesn't guarantee full backward compatibility between versions [13].

- **Build vs Run semantics**: Dagger behaves more like `docker build` than `docker run`. Each `withExec` creates a new image layer, not a runtime process [14].

## Migration Path from DockerRunner

1. **Install dependencies**: Add `@dagger.io/dagger` and ensure Dagger CLI is available
2. **Refactor language configs**: Change `runCommand` from string to array format
3. **Replace `runCode` method**: Use the Pattern 1 example above
4. **Add timeout wrapper**: Implement shell-based timeout as shown in Pattern 2
5. **Remove cleanup code**: Delete the `finally` blocks and `cleanupTempDirectories()`
6. **Add caching**: Use `cacheVolume` for language-specific package caches

## References

[1] [Dagger Overview](https://docs.dagger.io/) - Official documentation home page

[2] [dagger/dagger GitHub](https://github.com/dagger/dagger) - Main repository with 15.2k stars, v0.19.8 released Dec 2025

[3] [TypeScript SDK Performance](https://dagger.io/blog/typescript-sdk-performance) - Cold start optimization details, 50% improvement via bundling

[4] [Dagger container-use](https://github.com/dagger/container-use) - AI agent sandbox with Git worktree isolation

[5] [TypeScript SDK Reference - Container](https://docs.dagger.io/reference/typescript/classes/api_client_gen.container/) - Complete Container class API

[6] [Key Concepts](https://docs.dagger.io/getting-started/concepts/) - Caching and DAG execution model

[7] [GitHub Issue #4921](https://github.com/dagger/dagger/issues/4921) - Discussion on stdout/stderr patterns, no native timeout

[8] [Container Images Cookbook](https://docs.dagger.io/cookbook/containers/) - Cache volume patterns

[9] [TypeScript Custom Application](https://docs.dagger.io/extending/custom-applications/typescript/) - Setup and withExec usage

[10] [Dagger 0.15 Release](https://dagger.io/blog/dagger-0-15) - Better error messages and tracing

[11] [E2B Alternatives Analysis](https://northflank.com/blog/best-alternatives-to-e2b-dev-for-running-untrusted-code-in-secure-sandboxes) - Sandbox comparison

[12] [Modal Sandboxes](https://modal.com/blog/top-code-agent-sandbox-products) - Code sandbox comparison

[13] [How to Scale Dagger - Issue #6486](https://github.com/dagger/dagger/issues/6486) - Production scaling discussion

[14] [Dagger Build vs Run - Issue #9292](https://github.com/dagger/dagger/issues/9292) - Clarification on execution model
