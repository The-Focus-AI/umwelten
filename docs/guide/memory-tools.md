# Memory & Tools

Learn how to use Umwelten's memory system and tool integration to create more intelligent and context-aware AI interactions. Memory enables persistent conversations, while tools extend model capabilities with external functions.

## Overview

Umwelten's memory and tools system provides:

- **Persistent Memory**: Maintain context across conversations and sessions
- **Tool Integration**: Extend models with external functions and APIs
- **Context Awareness**: Build intelligent conversations that remember past interactions
- **Enhanced Capabilities**: Add mathematical, data processing, and custom functions

## Memory System

### Basic Memory Usage

Enable memory for persistent conversations:

```bash
# Chat with memory enabled
umwelten chat --provider ollama --model gemma3:12b --memory

# Run commands with memory
umwelten run --provider google --model gemini-2.0-flash --memory "Remember that I prefer concise explanations"
```

### Memory Types

Umwelten supports different types of memory:

#### Conversation Memory
```bash
# Maintain conversation context
umwelten chat --provider ollama --model gemma3:12b --memory

# The model will remember:
# - Previous messages in the conversation
# - User preferences and context
# - Important facts mentioned
```

#### Session Memory
```bash
# Memory persists across multiple commands
umwelten run --provider google --model gemini-2.0-flash --memory "My name is Alice"
umwelten run --provider google --model gemini-2.0-flash --memory "What's my name?"  # Remembers "Alice"
```

#### Fact Memory
```bash
# Store and retrieve specific facts
umwelten run --provider ollama --model gemma3:12b --memory "Store: I work as a software engineer"
umwelten run --provider ollama --model gemma3:12b --memory "What do I do for work?"  # Retrieves "software engineer"
```

### Memory Management

#### View Memory Contents
```bash
# List stored memories
umwelten memory list

# Search memories
umwelten memory search "software engineer"

# Export memories
umwelten memory export --format json --output memories.json
```

#### Clear Memory
```bash
# Clear all memories
umwelten memory clear

# Clear specific memory
umwelten memory delete "work information"
```

#### Memory Configuration
```bash
# Set memory retention period
umwelten run --provider google --model gemini-2.0-flash --memory --retention 7d "Store this for a week"

# Set memory importance
umwelten run --provider ollama --model gemma3:12b --memory --importance high "This is very important"
```

## Tool Integration

### Available Tools

Umwelten comes with several built-in tools:

#### Calculator Tool
```bash
# Basic arithmetic operations
umwelten chat --provider ollama --model qwen3:latest --tools calculator

# User: "What is 15 * 27?"
# Model can use calculator to compute: 405
```

#### Statistics Tool
```bash
# Statistical calculations
umwelten chat --provider ollama --model qwen3:latest --tools statistics

# User: "Calculate statistics for [10, 20, 30, 40, 50]"
# Model can compute mean, median, mode, standard deviation
```

#### Random Number Tool
```bash
# Generate random numbers
umwelten chat --provider ollama --model qwen3:latest --tools randomNumber

# User: "Generate a random number between 1 and 100"
# Model can generate random numbers within specified ranges
```

### Using Multiple Tools

Combine multiple tools for enhanced capabilities:

```bash
# Use calculator and statistics together
umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics

# User: "Calculate the mean of [10, 20, 30] and then multiply it by 5"
# Model can use both tools to compute: mean = 20, then 20 * 5 = 100
```

### Tool Usage Examples

#### Mathematical Operations
```bash
# Complex calculations
umwelten chat --provider ollama --model qwen3:latest --tools calculator

# User: "Calculate (15 + 27) * 3 / 2"
# Model uses calculator: (15 + 27) = 42, 42 * 3 = 126, 126 / 2 = 63
```

#### Data Analysis
```bash
# Statistical analysis
umwelten chat --provider ollama --model qwen3:latest --tools statistics

# User: "Analyze this dataset: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]"
# Model provides: mean, median, mode, standard deviation, range
```

#### Random Generation
```bash
# Random number generation
umwelten chat --provider ollama --model qwen3:latest --tools randomNumber

# User: "Generate 5 random numbers between 1 and 50"
# Model generates 5 random numbers in the specified range
```

## Advanced Memory Features

### Memory with Structured Data

Store and retrieve structured information:

```bash
# Store structured data
umwelten run --provider google --model gemini-2.0-flash --memory \
  "Store: My preferences are: language=Python, style=concise, level=intermediate"

# Retrieve structured data
umwelten run --provider google --model gemini-2.0-flash --memory \
  "Write a Python function in my preferred style"
```

### Memory with Context

Build context-aware conversations:

```bash
# Establish context
umwelten chat --provider ollama --model gemma3:12b --memory

# User: "I'm working on a machine learning project"
# User: "I need help with data preprocessing"
# Model remembers the ML context and provides relevant advice
```

### Memory Persistence

Memory persists across sessions:

```bash
# Session 1: Store information
umwelten run --provider google --model gemini-2.0-flash --memory "I prefer TypeScript over JavaScript"

# Session 2: Retrieve information (later)
umwelten run --provider google --model gemini-2.0-flash --memory "What programming language do I prefer?"
# Response: "You prefer TypeScript over JavaScript"
```

## Advanced Tool Usage

### Custom Tool Integration

Create and use custom tools:

```bash
# Define custom tool (example)
umwelten tools register \
  --name "weather" \
  --description "Get weather information for a location" \
  --function "getWeather(location: string) => WeatherInfo"

# Use custom tool
umwelten chat --provider ollama --model qwen3:latest --tools weather

# User: "What's the weather in New York?"
# Model can use weather tool to get current conditions
```

