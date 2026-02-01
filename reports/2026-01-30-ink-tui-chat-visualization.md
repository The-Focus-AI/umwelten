---
title: "TypeScript TUI for Chat Messages: Ink"
date: 2026-01-30
topic: ink-tui-chat
recommendation: ink
version_researched: 6.5.1
use_when:
  - Building React-style terminal interfaces with familiar component patterns
  - Visualizing chat/conversation data with user, assistant, and tool messages
  - Creating interactive CLIs with focus management and keyboard navigation
  - Leveraging existing React/TypeScript skills for terminal development
  - Building tools that need flexbox-based layouts in the terminal
avoid_when:
  - Need native scrolling containers (Ink requires manual windowing)
  - Building simple prompt-only CLIs (use Enquirer instead)
  - Targeting environments without Node.js (consider Rust TUI libs)
  - Need pixel-perfect widget positioning (consider blessed/neo-blessed)
  - Rendering extremely large message lists without virtualization strategy
project_context:
  language: TypeScript
  relevant_dependencies:
    - "@src/sessions/normalized-types.ts (NormalizedMessage, NormalizedSession)"
    - "@src/sessions/types.ts (SessionMessage, ToolUseContent, ToolResultContent)"
---

## Summary

**Ink** is the dominant React-based terminal UI framework for Node.js/TypeScript, with **34.4k GitHub stars** and approximately **2.15 million weekly npm downloads**[1][2]. It provides the same component-based UI building experience that React offers in the browser, but for command-line applications, using Yoga for Flexbox layouts[1].

For visualizing chat messages from the umwelten `@src/sessions/` module, Ink is the optimal choice because it directly maps to the `NormalizedMessage` structure (user/assistant/tool roles) and allows rendering each message type as a distinct React component. The library is used in production by **Claude Code (Anthropic)**, Gemini CLI (Google), GitHub Copilot CLI, Prisma, Gatsby, and 50+ other major tools[1].

The ecosystem includes **@inkjs/ui** for pre-built components (Spinners, Select inputs, Badges)[3], **ink-markdown** for rendering markdown content[4], and **fullscreen-ink** for alternate screen buffer management[5]. TypeScript support is first-class—the entire codebase was converted to TypeScript, and `create-ink-app --typescript` scaffolds typed projects directly[1].

## Philosophy & Mental Model

Ink's core insight is that terminal UIs are fundamentally trees of styled text arranged in layouts—exactly what React's virtual DOM models. The mental model centers on three concepts:

1. **Everything is a Component**: Your TUI is a tree of `<Box>` and `<Text>` elements. Messages, tool calls, headers, and inputs are all components that compose together[6].

2. **Flexbox for Layout**: Layouts are controlled via flexbox properties (`flexDirection`, `justifyContent`, `alignItems`, `flexGrow`) on `<Box>` components. There is no CSS grid—everything is nested boxes[6].

3. **Hooks for Interactivity**: `useInput` captures raw keystrokes, `useFocus`/`useFocusManager` manage which component receives input, and `useStdout` provides terminal dimensions[1][7].

For chat visualization specifically, think of messages as a virtualized list where you:
- Render only the visible slice (last N messages that fit the viewport)
- Style each message type (user/assistant/tool) with distinct visual treatment
- Use `<Static>` for completed messages that won't re-render
- Handle tool calls as collapsible/expandable child components

## Setup

### Installation

```bash
pnpm add ink react @inkjs/ui ink-markdown fullscreen-ink
pnpm add -D @types/react
```

### TypeScript Configuration

Ensure your `tsconfig.json` includes JSX support:

```json
{
  "compilerOptions": {
    "jsx": "react",
    "esModuleInterop": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022"
  }
}
```

### Basic App Structure

```typescript
// src/tui/app.tsx
import React from 'react';
import { render } from 'ink';
import { withFullScreen } from 'fullscreen-ink';
import { ChatView } from './components/ChatView.js';

const App = () => {
  return <ChatView />;
};

// Fullscreen mode with alternate screen buffer
withFullScreen(<App />).start();
```

