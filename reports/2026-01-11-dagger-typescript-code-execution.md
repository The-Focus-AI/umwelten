---
title: "Isolated Code Execution: Dagger TypeScript SDK"
date: 2026-01-11
topic: dagger-code-execution
recommendation: "@dagger.io/dagger"
version_researched: "0.19.9"
use_when:
  - Building CI/CD pipelines as code with full TypeScript type safety
  - Need cross-language function composition and reusability
  - Require persistent caching across pipeline runs
  - Want to test pipelines locally before CI execution
  - Building complex, multi-stage build workflows
avoid_when:
  - Simple one-off code execution without caching needs
  - Need sub-second container startup times
  - Operating in environments without Docker/container runtime
  - Require fine-grained execution timeouts per command
project_context:
  language: TypeScript
  relevant_dependencies:
    - tsx
    - node child_process (current Docker CLI approach)
---

## Summary

Dagger is a programmable CI/CD engine that runs pipelines in containers, created by Solomon Hykes (founder of Docker)[1]. The TypeScript SDK (`@dagger.io/dagger`) enables developers to write container orchestration logic as type-safe code rather than YAML or shell scripts. As of January 2026, Dagger has **15.3k GitHub stars**, **288 contributors**, and **841 forks**[2]. The latest release is v0.19.9 (January 7, 2026).

For your current use case—programmatically executing generated code in isolated containers across multiple languages—Dagger offers significant advantages over raw Docker CLI calls: better caching, type-safe APIs, and composable functions. However, it introduces additional complexity and has some limitations around execution timeouts that may require workarounds for your evaluation scenarios.

The primary trade-off: Dagger provides a more maintainable, cacheable, and portable solution at the cost of added abstraction and dependency on the Dagger Engine. Your current Docker CLI approach via `child_process.exec()` is simpler but lacks the sophisticated caching and cross-language interoperability Dagger provides[3].

## Philosophy & Mental Model

Dagger's core philosophy is "CI/CD as Code"—treating your build and deployment pipelines as first-class software that can be tested, versioned, and shared[4]. Key mental models:

**1. Everything is a DAG (Directed Acyclic Graph)**
Operations in Dagger form a dependency graph. When you chain methods like `.from().withExec().stdout()`, you're building a graph that Dagger evaluates lazily. Execution only happens when you await a terminal method like `.stdout()` or `.sync()`[5].

**2. Containers are Immutable Snapshots**
Each operation returns a new container state. `withExec()` doesn't modify the container—it returns a new snapshot with the command executed. This enables powerful caching: if inputs haven't changed, Dagger reuses the cached result.

**3. BuildKit Under the Hood**
Dagger uses Docker's BuildKit for container operations. Think of it as `docker build` behavior (cached, layered, reproducible) rather than `docker run` (ephemeral)[6]. This is important: Dagger excels at build-time workloads, not long-running services.

**4. Functions as the Unit of Composition**
Dagger Functions are the building blocks—they execute in sandboxed containers and can call other functions across languages (Go, Python, TypeScript interop)[7]. Your TypeScript code can call a Go function seamlessly through generated bindings.

## Setup

### Prerequisites

1. **Container Runtime**: Docker Desktop, Docker Engine, Podman, or nerdctl[8]
2. **Node.js**: v18+ recommended (Node.js 21.3 is used by Dagger runtime internally)
3. **TypeScript**: 5.0+ required

### Installation

```bash
# Install Dagger CLI
curl -fsSL https://dl.dagger.io/dagger/install.sh | BIN_DIR=$HOME/.local/bin sh

# Or via Homebrew (macOS)
brew install dagger/tap/dagger

# Verify installation
dagger version
```

### TypeScript SDK Setup

```bash
# Add to your project
pnpm add @dagger.io/dagger --save-dev

# Or with npm
npm install @dagger.io/dagger --save-dev
```

### TypeScript Configuration

Update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true
  }
}
```

Update `package.json`:

```json
{
  "type": "module"
}
```

## Core Usage Patterns

### Pattern 1: Basic Code Execution

Execute code in an isolated container and capture output—the fundamental pattern for your code evaluation use case.

```typescript
import { dag, connection } from "@dagger.io/dagger";

async function executeCode(code: string, language: string): Promise<{
  success: boolean;
  output: string;
  error?: string;
}> {
  return await connection(async () => {
    const languageConfig = LANGUAGE_CONFIGS[language];

    const result = await dag
      .container()
      .from(languageConfig.image)
      .withNewFile(`/app/code.${languageConfig.extension}`, code)
      .withWorkdir("/app")
      .withExec(languageConfig.runCommand)
      .stdout();

    return { success: true, output: result };
  }, { LogOutput: process.stderr });
}