### Tool Chaining

Chain multiple tool calls:

```bash
# Use tools in sequence
umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics

# User: "Calculate the mean of [10, 20, 30], then multiply it by the number of items"
# Model: 1) Uses statistics to get mean = 20, 2) Uses calculator to compute 20 * 3 = 60
```

### Error Handling with Tools

Handle tool errors gracefully:

```bash
# Tools handle errors automatically
umwelten chat --provider ollama --model qwen3:latest --tools calculator

# User: "Calculate 10 / 0"
# Model: "I cannot divide by zero. That would result in an undefined value."
```

## Memory and Tools Integration

### Combining Memory with Tools

Use memory and tools together for powerful interactions:

```bash
# Chat with both memory and tools
umwelten chat --provider ollama --model qwen3:latest --memory --tools calculator,statistics

# User: "I'm analyzing sales data. The values are [100, 150, 200, 250, 300]"
# User: "Calculate the average and then multiply by 1.2"
# Model: Remembers the sales context and uses tools to compute: average = 200, 200 * 1.2 = 240
```

### Context-Aware Tool Usage

Tools can use memory context:

```bash
# Establish context with memory
umwelten chat --provider ollama --model qwen3:latest --memory --tools calculator

# User: "I'm working with temperature data in Celsius"
# User: "Convert 25 degrees to Fahrenheit"
# Model: Remembers Celsius context and uses calculator: (25 * 9/5) + 32 = 77°F
```

## Best Practices

### Memory Management

#### 1. Use Descriptive Memory Keys
```bash
# Good: Clear, descriptive memory
umwelten run --provider google --model gemini-2.0-flash --memory \
  "Store: My coding preferences: language=Python, style=functional, testing=required"

# Bad: Vague memory
umwelten run --provider google --model gemini-2.0-flash --memory \
  "Store: I like Python"
```

#### 2. Regular Memory Cleanup
```bash
# Clean up old memories periodically
umwelten memory list --older-than 30d
umwelten memory delete --older-than 30d
```

#### 3. Organize Memory by Topics
```bash
# Use consistent naming for related memories
umwelten run --provider ollama --model gemma3:12b --memory \
  "Store: project:ml:preferences: Use scikit-learn for machine learning"
umwelten run --provider ollama --model gemma3:12b --memory \
  "Store: project:ml:datasets: Working with customer_data.csv"
```

### Tool Usage

#### 1. Choose Appropriate Tools
```bash
# Use specific tools for specific tasks
umwelten chat --provider ollama --model qwen3:latest --tools calculator  # For math
umwelten chat --provider ollama --model qwen3:latest --tools statistics  # For data analysis
umwelten chat --provider ollama --model qwen3:latest --tools calculator,statistics  # For both
```

#### 2. Validate Tool Results
```bash
# Always verify tool outputs for critical calculations
umwelten chat --provider ollama --model qwen3:latest --tools calculator

# User: "Calculate 1234 * 5678"
# Model provides result, but you can double-check for important calculations
```

#### 3. Handle Tool Limitations
```bash
# Be aware of tool limitations
umwelten chat --provider ollama --model qwen3:latest --tools calculator

# Calculator tool handles basic arithmetic, not complex mathematical functions
# Use appropriate tools for different types of calculations
```

## Troubleshooting

### Memory Issues

#### 1. Memory Not Persisting
```bash
# Check memory storage location
umwelten memory config --show-path

# Verify memory is being saved
umwelten memory list
```

#### 2. Memory Search Not Working
```bash
# Use specific search terms
umwelten memory search "exact phrase"

# Check memory contents
umwelten memory list --verbose
```

### Tool Issues

#### 1. Tools Not Available
```bash
# Check available tools
umwelten tools list

# Verify tool installation
umwelten tools status
```

#### 2. Tool Errors
```bash
# Check tool logs
umwelten tools logs

# Test tool functionality
umwelten tools test calculator --input '{"operation":"add","a":5,"b":3}'
```

## Advanced Use Cases

### Research Assistant

Create a research assistant with memory and tools:

```bash
# Initialize research assistant
umwelten chat --provider google --model gemini-2.0-flash --memory --tools calculator,statistics

# User: "I'm researching renewable energy costs"
# User: "Store: Solar panel cost per watt is $2.50"
# User: "Calculate the cost for a 5kW system"
# Model: Remembers context and uses calculator: 5000 * $2.50 = $12,500
```

### Data Analysis Workflow

Build a data analysis workflow:

```bash
# Start analysis session
umwelten chat --provider ollama --model qwen3:latest --memory --tools statistics

# User: "I have sales data: [1000, 1200, 1100, 1300, 1400]"
# User: "Calculate the trend and growth rate"
# Model: Uses statistics tool and memory to provide comprehensive analysis
```

### Learning Assistant

Create a personalized learning assistant:

```bash
# Initialize learning assistant
umwelten chat --provider google --model gemini-2.0-flash --memory --tools calculator

# User: "I'm learning calculus"
# User: "Store: I understand derivatives but struggle with integrals"
# User: "Help me solve this integral: ∫x² dx"
# Model: Remembers learning context and provides appropriate guidance
```

## Next Steps

Now that you understand memory and tools, explore:

- 🔄 [Concurrent Processing](/guide/concurrent-processing) - Use memory and tools with concurrent operations
- 📊 [Reports & Analysis](/guide/reports) - Generate reports that include memory and tool usage
- 💰 [Cost Analysis](/guide/cost-analysis) - Optimize costs while using memory and tools
- 📈 [Batch Processing](/guide/batch-processing) - Apply memory and tools to large-scale operations
