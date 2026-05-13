# @umwelten/protocols

MCP server framework, MCP client with OAuth, and tool bridge for umwelten.

## Install

```bash
pnpm add @umwelten/protocols
```

## What's inside

- **mcp-serve/** — OAuth MCP server framework (`createMcpServer`, `NeonStore`, upstream OAuth)
- **mcp/client/** — `RemoteMcpClient` with OAuth 2.1 PKCE, file-backed token storage
- **mcp/server/** — `MCPServer`, `MCPServerBuilder`
- **mcp/integration/** — MCP-to-AI-SDK tool bridge (`MCPStimulusManager`)
- **mcp/types/** — Shared MCP transport and protocol types

## Usage

```typescript
import { createMcpServer, RemoteMcpClient } from '@umwelten/protocols';

// Create an MCP server
const server = createMcpServer({ name: 'my-server' });

// Connect to a remote MCP server
const client = new RemoteMcpClient('https://example.com/mcp');
await client.connect();
const tools = await client.getAiSdkTools();
```