## Core Usage Patterns

### Pattern 1: Message Component with Role-Based Styling

Map `NormalizedMessage` roles to distinct visual treatments:

```typescript
// src/tui/components/Message.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { NormalizedMessage } from '../../sessions/normalized-types.js';

const roleColors = {
  user: 'cyan',
  assistant: 'green',
  system: 'yellow',
  tool: 'magenta',
} as const;

const roleLabels = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
} as const;

interface MessageProps {
  message: NormalizedMessage;
}

export const Message: React.FC<MessageProps> = ({ message }) => {
  const color = roleColors[message.role];
  const label = roleLabels[message.role];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={color}>[{label}]</Text>
        {message.timestamp && (
          <Text dimColor> {new Date(message.timestamp).toLocaleTimeString()}</Text>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text wrap="wrap">{message.content}</Text>
      </Box>
      {message.tool && (
        <ToolCallDetails tool={message.tool} />
      )}
    </Box>
  );
};
```

### Pattern 2: Windowed Message List (No Native Scroll)

Ink lacks built-in scroll containers. Implement windowing by tracking viewport and rendering only visible messages[6][8]:

```typescript
// src/tui/components/MessageList.tsx
import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { NormalizedMessage } from '../../sessions/normalized-types.js';
import { Message } from './Message.js';

interface MessageListProps {
  messages: NormalizedMessage[];
  scrollOffset?: number;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  scrollOffset = 0
}) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;

  // Reserve space for header (2 lines) and input (3 lines)
  const availableHeight = terminalHeight - 5;

  // Estimate ~3 lines per message (adjust based on your content)
  const visibleCount = Math.floor(availableHeight / 3);

  const visibleMessages = useMemo(() => {
    const startIdx = Math.max(0, messages.length - visibleCount - scrollOffset);
    const endIdx = messages.length - scrollOffset;
    return messages.slice(startIdx, endIdx);
  }, [messages, visibleCount, scrollOffset]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visibleMessages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
      {messages.length > visibleCount && (
        <Text dimColor>
          Showing {visibleMessages.length} of {messages.length} messages
        </Text>
      )}
    </Box>
  );
};
```

### Pattern 3: Tool Call Visualization with Expand/Collapse

Tool calls from `NormalizedMessage.tool` can be rendered as collapsible sections[8][9]:

```typescript
// src/tui/components/ToolCallDetails.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ToolCallProps {
  tool: {
    name: string;
    input?: Record<string, unknown>;
    output?: string;
    duration?: number;
    isError?: boolean;
  };
}

export const ToolCallDetails: React.FC<ToolCallProps> = ({ tool }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
      <Box>
        <Text
          color={tool.isError ? 'red' : 'magenta'}
          bold
        >
          {expanded ? '▼' : '▶'} {tool.name}
        </Text>
        {tool.duration && (
          <Text dimColor> ({tool.duration}ms)</Text>
        )}
        <Text dimColor> [Enter to {expanded ? 'collapse' : 'expand'}]</Text>
      </Box>

      {expanded && (
        <Box flexDirection="column" marginLeft={2} borderStyle="single" borderColor="gray">
          {tool.input && (
            <Box flexDirection="column">
              <Text bold>Input:</Text>
              <Text wrap="wrap">{JSON.stringify(tool.input, null, 2)}</Text>
            </Box>
          )}
          {tool.output && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Output:</Text>
              <Text wrap="wrap" color={tool.isError ? 'red' : undefined}>
                {tool.output.slice(0, 500)}
                {tool.output.length > 500 && '...'}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
```

### Pattern 4: Focus Management for Multi-Pane Layout

Use `useFocus` and `useFocusManager` for keyboard navigation between panes[7][10]:

