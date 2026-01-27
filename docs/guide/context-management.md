# Context Management

Learn how to track and manage conversation context size, and intelligently compact long conversations using Umwelten's context management system.

## Overview

As conversations grow, the context (all messages sent to the model) can become very large, leading to:
- Higher token costs
- Slower response times
- Context window limits
- Reduced relevance (old messages dilute focus)

Umwelten provides tools to:
- **Track context size** - See how large your conversation is
- **Set checkpoints** - Mark where a "thread" or topic begins
- **Compact context** - Intelligently condense old segments into summaries

## Context Size Estimation

### Basic Usage

```typescript
import { estimateContextSize } from 'umwelten/context';

const messages = interaction.getMessages();
const size = estimateContextSize(messages);

console.log(`Messages: ${size.messageCount}`);
console.log(`Characters: ${size.characterCount}`);
console.log(`Estimated tokens: ${size.estimatedTokens}`);
```

The estimation uses character count divided by 4 as a token estimate. For more accurate token counting, you can integrate tiktoken.

### In Jeeves CLI

The Jeeves bot automatically prints context size after each reply:

```
Jeeves: I've completed that task for you.
[Context: 12 messages, ~8.2K tokens]
```

Use the `/context` command to check size at any time:

```
You: /context
[Context: 12 messages, ~8.2K tokens]
```

## Checkpoints

Checkpoints mark where a conversation "thread" or topic begins. Use them before starting a long task so you can compact that segment later.

### Setting a Checkpoint

```typescript
// Mark current point as start of a new thread
interaction.setCheckpoint();

// Get current checkpoint
const checkpoint = interaction.getCheckpoint();
// Returns: number (message index) or undefined
```

### In Jeeves CLI

```
You: /checkpoint
Checkpoint set. Future /compact will condense from here to end of current thread.
```

## Compaction Strategies

Compaction strategies define how to condense a segment of messages. Umwelten includes:

### Through-line and Facts (Default)

**Strategy ID**: `through-line-and-facts`

**What it does**: Uses the same LLM to summarize the segment into:
1. **Through-line**: What was this thread about? What was decided or achieved? (2-4 sentences)
2. **Key facts to remember**: Preferences, names, decisions, outcomes (bullet points)

**What it omits**: In-call details like full tool outputs, step-by-step actions, verbose back-and-forth

**Example**:
```
Before compaction: 20 messages, ~15K tokens
After compaction: 3 messages, ~2K tokens
  - System message (original)
  - System message: "Previous context (condensed): [summary]"
  - Recent messages (last 2 turns)
```

### Truncate

**Strategy ID**: `truncate`

**What it does**: Replaces the segment with a simple placeholder message. No LLM call.

**Use case**: Quick placeholder when you just want to drop old content without summarization.

## Compacting Context

### Programmatic Usage

```typescript
import { Interaction } from 'umwelten/interaction';
import { Stimulus } from 'umwelten/stimulus';

const interaction = new Interaction(modelDetails, stimulus);

// Set checkpoint before a long conversation
interaction.setCheckpoint();

// ... have conversation with many messages ...

// Compact from checkpoint to end of last flow
const result = await interaction.compactContext('through-line-and-facts', {
  fromCheckpoint: true,
  strategyOptions: {} // Strategy-specific options
});

if (result) {
  console.log(`Compacted segment [${result.segmentStart}..${result.segmentEnd}]`);
  console.log(`Replaced with ${result.replacementCount} message(s)`);
}
```

### In Jeeves CLI

```
You: /compact
Compacted segment [1..18] into 1 message(s).
[Context: 5 messages, ~2.1K tokens]
```

Use a specific strategy:

```
You: /compact truncate
Compacted segment [1..18] into 1 message(s).
[Context: 5 messages, ~1.8K tokens]
```

List available strategies:

```
You: /compact help
Compaction strategies:
  through-line-and-facts – Summarize segment to main narrative and key facts using the LLM; omit in-call details.
  truncate – Replace segment with a one-line placeholder; no LLM.

Usage: /compact [strategyId]   (default: through-line-and-facts)
```

## How Compaction Works

1. **Segment Selection**: The system identifies which messages to condense:
   - From checkpoint (if set) or from start of conversation
   - Through the end of the last complete assistant reply (so we don't cut mid-turn)

2. **Strategy Execution**: The chosen strategy processes the segment:
   - **LLM strategies** (like `through-line-and-facts`): Serialize segment, send to model with summarization prompt, get condensed summary
   - **Non-LLM strategies** (like `truncate`): Return a placeholder message

3. **Replacement**: The segment is replaced with the strategy's output (usually one summary message)

4. **Checkpoint Update**: The checkpoint is moved to after the new summary, so future compactions don't re-include the same content

## Best Practices

### When to Set Checkpoints

- **Before starting a new topic**: "Let's work on X now" → `/checkpoint`
- **Before a long task**: "I need you to analyze this large document" → `/checkpoint`
- **After completing a thread**: "That's done, let's move on" → `/checkpoint` then `/compact`

### When to Compact

- **Context getting large**: If you see `[Context: 50+ messages, ~30K+ tokens]`, consider compacting
- **Topic has shifted**: After a clear topic change, compact the previous thread
- **Before a new major task**: Compact old context to make room for new work

### Strategy Selection

- **`through-line-and-facts`** (default): Best for preserving important information while reducing size. Use when you want the model to remember key facts and decisions.
- **`truncate`**: Use when you just want to drop old content and don't need it summarized.

## Advanced: Custom Strategies

You can create custom compaction strategies:

```typescript
import { CompactionStrategy } from 'umwelten/context';
import { registerCompactionStrategy } from 'umwelten/context';

const myStrategy: CompactionStrategy = {
  id: 'facts-only',
  name: 'Facts Only',
  description: 'Extract only facts, drop narrative',
  async compact(input) {
    // Your compaction logic
    // Use input.runner and input.model for LLM calls if needed
    return {
      replacementMessages: [/* condensed messages */]
    };
  }
};

registerCompactionStrategy(myStrategy);
```

## Integration Examples

### With Jeeves Bot

Jeeves automatically shows context size and supports `/checkpoint` and `/compact` commands. See the [Jeeves README](../../examples/jeeves-bot/README.md) for details.

### With Custom Applications

```typescript
import { Interaction } from 'umwelten/interaction';
import { estimateContextSize } from 'umwelten/context';

const interaction = new Interaction(modelDetails, stimulus);

// Monitor context size
function checkContextSize() {
  const size = estimateContextSize(interaction.getMessages());
  if (size.estimatedTokens > 20000) {
    console.warn('Context is large, consider compacting');
  }
}

// Compact when needed
async function compactIfNeeded() {
  const size = estimateContextSize(interaction.getMessages());
  if (size.estimatedTokens > 30000) {
    await interaction.compactContext('through-line-and-facts');
    const newSize = estimateContextSize(interaction.getMessages());
    console.log(`Compacted: ${size.estimatedTokens} → ${newSize.estimatedTokens} tokens`);
  }
}
```

## API Reference

See the [Interaction API](/api/interaction) for full method documentation:
- `setCheckpoint()`
- `getCheckpoint()`
- `compactContext(strategyId, options)`

See the [Context Module](/api/context) (coming soon) for:
- `estimateContextSize(messages)`
- `getCompactionSegment(messages, options)`
- `registerCompactionStrategy(strategy)`
- `listCompactionStrategies()`