const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  typescript: {
    image: "node:20-alpine",
    extension: "ts",
    runCommand: ["npx", "tsx", "code.ts"]
  },
  python: {
    image: "python:3.11-alpine",
    extension: "py",
    runCommand: ["python", "code.py"]
  },
  // ... additional languages
};
```

### Pattern 2: Multi-Language Execution Matrix

Run the same code pattern across multiple runtime environments—useful for compatibility testing.

```typescript
import { dag, connection } from "@dagger.io/dagger";

async function runAcrossVersions(code: string) {
  return await connection(async () => {
    const nodeVersions = ["18", "20", "22"];
    const results: Map<string, string> = new Map();

    // Dagger parallelizes these automatically
    await Promise.all(nodeVersions.map(async (version) => {
      const output = await dag
        .container()
        .from(`node:${version}-alpine`)
        .withNewFile("/app/code.ts", code)
        .withWorkdir("/app")
        .withExec(["npm", "install", "-g", "tsx"])
        .withExec(["tsx", "/app/code.ts"])
        .stdout();

      results.set(version, output);
    }));

    return results;
  });
}
```

### Pattern 3: Capturing Both stdout and stderr

Your evaluation system needs to capture both success output and error messages.

```typescript
import { dag, connection, Container } from "@dagger.io/dagger";

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function executeWithFullCapture(
  code: string,
  image: string,
  runCmd: string[]
): Promise<ExecutionResult> {
  return await connection(async () => {
    const container = dag
      .container()
      .from(image)
      .withNewFile("/app/code.ts", code)
      .withWorkdir("/app")
      .withExec(runCmd, {
        redirectStdout: "/tmp/stdout.txt",
        redirectStderr: "/tmp/stderr.txt"
      });

    // Force execution and capture files
    const stdout = await container.file("/tmp/stdout.txt").contents();
    const stderr = await container.file("/tmp/stderr.txt").contents();

    return {
      stdout,
      stderr,
      exitCode: 0 // Success if we get here
    };
  });
}
```

### Pattern 4: Directory Mounting for Complex Projects

When evaluating code that needs dependencies or multiple files.

```typescript
import { dag, connection } from "@dagger.io/dagger";

async function executeProject(projectDir: string): Promise<string> {
  return await connection(async () => {
    const source = dag.host().directory(projectDir, {
      exclude: ["node_modules/", ".git/", "dist/"]
    });

    const output = await dag
      .container()
      .from("node:20-alpine")
      .withDirectory("/app", source)
      .withWorkdir("/app")
      .withExec(["npm", "install"])
      .withExec(["npm", "run", "build"])
      .withExec(["node", "dist/index.js"])
      .stdout();

    return output;
  });
}
```

### Pattern 5: Caching Dependencies

Leverage Dagger's cache volumes for faster repeated executions.

```typescript
import { dag, connection, CacheVolume } from "@dagger.io/dagger";

async function executeWithCaching(code: string): Promise<string> {
  return await connection(async () => {
    // Create named cache volumes
    const npmCache = dag.cacheVolume("npm-cache");
    const pnpmStore = dag.cacheVolume("pnpm-store");

    const output = await dag
      .container()
      .from("node:20-alpine")
      .withMountedCache("/root/.npm", npmCache)
      .withMountedCache("/root/.pnpm-store", pnpmStore)
      .withNewFile("/app/code.ts", code)
      .withWorkdir("/app")
      .withExec(["npm", "install", "-g", "tsx"])
      .withExec(["tsx", "/app/code.ts"])
      .stdout();

    return output;
  });
}
```

## Anti-Patterns & Pitfalls

### Don't: Expect Fine-Grained Execution Timeouts

```typescript
// BAD: No per-command timeout in withExec
const output = await dag
  .container()
  .from("alpine")
  .withExec(["sleep", "3600"], { timeout: 30000 }) // ❌ timeout not a valid option
  .stdout();
```

**Why it's wrong:** Dagger's `withExec` doesn't support per-command timeouts[9]. Timeouts are configured at the connection level, not execution level. This differs from your current approach where you wrap commands with a timeout script.

### Instead: Implement Timeout in the Command

```typescript
// GOOD: Use shell timeout or custom wrapper
const output = await dag
  .container()
  .from("alpine")
  .withExec(["sh", "-c", "timeout 30 your-command || exit 124"])
  .stdout();
```

Or handle at the connection level:

```typescript
// Configure connection-level timeout
await connection(async () => {
  // ... operations
}, {
  LogOutput: process.stderr,
  // Note: TypeScript SDK timeout config is less documented than Python SDK
});
```

### Don't: Treat Dagger Like `docker run`

```typescript
// BAD: Expecting immediate, imperative execution
const container = dag.container().from("alpine");
container.withExec(["echo", "hello"]); // This does nothing!
const output = await container.stdout(); // Error: no command executed
```

**Why it's wrong:** Dagger is lazy and immutable. `withExec()` returns a new container; it doesn't modify the existing one[10].

### Instead: Chain Operations

```typescript
// GOOD: Method chaining builds the DAG
const output = await dag
  .container()
  .from("alpine")
  .withExec(["echo", "hello"])
  .stdout(); // Terminal method triggers execution
