# Model Context Protocol (MCP) Integration

Umwelten includes comprehensive support for the Model Context Protocol (MCP), enabling integration with external tools and resources through standardized interfaces.

## Overview

The MCP implementation provides two key components:

1. **MCP Client**: Connect to external MCP servers to consume tools and resources
2. **MCP Server Framework**: Build custom MCP servers to expose Umwelten's capabilities to external applications

This integration significantly expands the tool and resource capabilities available for model evaluation and interaction.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard for connecting AI applications with data sources and tools. It enables:

- **Standardized Tool Integration**: Common interface for external tools
- **Resource Access**: Read files, databases, and APIs through unified protocols  
- **Prompt Templates**: Reusable prompt patterns from external sources
- **Secure Sandboxing**: Controlled access to external capabilities

## Features

## Core Components

### MCP Client

Connect to external MCP servers to access their tools and resources:

- **Tool Discovery**: Automatically discover available tools from connected servers
- **Resource Access**: Read files, databases, and other resources
- **Prompt Templates**: Access reusable prompt patterns
- **Type Safety**: Full TypeScript support with runtime validation
- **Connection Management**: Automatic reconnection and error handling

#### Basic Usage

```typescript
const client = createMCPClient({
  name: 'umwelten-client',
  version: '1.0.0'
});

await client.connect(createStdioConfig('node', ['mcp-server.js']));

const tools = await client.getAllTools();
const result = await client.callTool({
  name: 'calculator',
  arguments: { operation: 'add', a: 5, b: 3 }
});
```

### MCP Server Framework

Build custom MCP servers to expose Umwelten's capabilities:

- **Builder Pattern**: Fluent API for easy server creation
- **Tool Registration**: Expose existing tools through MCP interface
- **Resource Serving**: Share evaluation results and data
- **Multi-client Support**: Handle multiple concurrent connections
- **Protocol Compliance**: Full MCP specification implementation

#### Basic Usage

```typescript
const server = createMCPServer()
  .withName('umwelten-server')
  .withVersion('1.0.0')
  .addTool('evaluate-model', {
    description: 'Evaluate a model with a prompt',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string' }
      }
    }
  }, async (params) => {
    // Tool implementation
    return { content: [{ type: 'text', text: result }] };
  })
  .build();

await server.start(transport);
```

## CLI Integration

Umwelten provides comprehensive CLI commands for MCP operations:

### Available Commands

#### Connect to MCP Server

Connect to an MCP server and list available capabilities:

```bash
npx umwelten mcp connect -c "node mcp-server.js" --args arg1 arg2
```

#### Test Tool

Test a specific tool from an MCP server:

```bash  
npx umwelten mcp test-tool -c "node server.js" -t "calculator" -p '{"a":5,"b":3}'
```

#### Read Resource

Read a resource from an MCP server:

```bash
npx umwelten mcp read-resource -c "node server.js" -u "file:///path/to/resource"
```

#### Create Test Server

Create a test MCP server with example tools and resources:

```bash
npx umwelten mcp create-server --with-tools --with-resources
```

#### List Commands

Show usage examples and available commands:

```bash
npx umwelten mcp list
```

## Integration with Umwelten

### High-Level Manager

The `MCPStimulusManager` provides easy integration with Umwelten's existing systems:

```typescript
const manager = createMCPStimulusManager({
  name: 'evaluation-client',
  version: '1.0.0',
  serverCommand: 'node external-mcp-server.js',
  autoConnect: true
});

await manager.connect();

// Use external tools in evaluations
const tools = manager.getAvailableTools();
const resources = manager.getAvailableResources();
```

### Tool Interoperability

- **Unified Interface**: MCP tools work seamlessly with existing Umwelten tools
- **Automatic Conversion**: Transparent conversion between tool formats
- **Type Safety**: Full TypeScript support with runtime validation
- **Context Preservation**: Tool metadata and execution context preserved

## Technical Details

### Protocol Support
- **JSON-RPC 2.0**: Complete specification compliance
- **MCP Protocol**: Full MCP specification implementation
- **Multiple Transports**: stdio, SSE, and WebSocket support
- **Error Handling**: Robust error codes and recovery mechanisms

### Type Safety
- **Full TypeScript**: Complete type safety throughout
- **Zod Validation**: Runtime validation for all protocol messages
- **Schema Conversion**: Automatic JSON Schema to Zod conversion
- **Type Guards**: Helper functions for type checking

## Architecture

### File Structure

```
src/mcp/
├── types/
│   ├── protocol.ts      # MCP protocol types and schemas
│   └── transport.ts     # Transport layer implementations
├── client/
│   └── client.ts        # MCP client implementation
├── server/
│   └── server.ts        # MCP server framework
├── integration/
│   └── stimulus.ts      # Integration with Interaction/Stimulus system
└── cli/
    └── mcp.ts          # CLI commands for MCP operations
```

### Core Features

- **Protocol Compliance**: Full JSON-RPC 2.0 and MCP specification support
- **Transport Options**: stdio, SSE, and WebSocket transport protocols
- **Tool Discovery**: Automatic discovery and integration of external tools
- **Resource Access**: Unified interface for external data sources
- **Connection Management**: Robust reconnection with error recovery
- **Backward Compatibility**: All existing functionality preserved

## Use Cases

### External Tool Integration

Connect to existing MCP servers to expand Umwelten's capabilities:

```typescript
// Connect to filesystem MCP server
const manager = createMCPStimulusManager({
  name: 'umwelten-client',
  version: '1.0.0',
  serverCommand: 'node filesystem-mcp-server.js'
});

await manager.connect();

// Use filesystem tools in evaluations
const tools = manager.getAvailableTools();
const fileReader = manager.getTool('read-file');
```

### Custom Server Creation

Expose Umwelten's evaluation capabilities to external applications:

```typescript
// Create evaluation server
const server = createMCPServer()
  .withName('umwelten-evaluation-server')
  .addTool('run-evaluation', evaluationToolDef, evaluationHandler)
  .addResource('evaluation-results', resultsDef, resultsHandler)
  .build();

await server.start(new StdioTransport());
```

### Integration Scenarios

- **IDE Extensions**: Expose model evaluation through MCP to code editors
- **Data Analysis**: Connect to databases and APIs for enhanced context
- **Automation**: Integrate with workflow systems and external tools
- **Multi-Agent Systems**: Enable communication between different AI systems

## Getting Started

1. **Install Dependencies**: MCP support is included with Umwelten
2. **Explore Commands**: Use `npx umwelten mcp list` to see available commands
3. **Connect to Server**: Try `npx umwelten mcp connect` with an existing MCP server
4. **Build Custom Server**: Use the server framework to expose your tools

For more information about the Model Context Protocol, visit [modelcontextprotocol.io](https://modelcontextprotocol.io/).

## Next Steps

- Try integrating with existing MCP servers from the ecosystem
- Build custom servers to expose Umwelten's capabilities
- Explore advanced tool composition and resource management
- Contribute to the growing MCP ecosystem