```typescript
// src/tui/components/ChatView.tsx
import React, { useState } from 'react';
import { Box, Text, useFocus, useFocusManager, useInput } from 'ink';
import { MessageList } from './MessageList.js';
import { SessionSidebar } from './SessionSidebar.js';

export const ChatView: React.FC = () => {
  const [activePane, setActivePane] = useState<'messages' | 'sessions'>('messages');
  const { focus } = useFocusManager();

  useInput((input, key) => {
    if (key.tab) {
      const next = activePane === 'messages' ? 'sessions' : 'messages';
      setActivePane(next);
      focus(next);
    }
  });

  return (
    <Box flexDirection="row" height="100%">
      {/* Main chat area - 70% */}
      <Box
        flexDirection="column"
        width="70%"
        borderStyle={activePane === 'messages' ? 'bold' : 'single'}
        borderColor={activePane === 'messages' ? 'cyan' : 'gray'}
      >
        <MessageList messages={[]} />
      </Box>

      {/* Session sidebar - 30% */}
      <Box
        flexDirection="column"
        width="30%"
        borderStyle={activePane === 'sessions' ? 'bold' : 'single'}
        borderColor={activePane === 'sessions' ? 'cyan' : 'gray'}
      >
        <SessionSidebar />
      </Box>
    </Box>
  );
};
```

### Pattern 5: Static Content for Completed Messages

Use `<Static>` for messages that won't change, preventing flicker and improving performance[1][9]:

```typescript
// src/tui/components/StaticMessageLog.tsx
import React from 'react';
import { Box, Static, Text } from 'ink';
import type { NormalizedMessage } from '../../sessions/normalized-types.js';
import { Message } from './Message.js';

interface StaticMessageLogProps {
  completedMessages: NormalizedMessage[];
  streamingMessage?: NormalizedMessage;
}

export const StaticMessageLog: React.FC<StaticMessageLogProps> = ({
  completedMessages,
  streamingMessage,
}) => {
  return (
    <Box flexDirection="column">
      {/* Static: Only renders new items, ignores previously rendered */}
      <Static items={completedMessages}>
        {(msg) => <Message key={msg.id} message={msg} />}
      </Static>

      {/* Dynamic: Re-renders as streaming content updates */}
      {streamingMessage && (
        <Message message={streamingMessage} />
      )}
    </Box>
  );
};
```

## Anti-Patterns & Pitfalls

### Don't: Use console.log During Rendering

```typescript
// BAD: Breaks Ink's layout engine
const Message = ({ content }) => {
  console.log('Rendering message:', content); // Corrupts terminal output!
  return <Text>{content}</Text>;
};
```

**Why it's wrong:** Ink manages stdout. Any direct writes via `console.log` interleave with Ink's output, causing visual corruption and layout breaks[6].

### Instead: Use a Debug Component or File Logging

```typescript
// GOOD: Route debug output to a file or dedicated UI component
import { appendFileSync } from 'fs';

const debugLog = (msg: string) => {
  appendFileSync('/tmp/tui-debug.log', `${new Date().toISOString()} ${msg}\n`);
};

const Message = ({ content }) => {
  debugLog(`Rendering message: ${content}`);
  return <Text>{content}</Text>;
};
```

---

### Don't: Render Unbounded Lists

```typescript
// BAD: Renders thousands of components, causes flicker and freezing
const AllMessages = ({ messages }) => (
  <Box flexDirection="column">
    {messages.map(m => <Message key={m.id} message={m} />)}
  </Box>
);
```

**Why it's wrong:** Ink has no native virtualization. Rendering 1000+ `<Text>` nodes causes severe performance degradation and flicker[6][8].

### Instead: Implement Windowing

```typescript
// GOOD: Only render what fits on screen
const WindowedMessages = ({ messages, viewportSize = 50 }) => {
  const visible = messages.slice(-viewportSize);
  return (
    <Box flexDirection="column">
      {visible.map(m => <Message key={m.id} message={m} />)}
    </Box>
  );
};
```