```

### Don't: Ignore the Sandboxing Model

```typescript
// BAD: Expecting host filesystem access by default
const files = await dag
  .container()
  .from("alpine")
  .withExec(["ls", "/home/myuser"]) // ❌ Host path not mounted
  .stdout();
```

**Why it's wrong:** Dagger containers are sandboxed. They don't have access to host files unless explicitly mounted[7].

### Instead: Explicitly Mount Host Directories

```typescript
// GOOD: Explicit host directory mounting
const source = dag.host().directory("/home/myuser/project");
const output = await dag
  .container()
  .from("alpine")
  .withDirectory("/project", source)
  .withExec(["ls", "/project"])
  .stdout();
```

### Don't: Create New Connections for Every Execution

```typescript
// BAD: Connection overhead on every call
async function runCode(code: string) {
  return await connection(async () => { // New connection each time!
    return await dag.container().from("alpine").withExec(["echo", code]).stdout();
  });
}

// Running 100 evaluations = 100 connection setups
for (const code of codes) {
  await runCode(code);
}
```

**Why it's wrong:** Connection setup has overhead. The Dagger Engine starts/connects each time.

### Instead: Batch Operations Within a Single Connection

```typescript
// GOOD: Single connection for batch operations
async function runBatch(codes: string[]) {
  return await connection(async () => {
    return await Promise.all(codes.map(code =>
      dag.container()
        .from("alpine")
        .withExec(["sh", "-c", `echo '${code}'`])
        .stdout()
    ));
  });
}
```

## Why This Choice

### Decision Criteria

| Criterion | Weight | How Dagger Scored |
|-----------|--------|-------------------|
| Type Safety | High | Excellent - Full TypeScript support with generated types |
| Caching | High | Excellent - Automatic, fine-grained caching via BuildKit |
| Multi-Language Support | High | Good - Same container images as Docker, multi-runtime |
| Timeout Control | High | Fair - Connection-level only, not per-command |
| Startup Overhead | Medium | Fair - Engine startup adds latency (~2-5s cold start) |
| Learning Curve | Medium | Moderate - New mental model required |
| Ecosystem/Community | Medium | Growing - 15.3k stars, active development |
| Documentation | Medium | Good - Improving, some gaps in TypeScript specifics |

### Key Factors

- **Caching is Transformative:** For your evaluation system running thousands of code samples, Dagger's automatic caching of unchanged operations could dramatically reduce execution time. Base images, installed dependencies, and even identical code executions are cached.

- **Type Safety Matters:** Your current `docker-runner.ts` uses string-based CLI commands. Dagger's typed API catches errors at compile time—invalid images, malformed commands, etc.

- **Portability:** Dagger pipelines run identically locally and in CI. Your evaluation system could run the same code in GitHub Actions, locally for debugging, or in a dedicated evaluation server.

- **Cross-Language Composition:** Future extensions could leverage Dagger modules written in Go (for performance) or Python (for ML tooling) called from your TypeScript code.

## Alternatives Considered

### Alternative 1: Direct Docker SDK (dockerode)

- **What it is:** Node.js Docker API client library
- **Why not chosen:** Lower-level API, no built-in caching, requires managing container lifecycle manually
- **Choose this instead when:**
  - Need direct Docker API access for advanced container management
  - Building Docker tooling, not CI/CD pipelines
  - Want minimal dependencies
- **Key tradeoff:** More control vs. more boilerplate; no automatic caching

### Alternative 2: Current Approach (Docker CLI via child_process)

- **What it is:** Your existing `docker-runner.ts` implementation
- **Why not chosen:** No caching between runs, string-based (error-prone), requires manual Dockerfile generation
- **Choose this instead when:**
  - Simplicity is paramount
  - One-off executions where caching doesn't help
  - Team unfamiliar with Dagger concepts
- **Key tradeoff:** Zero learning curve vs. repeated work on every execution

### Alternative 3: Earthly

- **What it is:** Build tool using Earthfiles (Makefile + Dockerfile hybrid syntax)[11]
- **Why not chosen:** Earthly is concluding their CI business; Dagger is actively onboarding Earthly users
- **Choose this instead when:**
  - Team prefers declarative syntax over SDK approach
  - Existing Earthfile infrastructure
- **Key tradeoff:** More accessible syntax vs. less programmatic flexibility

### Alternative 4: Modal Sandboxes

- **What it is:** Cloud-native sandboxed code execution service[12]
- **Why not chosen:** Requires cloud dependency, not self-hosted, usage-based pricing
- **Choose this instead when:**
  - Don't want to manage infrastructure
  - Need sub-200ms cold starts
  - Building production AI agent infrastructure
- **Key tradeoff:** Managed simplicity vs. cloud dependency and cost

## Caveats & Limitations

- **Requires Container Runtime:** Dagger needs Docker (or Podman/nerdctl) running. Unlike your current approach, it also needs the Dagger Engine (auto-provisioned but adds startup time)[8].

- **Cold Start Overhead:** First execution in a session has 2-5 second overhead for Dagger Engine startup. Subsequent operations are fast. For your use case of batch evaluations, this amortizes well; for interactive single-code testing, it's noticeable.

- **Timeout Limitations:** No per-`withExec` timeout. You'd need to maintain your current shell-script timeout wrapper approach or use connection-level timeouts[9]. This is a significant limitation for your evaluation scenarios where individual code executions may hang.

- **Debug Logging:** TypeScript SDK has limited debug logging compared to Python SDK. Troubleshooting can be harder[13].

- **Scaling Questions:** The Dagger team hasn't conclusively determined optimal scaling strategies (horizontal vs. vertical)[14]. For high-volume evaluation workloads, you may need to experiment.

- **Learning Curve:** The lazy evaluation model and immutable container snapshots require a mental shift from imperative Docker CLI usage. Team onboarding takes time.

## Migration Path from Current Implementation

If you decide to adopt Dagger, here's a suggested incremental approach:

1. **Start with a single language:** Port TypeScript execution first, validate caching benefits
2. **Maintain parallel implementations:** Keep `docker-runner.ts` as fallback
3. **Benchmark thoroughly:** Compare execution times, especially for batch operations
4. **Implement timeout wrapper:** Since Dagger lacks per-command timeouts, port your `timeout.sh` approach

```typescript
// Example migration: TypeScript execution
// Current approach in docker-runner.ts
const result = await exec(`docker run --rm ${imageName}`);

