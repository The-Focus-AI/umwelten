# Architecture Overview

## High-Level Architecture

The umwelten project implements a **stimulus-centric evaluation system** that focuses on creating reusable infrastructure for testing AI models. The architecture is built around the concept of "Umwelt" - the perceptual world that models operate within.

## Core Philosophy

### Infrastructure-First Approach
- **Reusable Infrastructure**: Generic evaluation strategies, stimulus templates, and tool integrations
- **Composable Components**: Simple building blocks that can be combined for complex evaluations
- **Clear Separation**: Infrastructure vs. specific test implementations

### Stimulus-Centric Design
- **Stimulus as Primary Unit**: All cognitive testing revolves around `Stimulus` objects
- **Template System**: Generic, reusable stimulus definitions for common tasks
- **Tool Integration**: Seamless integration of external tools (PDF, Audio, Image)

## Key Components

### 1. Evaluation Framework (`src/evaluation/`)
- **SimpleEvaluation**: Basic single-model evaluation
- **MatrixEvaluation**: Multi-model comparison
- **BatchEvaluation**: Batch processing of multiple inputs
- **ComplexPipeline**: Advanced multi-step evaluations

### 2. Stimulus System (`src/stimulus/`)
- **Base Stimulus**: Core stimulus class with role, objective, instructions
- **Templates**: Generic stimulus definitions for common tasks
- **Tools**: Integration with external tools and resources
- **Categories**: Organized by cognitive task type (creative, coding, analysis)

### 3. Caching Infrastructure (`src/evaluation/caching/`)
- **Model Response Caching**: Avoid re-running expensive model calls
- **File Caching**: Cache processed files and metadata
- **Score Caching**: Cache evaluation scores and results

### 4. Provider Integration (`src/providers/`)
- **Unified Interface**: Consistent API across all AI providers
- **Vercel AI SDK**: Standardized model interactions
- **Cost Tracking**: Transparent cost calculation and monitoring

## Directory Structure

```
src/
├── evaluation/           # Evaluation strategies and infrastructure
│   ├── strategies/       # Evaluation strategy implementations
│   ├── caching/         # Caching infrastructure
│   └── analysis/        # Result analysis and reporting
├── stimulus/            # Stimulus system
│   ├── templates/       # Generic stimulus templates
│   ├── tools/          # Tool integrations
│   ├── creative/       # Creative writing stimuli
│   ├── coding/         # Code generation stimuli
│   └── analysis/       # Analysis task stimuli
├── providers/           # AI provider integrations
├── cognition/          # Model interfaces and runners
├── interaction/        # Model-environment interactions
├── habitat/           # Habitat system (agents, tools, sessions, sub-agents)
└── memory/            # Memory and knowledge storage

scripts/                # Exploratory test implementations
├── creative/          # Creative writing tests
├── coding/           # Code generation tests
├── analysis/         # Analysis task tests
├── complex/          # Complex evaluation compositions
├── tools/            # Tool integration tests
└── examples/         # Example implementations
```

## Design Principles

### 1. **Simplicity Over Complexity**
- Start with minimal implementations
- Add complexity only when necessary
- Prefer composition over inheritance

### 2. **Reusability**
- Generic templates for common tasks
- Composable evaluation strategies
- Shared tool integrations

### 3. **Extensibility**
- Clear patterns for adding new capabilities
- Plugin architecture for tools and providers
- Easy integration of new evaluation types

### 4. **Maintainability**
- Clear separation of concerns
- Well-documented interfaces
- Comprehensive test coverage

## Benefits

### For Developers
- **Easy to Use**: Simple patterns for common tasks
- **Highly Reusable**: Generic components work across different tests
- **Well Documented**: Clear examples and API references
- **Extensible**: Easy to add new capabilities

### For Researchers
- **Consistent Results**: Standardized evaluation approaches
- **Cost Effective**: Caching reduces redundant model calls
- **Comprehensive**: Wide range of evaluation strategies
- **Reproducible**: Clear patterns ensure consistent results

### For Organizations
- **Scalable**: Infrastructure handles complex evaluation needs
- **Maintainable**: Clear architecture reduces maintenance burden
- **Cost Transparent**: Built-in cost tracking and monitoring
- **Future Proof**: Extensible design accommodates new requirements

## Next Steps

1. **Run Examples**: Try the example scripts to see the framework in action
   ```bash
   # Simple evaluation
   pnpm tsx scripts/examples/simple-evaluation-example.ts
   
   # Matrix evaluation (compare models)
   pnpm tsx scripts/examples/matrix-evaluation-example.ts
   
   # Batch evaluation (process multiple inputs)
   pnpm tsx scripts/examples/batch-evaluation-example.ts
   
   # Complex pipeline (multi-step workflows)
   pnpm tsx scripts/examples/complex-pipeline-example.ts
   
   # Comprehensive analysis
   pnpm tsx scripts/examples/comprehensive-analysis-example.ts
   ```

2. **Use CLI**: Try the command-line interface
   ```bash
   # List models
   pnpm cli models
   
   # Run simple evaluation
   pnpm cli run "Hello, world!" --model gpt-4
   
   # Interactive chat
   pnpm cli chat --memory
   ```

3. **Create Your First Evaluation**: Follow the getting started guide
4. **Customize Templates**: Modify existing templates for your needs
5. **Add New Tools**: Integrate external tools using the tool framework
6. **Build Complex Evaluations**: Compose simple strategies into complex pipelines

## Related Documentation

- [Evaluation Framework](evaluation-framework.md)
- [Stimulus System](stimulus-system.md)
- [Caching System](caching-system.md)
- [Getting Started Guide](../guide/getting-started.md)
- [API Reference](../api/README.md)