---

### Don't: Hardcode Terminal Dimensions

```typescript
// BAD: Breaks on different terminal sizes
const Layout = () => (
  <Box height={40} width={120}>
    <Content />
  </Box>
);
```

**Why it's wrong:** Terminal sizes vary. Hardcoded dimensions cause clipping or wasted space.

### Instead: Use useStdout for Dynamic Sizing

```typescript
// GOOD: Responsive to terminal size
import { useStdout } from 'ink';

const Layout = () => {
  const { stdout } = useStdout();
  const height = stdout?.rows ?? 24;
  const width = stdout?.columns ?? 80;

  return (
    <Box height={height - 1} width={width}>
      <Content />
    </Box>
  );
};
```

---

### Don't: Set Height Equal to Terminal Rows

```typescript
// BAD: Causes flickering due to accidental scroll
const FullScreen = () => {
  const { stdout } = useStdout();
  return <Box height={stdout?.rows}>{/* content */}</Box>;
};
```

**Why it's wrong:** Setting height exactly equal to `process.stdout.rows` triggers a known flickering issue due to accidental scrolling[11].

### Instead: Subtract One Row

```typescript
// GOOD: Prevents scroll-induced flicker
const FullScreen = () => {
  const { stdout } = useStdout();
  return <Box height={(stdout?.rows ?? 24) - 1}>{/* content */}</Box>;
};
```

## Why This Choice

### Decision Criteria

| Criterion | Weight | How Ink Scored |
|-----------|--------|----------------|
| TypeScript support | High | Native—codebase is TypeScript, ships types[1] |
| React mental model | High | Identical to React—components, hooks, JSX[1] |
| Ecosystem maturity | High | 34k stars, 2M+ weekly downloads, used by Claude Code[1][2] |
| Chat/message visualization | High | Natural fit—messages as components, tool calls as nested elements |
| Flexbox layouts | Medium | Full support via Yoga engine[1] |
| Learning curve | Medium | Minimal for React developers[1] |
| Scrolling support | Low | Requires manual windowing (limitation)[6][8] |

### Key Factors

- **React Compatibility**: If you know React, you know Ink. All React features work—hooks, context, composition[1].
- **Production Proven**: Claude Code, Gemini CLI, and GitHub Copilot CLI all use Ink, validating it for complex interactive UIs[1].
- **Chat-Specific Mapping**: `NormalizedMessage` with role/content/tool maps directly to component props, and `ContentBlock` types (text, tool_use, tool_result) map to specialized child components.
- **@inkjs/ui Components**: Pre-built Spinner, Select, Badge, and ProgressBar components accelerate development[3].

## Alternatives Considered

### blessed / neo-blessed

- **What it is:** Traditional widget-based TUI library with mouse support and extensive built-in widgets[12].
- **Why not chosen:** Different mental model (imperative, widget-based vs declarative, component-based). Less active maintenance. Requires learning a new paradigm if you know React.
- **Choose this instead when:**
  - Need pixel-perfect widget positioning
  - Require extensive mouse event handling
  - Building classic curses-style interfaces
- **Key tradeoff:** More control over layout but steeper learning curve and less modern API.

### Enquirer / Prompts

- **What it is:** Lightweight prompt libraries for CLI input collection[13].
- **Why not chosen:** Not designed for persistent, complex UIs. Best for simple question-answer flows.
- **Choose this instead when:**
  - Building a simple CLI wizard or installer
  - Only need sequential prompts, not a full TUI
  - Want minimal dependencies (~4ms load time for Enquirer)[13]
- **Key tradeoff:** Much simpler but can't build persistent, interactive UIs.

### Terminal-Kit

- **What it is:** Full-featured terminal library with drawing primitives[12].
- **Why not chosen:** Lower-level API, more manual rendering work. Less TypeScript-first.
- **Choose this instead when:**
  - Need precise cursor control and drawing primitives
  - Building games or animation-heavy UIs
