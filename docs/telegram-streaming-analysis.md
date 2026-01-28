# Telegram Streaming Analysis

## Problem Summary

The Jeeves bot handles streaming differently between CLI and Telegram, resulting in different user experiences.

## How CLI Streaming Works

**Location**: `src/ui/cli/CLIInterface.ts` and `src/cognition/runner.ts`

1. CLI calls `interaction.streamText()` (line 230 in CLIInterface.ts)
2. This delegates to `BaseModelRunner.streamText()` (line 253 in runner.ts)
3. The runner gets the stream from Vercel AI SDK's `streamText()` function
4. **The runner streams chunks in real-time** to `process.stdout.write()`:
   - Line 273: `process.stdout.write(textDelta)` for text-delta events
   - Line 313: `process.stdout.write(textPart)` for textStream
   - Line 322: `process.stdout.write(fullText)` for fallback
5. Users see text appear character-by-character as it's generated
6. After streaming completes, the CLI also writes `response.content` again (line 235), but users already saw it stream

**Key Point**: The streaming happens **inside** `BaseModelRunner.streamText()` and writes directly to stdout.

## How Telegram Streaming Works (Current Implementation)

**Location**: `src/ui/telegram/TelegramAdapter.ts`

1. Telegram calls `interaction.streamText()` (line 159 in TelegramAdapter.ts)
2. This delegates to `BaseModelRunner.streamText()` (same as CLI)
3. The runner streams chunks to `process.stdout.write()` (same as CLI)
4. **But Telegram never sees these chunks** - they go to stdout, not to Telegram
5. Telegram waits for the full response to complete
6. After streaming finishes, Telegram gets `response.content` (the full aggregated text)
7. Telegram sends the entire message at once via `ctx.reply()` (line 214)

**Key Problem**: The streaming happens inside the runner and writes to stdout, but Telegram can't intercept or redirect those chunks. It only gets the final aggregated `response.content` after streaming completes.

## The Architecture Issue

The current architecture has streaming logic **hardcoded** inside `BaseModelRunner.streamText()`:

```typescript
// In runner.ts, lines 267-325
if (response.fullStream) {
  for await (const event of response.fullStream) {
    switch ((event as any).type) {
      case 'text-delta':
        const textDelta = (event as any).textDelta || (event as any).text;
        if (textDelta !== undefined && textDelta !== null) {
          process.stdout.write(textDelta);  // ← Hardcoded to stdout!
          fullText += textDelta;
        }
        break;
      // ... more cases
    }
  }
}
```

This means:
- ✅ CLI works because it wants output to stdout
- ❌ Telegram can't stream because it needs to send chunks to Telegram API, not stdout

## Why This Matters

1. **User Experience**: CLI users see real-time streaming, Telegram users wait for the full response
2. **Perceived Performance**: Streaming feels faster even if total time is the same
3. **Tool Calls**: When tools are called, CLI shows tool call messages in real-time, Telegram doesn't

## Potential Solutions

### Option 1: Add Streaming Callback to Runner
Modify `BaseModelRunner.streamText()` to accept an optional callback for streaming:

```typescript
async streamText(
  interaction: Interaction,
  onChunk?: (chunk: string) => void | Promise<void>
): Promise<ModelResponse>
```

Then:
- CLI passes no callback (defaults to `process.stdout.write`)
- Telegram passes a callback that sends chunks to Telegram

### Option 2: Expose Stream Directly
Create a method that returns the stream instead of consuming it:

```typescript
async getStream(interaction: Interaction): Promise<AsyncIterable<...>>
```

Then:
- CLI consumes the stream and writes to stdout
- Telegram consumes the stream and sends to Telegram

### Option 3: Separate Streaming Interface
Create a `StreamWriter` interface that both CLI and Telegram implement:

```typescript
interface StreamWriter {
  write(chunk: string): void | Promise<void>;
  flush?(): void | Promise<void>;
}
```

### Option 4: Telegram-Specific Streaming Method
Create a custom method in `TelegramAdapter` that directly accesses the Vercel AI SDK stream and sends chunks to Telegram incrementally, bypassing the runner's stdout logic.

## Current Workaround

The Telegram adapter currently:
1. Waits for full response
2. Sends entire message at once
3. Has debug logging to understand what's happening (lines 161-179)

This works but doesn't provide the streaming experience that CLI users get.

## Files Involved

- `src/ui/telegram/TelegramAdapter.ts` - Telegram implementation (lines 145-225)
- `src/ui/cli/CLIInterface.ts` - CLI implementation (lines 186-265)
- `src/cognition/runner.ts` - BaseModelRunner with streaming logic (lines 253-459)
- `src/interaction/interaction.ts` - Interaction class that delegates to runner (line 271-272)