// Dagger equivalent
const result = await connection(async () => {
  return await dag
    .container()
    .from("node:20-alpine")
    .withNewFile("/app/code.ts", code)
    .withExec(["sh", "-c", "timeout 30 npx tsx /app/code.ts || exit 124"])
    .stdout();
});
```

## References

[1] [From Docker to Dagger - dbt Labs](https://www.getdbt.com/blog/from-docker-to-dagger) - Background on Solomon Hykes creating Dagger after Docker

[2] [GitHub - dagger/dagger](https://github.com/dagger/dagger) - Repository metrics: 15.3k stars, 288 contributors, 841 forks

[3] [Introducing the Dagger Node.js SDK](https://dagger.io/blog/nodejs-sdk) - Official announcement and SDK philosophy

[4] [Dagger Overview](https://docs.dagger.io/) - Core documentation and "CI/CD as code" philosophy

[5] [Container - TypeScript SDK Reference](https://docs.dagger.io/reference/typescript/api/client.gen/classes/container/) - Container class API documentation

[6] [Clarify that Dagger behaves more like docker build - GitHub Issue #9292](https://github.com/dagger/dagger/issues/9292) - Explanation of BuildKit-based execution model

[7] [Using Dagger SDKs](https://docs.dagger.io/api/sdk/) - Sandboxing and security model explanation

[8] [Dagger Installation](https://docs.dagger.io/install/) - Installation requirements and prerequisites

[9] [Command Execution in Containers](https://docs.dagger.io/manuals/user/exec/) - withExec options (timeout at connection level only)

[10] [Lazy executions - GitHub Issue #4668](https://github.com/dagger/dagger/issues/4668) - Discussion of lazy evaluation behavior

[11] [A Soft Landing for Earthly Users](https://dagger.io/blog/earthly-to-dagger-migration) - Earthly migration and comparison

[12] [Run arbitrary code in a sandboxed environment - Modal Docs](https://modal.com/docs/examples/safe_code_execution) - Alternative approach for sandboxed execution

[13] [Troubleshooting - Dagger Docs](https://docs.dagger.io/reference/troubleshooting/) - Debug logging limitations

[14] [How to scale Dagger in production? - GitHub Issue #6486](https://github.com/dagger/dagger/issues/6486) - Scaling discussion and open questions

[15] [TypeScript Custom Application](https://docs.dagger.io/extending/custom-applications/typescript/) - Full TypeScript setup guide

[16] [We Bundled and Saved 50% on Cold Starts](https://dagger.io/blog/typescript-sdk-performance) - TypeScript SDK performance improvements

[17] [Container Images Cookbook](https://docs.dagger.io/cookbook/containers/) - Practical code examples