- **Key tradeoff:** More power but more boilerplate.

### OpenTUI

- **What it is:** Emerging TypeScript TUI library, used by terminaldotshop[14].
- **Why not chosen:** Still in development, not production-ready yet.
- **Choose this instead when:**
  - The library matures and you want a non-React TypeScript TUI
- **Key tradeoff:** Modern design but early-stage.

## Caveats & Limitations

- **No Native Scrolling:** Ink does not have a `<ScrollView>` component. You must implement windowing/virtualization manually by tracking scroll position and rendering only visible items[6][8]. For the umwelten message viewer, this means slicing `messages.slice(-visibleCount - scrollOffset, -scrollOffset || undefined)`.

- **Flickering with Full Height:** Setting a component's height exactly equal to `process.stdout.rows` causes flicker. Always subtract at least 1 row[11]. Claude Code's team rewrote their renderer to reduce flicker by 85%[15].

- **No Markdown Syntax Highlighting Built-In:** While `ink-markdown` renders markdown, code block syntax highlighting requires additional configuration with `marked-terminal`[4].

- **ESM Only (v5+):** Ink 5+ is ESM-only. Ensure your project uses `"type": "module"` in package.json or appropriate bundler config.

- **No Grid Layout:** Ink only supports Flexbox via Yoga. Complex grid layouts require nested `<Box>` elements with careful `flexBasis` and `flexGrow` management.

- **Terminal Compatibility:** Fullscreen/alternate buffer mode works in most terminals but may behave differently in embedded terminals (VS Code, tmux). Test across target environments.

## References

[1] [GitHub - vadimdemedes/ink](https://github.com/vadimdemedes/ink) - Main repository with 34.4k stars, full documentation, component reference, and hooks API

[2] [npm trends: ink](https://npmtrends.com/ink) - Download statistics showing ~2.15M weekly downloads

[3] [GitHub - vadimdemedes/ink-ui](https://github.com/vadimdemedes/ink-ui) - Official component library with TextInput, Select, Spinner, Badge, and more

[4] [ink-markdown - npm](https://www.npmjs.com/package/ink-markdown) - Markdown rendering component for Ink using marked-terminal

[5] [fullscreen-ink - npm](https://www.npmjs.com/package/fullscreen-ink) - Fullscreen mode with alternate screen buffer support

[6] [TUI Development: Ink + React](https://combray.prose.sh/2025-12-01-tui-development) - Comprehensive guide on building TUIs with Ink, including windowing patterns and anti-patterns

[7] [Reference handbook for Ink v3.2.0](https://developerlife.com/2021/11/25/ink-v3-advanced-ui-components/) - Detailed hook usage including useFocus and useFocusManager

[8] [Reactive UI with Ink and Yoga](https://gerred.github.io/building-an-agentic-system/ink-yoga-reactive-ui.html) - Patterns for agentic systems including message rendering and state management

[9] [Using Ink UI with React - LogRocket](https://blog.logrocket.com/using-ink-ui-react-build-interactive-custom-clis/) - Component patterns and file operations in Ink

[10] [Ink 3 Announcement](https://vadimdemedes.com/posts/ink-3) - Focus management system and hooks introduction

[11] [GitHub Issue #450](https://github.com/vadimdemedes/ink/issues/450) - Flickering when height equals terminal rows

[12] [npm-compare: ink vs blessed](https://npm-compare.com/blessed,ink) - Feature comparison between widget-based and React-based approaches

[13] [npm-compare: enquirer vs prompts](https://npm-compare.com/enquirer,inquirer,prompt,prompt-sync,prompts,readline-sync) - CLI input library comparison

[14] [GitHub - sst/opentui](https://github.com/sst/opentui) - Emerging TypeScript TUI library

[15] [Claude Code Terminal Rendering](https://www.threads.com/@boris_cherny/post/DSZbZatiIvJ) - Anthropic's experience with Ink flickering and their 85% reduction fix
