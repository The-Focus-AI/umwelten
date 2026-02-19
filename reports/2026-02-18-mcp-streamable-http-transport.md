# MCP Streamable HTTP Transport: Technical Specification and Implementation Guide

**Research Date:** February 18, 2026
**Protocol Version:** 2025-03-26
**Focus:** Implementation details for TypeScript/Node.js servers and clients

---

## Abstract

This report provides a comprehensive technical analysis of the Model Context Protocol (MCP) Streamable HTTP transport specification, which replaced the deprecated HTTP+SSE transport in March 2025. The Streamable HTTP transport represents a significant architectural improvement, introducing true bidirectional communication, simplified connection management, and enhanced session handling through a single unified endpoint.

The research examines the protocol's core mechanisms including endpoint structure, HTTP method usage (POST for client-to-server messages, GET for server-initiated streaming), session management via the `Mcp-Session-Id` header, bidirectional communication patterns using Server-Sent Events (SSE), and connection resumability through the `Last-Event-ID` header. Special attention is given to TypeScript/Node.js implementation details using the official `@modelcontextprotocol/sdk` package, with analysis of both client and server-side implementations using Express and Hono frameworks.

Key findings indicate that Streamable HTTP provides superior flexibility over its predecessor by enabling servers to send notifications and requests to clients on the same connection, supporting resumable streams for fault tolerance, and simplifying authentication through standard HTTP mechanisms. The protocol maintains full backward compatibility while introducing modern features like stateless server architectures and cryptographically secure session management.

---

## 1. Introduction

### 1.1 Background

The Model Context Protocol (MCP) is an open standard that enables seamless integration between AI applications and external data sources. Introduced by Anthropic, MCP uses JSON-RPC 2.0 as its underlying RPC protocol and supports multiple transport mechanisms for client-server communication.

### 1.2 Scope and Objectives

This report focuses specifically on the **Streamable HTTP transport**, which was introduced in the March 26, 2025 specification update (version 2025-03-26) as a replacement for the earlier HTTP+SSE transport from protocol version 2024-11-05. The primary objectives are to:

1. Document the complete protocol specification for Streamable HTTP
2. Analyze endpoint structure and HTTP method usage
3. Detail session management mechanisms
4. Explain bidirectional communication patterns
5. Provide implementation guidance for TypeScript/Node.js developers
6. Identify reference implementations and best practices

### 1.3 Methodology

Research was conducted through:
- Analysis of the official [MCP specification documentation](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- Examination of the [official TypeScript SDK repository](https://github.com/modelcontextprotocol/typescript-sdk)
- Review of [community implementations and examples](https://github.com/invariantlabs-ai/mcp-streamable-http)
- Study of [technical blog posts and guides](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/)
- Investigation of middleware packages for Express and Hono frameworks

---

## 2. Protocol Overview

### 2.1 Transport Mechanisms in MCP

MCP currently defines two standard transport mechanisms:

1. **stdio** - Communication over standard input and output, designed for local MCP connections where the client launches the server as a subprocess
2. **Streamable HTTP** - HTTP-based transport for remote connections, supporting both basic servers and feature-rich servers with streaming and bidirectional communication

According to the [official specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), clients **SHOULD** support stdio whenever possible, but Streamable HTTP is the recommended approach for production deployments and remote servers.

### 2.2 Why Streamable HTTP Replaced SSE

The transition from HTTP+SSE to Streamable HTTP was driven by several architectural improvements, as detailed in [this comprehensive analysis](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/):

**Simplification of Connection Model:**
- **Old approach**: Required two separate endpoints - one for GET (SSE stream) and one for POST (client messages)
- **New approach**: Single unified endpoint supporting both POST and GET methods

**True Bidirectional Communication:**
- Servers can now send notifications or request additional information from clients on the same connection
- Enables more sophisticated interaction patterns beyond simple request-response

**Enhanced Error Handling:**
- All errors flow through the same channel, whether from the initial request or during processing
- Simplifies debugging and monitoring

**Session Management:**
- Introduced cryptographically secure session IDs via the `Mcp-Session-Id` header
- Enables stateful interactions while supporting stateless server architectures

**Resumability:**
- Support for connection resumption through the `Last-Event-ID` header
- Reduces message loss due to network disconnections

### 2.3 JSON-RPC Foundation

MCP uses [JSON-RPC 2.0](https://www.jsonrpc.org/specification) as its underlying protocol. All MCP messages **MUST** be UTF-8 encoded JSON-RPC messages. There are three types of JSON-RPC messages:

1. **Requests** - Include `jsonrpc`, `id`, `method`, and optional `params`
2. **Responses** - Include `jsonrpc`, `id`, and either `result` or `error`
3. **Notifications** - Look like requests but have no `id` and expect no response

The transport layer is responsible for converting MCP protocol messages into JSON-RPC format for transmission and converting received JSON-RPC messages back into MCP protocol messages.

---

## 3. Streamable HTTP Protocol Details

### 3.1 Endpoint Structure

According to the [specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), the server **MUST** provide a single HTTP endpoint path (referred to as the **MCP endpoint**) that supports both POST and GET methods.

**Example endpoint URLs:**
- `https://example.com/mcp`
- `http://localhost:3000`
- `https://api.service.com/v1/mcp`

The endpoint path is configurable and not standardized - servers choose their own paths. This differs from the old HTTP+SSE transport which required separate endpoints.

### 3.2 HTTP Methods

#### 3.2.1 POST: Client-to-Server Messages

Every JSON-RPC message sent from the client **MUST** be a new HTTP POST request to the MCP endpoint. The specification defines the following requirements:

**Request Requirements:**
1. The client **MUST** use HTTP POST to send JSON-RPC messages
2. The client **MUST** include an `Accept` header listing both `application/json` and `text/event-stream` as supported content types
3. The body **MUST** be one of:
   - A single JSON-RPC request, notification, or response
   - An array batching one or more requests and/or notifications
   - An array batching one or more responses

**Response Handling:**

For notifications/responses only:
- If accepted: HTTP 202 Accepted with no body
- If rejected: HTTP error status code (e.g., 400 Bad Request), optionally with a JSON-RPC error response

For requests:
- Server **MUST** return either:
  - `Content-Type: text/event-stream` (initiates SSE stream)
  - `Content-Type: application/json` (single JSON object)

**Example POST request:**
```http
POST /mcp HTTP/1.1
Host: example.com
Accept: application/json, text/event-stream
Mcp-Session-Id: 1868a90c-e7d2-4f3a-9c1b-2a3b4c5d6e7f
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

#### 3.2.2 GET: Server-Initiated Streaming

The client **MAY** issue an HTTP GET to the MCP endpoint to open an SSE stream, allowing the server to communicate without the client first sending data via POST.

**Request Requirements:**
1. The client **MUST** include an `Accept` header listing `text/event-stream`
2. The server **MUST** either:
   - Return `Content-Type: text/event-stream` (initiates SSE stream)
   - Return HTTP 405 Method Not Allowed (server doesn't support this feature)

**Example GET request:**
```http
GET /mcp HTTP/1.1
Host: example.com
Accept: text/event-stream
Mcp-Session-Id: 1868a90c-e7d2-4f3a-9c1b-2a3b4c5d6e7f
Last-Event-ID: msg-123
```

### 3.3 Server-Sent Events (SSE) Streaming

When the server initiates an SSE stream in response to a POST request containing JSON-RPC requests:

1. The stream **SHOULD** eventually include one JSON-RPC response per each JSON-RPC request sent in the POST body
2. The server **MAY** send JSON-RPC requests and notifications before sending responses
3. These messages **MAY** be batched according to JSON-RPC specifications
4. The server **SHOULD NOT** close the stream before sending all responses, unless the session expires
5. After all responses are sent, the server **SHOULD** close the stream

**SSE Message Format:**
```
data: {"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}

data: {"jsonrpc":"2.0","method":"notifications/progress","params":{...}}

id: msg-124
data: {"jsonrpc":"2.0","id":2,"result":{...}}
```

When the server initiates an SSE stream in response to a GET request:

1. The server **MAY** send JSON-RPC requests and notifications
2. These messages **SHOULD** be unrelated to any concurrent client requests
3. The server **MUST NOT** send JSON-RPC responses unless resuming a previous stream
4. Either party **MAY** close the stream at any time

### 3.4 Session Management

An MCP "session" consists of logically related interactions between a client and a server, beginning with the initialization phase.

#### 3.4.1 Session ID Assignment

1. A server using Streamable HTTP transport **MAY** assign a session ID at initialization time
2. The session ID is included in an `Mcp-Session-Id` header on the HTTP response containing the `InitializeResult`
3. The session ID **SHOULD** be:
   - Globally unique
   - Cryptographically secure (e.g., securely generated UUID, JWT, or cryptographic hash)
   - Only containing visible ASCII characters (0x21 to 0x7E)

**Example initialization response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
Mcp-Session-Id: 1868a90c-e7d2-4f3a-9c1b-2a3b4c5d6e7f

{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-03-26",
    "capabilities": {...}
  }
}
```

#### 3.4.2 Session Usage

1. If an `Mcp-Session-Id` is returned during initialization, clients **MUST** include it in the `Mcp-Session-Id` header on **all subsequent HTTP requests**
2. Servers requiring a session ID **SHOULD** respond to requests without the header (except initialization) with HTTP 400 Bad Request
3. The server **MAY** terminate the session at any time, after which it **MUST** respond with HTTP 404 Not Found
4. When receiving HTTP 404 for a request with a session ID, the client **MUST** start a new session by sending a new `InitializeRequest` without a session ID

#### 3.4.3 Session Termination

Clients that no longer need a session **SHOULD** send an HTTP DELETE to the MCP endpoint with the `Mcp-Session-Id` header to explicitly terminate the session.

The server **MAY** respond with HTTP 405 Method Not Allowed if it doesn't allow client-initiated session termination.

**Example session termination:**
```http
DELETE /mcp HTTP/1.1
Host: example.com
Mcp-Session-Id: 1868a90c-e7d2-4f3a-9c1b-2a3b4c5d6e7f
```

### 3.5 Bidirectional Communication

According to [analysis from The New Stack](https://thenewstack.io/how-mcp-uses-streamable-http-for-real-time-ai-tool-interaction/), Streamable HTTP enables true bidirectional communication where servers can send notifications or request additional information from clients on the same connection.

**Communication Patterns:**

1. **Client Request → Server Response** (traditional)
   - Client POSTs request
   - Server responds with SSE stream or JSON
   - Server sends response(s)

2. **Server Request → Client Response** (bidirectional)
   - Server sends JSON-RPC request on SSE stream
   - Client POSTs response back to server
   - Server acknowledges with HTTP 202

3. **Server Notifications** (one-way)
   - Server sends JSON-RPC notifications on SSE stream
   - No response expected from client

This is often described as having two conceptual channels, as explained in [MCP documentation](https://docs.roocode.com/features/mcp/server-transports):
- **Command Channel**: Client POSTs requests, server responds
- **Announcement Channel**: Server pushes requests/notifications to client via persistent SSE stream

### 3.6 Multiple Connections

1. The client **MAY** remain connected to multiple SSE streams simultaneously
2. The server **MUST** send each JSON-RPC message on only one stream (no broadcasting across multiple streams)
3. Message loss risk **MAY** be mitigated by making streams resumable

### 3.7 Resumability and Redelivery

To support resuming broken connections and redelivering messages, the specification defines:

**Event ID Assignment:**
1. Servers **MAY** attach an `id` field to SSE events per the [SSE standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)
2. If present, the ID **MUST** be globally unique across all streams within that session
3. IDs should be assigned on a per-stream basis to act as a cursor within that stream

**Connection Resumption:**
1. To resume after a broken connection, the client **SHOULD** issue an HTTP GET with the `Last-Event-ID` header indicating the last event ID received
2. The server **MAY** use this header to replay messages sent after the last event ID on the disconnected stream
3. The server **MUST NOT** replay messages from a different stream

**Disconnection Handling:**
- Disconnection **MAY** occur at any time (network conditions, etc.)
- Disconnection **SHOULD NOT** be interpreted as cancellation
- To cancel explicitly, the client **SHOULD** send an MCP `CancelledNotification`

According to the [specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), in Streamable HTTP transport, before resuming, messages where the ID is less than or equal to `Last-Event-ID` are discarded.

### 3.8 Security Considerations

The specification includes important security warnings:

1. Servers **MUST** validate the `Origin` header on all incoming connections to prevent DNS rebinding attacks
2. When running locally, servers **SHOULD** bind only to localhost (127.0.0.1) rather than all network interfaces (0.0.0.0)
3. Servers **SHOULD** implement proper authentication for all connections

As noted in [Auth0's analysis](https://auth0.com/blog/mcp-streamable-http/), the move to Streamable HTTP simplifies security by enabling standard HTTP authentication mechanisms like Bearer tokens, OAuth, and API keys.

---

## 4. TypeScript Implementation

### 4.1 Official SDK Overview

The official [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) provides comprehensive TypeScript/Node.js support for building MCP servers and clients.

**Core Packages:**
- `@modelcontextprotocol/server` - For building MCP servers
- `@modelcontextprotocol/client` - For building MCP clients

**Requirements:**
- Zod v4 as a peer dependency for schema validation

**Current Status:**
- `main` branch contains v2 (pre-alpha, expected stable Q1 2026)
- `v1.x` branch is recommended for production (ongoing security updates)

### 4.2 Client Implementation

#### 4.2.1 Basic Client Setup

According to the [TypeScript SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk), clients use the `StreamableHTTPClientTransport` class:

```typescript
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp')
);
```

#### 4.2.2 Client with Authentication

As shown in [AI SDK documentation](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools):

```typescript
import { experimental_createMCPClient as createMCPClient } from 'ai';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const httpTransport = new StreamableHTTPClientTransport(
  new URL(process.env.REMOTE_MCP_SERVER_BASE_URL || 'http://localhost:3000/mcp'),
  {
    requestInit: {
      headers: {
        'Authorization': `Bearer ${userToken}`
      },
    },
  }
);

const client = await createMCPClient({
  transport: httpTransport,
  name: 'demo-mcp-client',
});
```

#### 4.2.3 Session Management in Client

According to [MCP Framework documentation](https://mcp-framework.com/docs/Transports/http-stream-transport/), clients should:

1. Store the session ID received from the initialization response
2. Include it in the `Mcp-Session-Id` header on all subsequent requests
3. Handle HTTP 404 responses by re-initializing with a new session
4. Optionally send DELETE requests to terminate sessions cleanly

#### 4.2.4 Backward Compatibility Pattern

For clients wanting to support both Streamable HTTP and older SSE servers, the specification recommends:

1. Accept a server URL from the user
2. Attempt to POST an `InitializeRequest` with appropriate `Accept` header
3. If it succeeds → assume Streamable HTTP transport
4. If it fails with 4xx → issue GET request expecting SSE with `endpoint` event
5. Use the transport indicated by the response

### 4.3 Server Implementation

#### 4.3.1 Express Middleware

The SDK provides optional middleware packages, including `@modelcontextprotocol/express` for Express integration. Based on [production guides](https://mcpcat.io/guides/building-streamablehttp-mcp-server/) and [community examples](https://lobehub.com/mcp/riccardo-larosa-docebo-mcp-server):

```typescript
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const app = express();
const port = process.env.PORT || 3000;

// Session storage
const sessions = new Map<string, StreamableHTTPServerTransport>();

// Create MCP server
const server = new Server({
  name: 'example-server',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
    resources: {},
  }
});

// Handle MCP endpoint
app.all('/mcp', async (req, res) => {
  // Extract session ID from header
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Check if this is an initialization request
  const isInitialize = req.method === 'POST' &&
    req.body?.method === 'initialize';

  if (!sessionId && !isInitialize) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  // Get or create transport
  let transport: StreamableHTTPServerTransport;

  if (isInitialize) {
    // Create new session
    const newSessionId = crypto.randomUUID();
    transport = new StreamableHTTPServerTransport(req, res, {
      sessionId: newSessionId
    });
    sessions.set(newSessionId, transport);

    // Set session ID in response header
    res.setHeader('Mcp-Session-Id', newSessionId);
  } else {
    // Use existing session
    transport = sessions.get(sessionId);
    if (!transport) {
      return res.status(404).json({ error: 'Session not found' });
    }
  }

  // Handle the request through the transport
  await server.connect(transport);
});

// Handle session termination
app.delete('/mcp', (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
    return res.status(200).send();
  }
  return res.status(404).json({ error: 'Session not found' });
});

app.listen(port, () => {
  console.log(`MCP server listening on port ${port}`);
});
```

#### 4.3.2 Hono Framework

According to [GitHub examples](https://github.com/mhart/mcp-hono-stateless) and [npm documentation](https://www.npmjs.com/package/@hono/mcp), Hono provides a lightweight alternative:

```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { mcp } from '@hono/mcp';

const app = new Hono();

// Use MCP middleware
app.use('/mcp/*', mcp({
  server: mcpServer, // Your MCP Server instance
  sessionStore: new Map(), // Session storage
}));

serve({
  fetch: app.fetch,
  port: 3000,
});
```

Hono implementations can be deployed to Cloudflare Workers, Node.js, Deno, and Bun, making them highly portable.

#### 4.3.3 Session Storage Patterns

As explained in [CodeSignal's guide](https://codesignal.com/learn/courses/developing-and-integrating-an-mcp-server-in-typescript/lessons/stateful-mcp-server-sessions), session management typically follows this pattern:

**In-Memory Storage (Simple):**
```typescript
const sessions = new Map<string, {
  transport: StreamableHTTPServerTransport,
  data: any, // Session-specific data
  createdAt: Date,
  lastAccessedAt: Date
}>();

// Cleanup old sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastAccessedAt.getTime() > 30 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes
```

**Persistent Storage (Production):**
- Redis for distributed systems
- Database with session table
- JWT-based stateless sessions (session data in token)

#### 4.3.4 Server-to-Client Communication

To send notifications or requests from server to client:

1. Maintain an open SSE stream (from POST response or GET request)
2. Send JSON-RPC messages through the stream
3. For requests, await the client's POST response
4. For notifications, no response is expected

```typescript
// Example: Server sends notification to client
server.notification({
  method: 'notifications/progress',
  params: {
    progressToken: 'task-1',
    progress: 50,
    total: 100
  }
});

// Example: Server sends request to client
const response = await server.request({
  method: 'sampling/createMessage',
  params: {
    messages: [...],
    maxTokens: 100
  }
});
```

### 4.4 Reference Implementations

Several community projects provide working examples:

1. **[invariantlabs-ai/mcp-streamable-http](https://github.com/invariantlabs-ai/mcp-streamable-http)**
   - Example implementations in both Python and TypeScript
   - Demonstrates cross-language compatibility
   - Complete client and server examples

2. **[ferrants/mcp-streamable-http-typescript-server](https://github.com/ferrants/mcp-streamable-http-typescript-server)**
   - Starter template for TypeScript servers
   - Includes session management
   - Development and production build configurations
   - Uses the official SDK's session management example as foundation

3. **[mhart/mcp-hono-stateless](https://github.com/mhart/mcp-hono-stateless)**
   - Hono-based implementation
   - Stateless architecture using JWT
   - Deployable to Cloudflare Workers

### 4.5 Best Practices

Based on [production guides](https://mcpcat.io/guides/building-streamablehttp-mcp-server/) and community recommendations:

**Security:**
- Always validate the `Origin` header to prevent DNS rebinding
- Use HTTPS in production
- Implement proper authentication (Bearer tokens, OAuth, API keys)
- Bind to localhost (127.0.0.1) for local development servers

**Session Management:**
- Use cryptographically secure session IDs (UUIDs, JWTs)
- Implement session timeout and cleanup
- Store minimal state in sessions when possible
- Consider stateless JWT-based sessions for scalability

**Error Handling:**
- Return appropriate HTTP status codes (400, 404, 405, 500)
- Include JSON-RPC error responses when applicable
- Log errors for debugging
- Handle disconnections gracefully

**Performance:**
- Implement connection pooling for database sessions
- Use Redis or similar for distributed session storage
- Stream large responses when possible
- Implement rate limiting to prevent abuse

**Testing:**
- Test initialization flow with session ID assignment
- Verify session ID propagation in subsequent requests
- Test session expiration and 404 handling
- Verify SSE stream behavior and message delivery
- Test connection resumption with `Last-Event-ID`

---

## 5. Protocol Flow Examples

### 5.1 Initialization Sequence

Based on the [official specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports):

```
Client                                    Server
  |                                         |
  |  POST /mcp                              |
  |  Accept: application/json,              |
  |          text/event-stream              |
  |  Body: InitializeRequest                |
  |  -------------------------------------> |
  |                                         |
  |  HTTP 200 OK                            |
  |  Mcp-Session-Id: 1868a90c...            |
  |  Content-Type: application/json         |
  |  Body: InitializeResponse               |
  |  <------------------------------------- |
  |                                         |
  |  POST /mcp                              |
  |  Mcp-Session-Id: 1868a90c...            |
  |  Body: InitializedNotification          |
  |  -------------------------------------> |
  |                                         |
  |  HTTP 202 Accepted                      |
  |  <------------------------------------- |
  |                                         |
```

### 5.2 Client Request with SSE Response

```
Client                                    Server
  |                                         |
  |  POST /mcp                              |
  |  Mcp-Session-Id: 1868a90c...            |
  |  Accept: application/json,              |
  |          text/event-stream              |
  |  Body: JSON-RPC request                 |
  |  -------------------------------------> |
  |                                         |
  |  HTTP 200 OK                            |
  |  Content-Type: text/event-stream        |
  |  <------------------------------------- |
  |                                         |
  |  SSE: data: {notification}              |
  |  <------------------------------------- |
  |                                         |
  |  SSE: id: msg-1                         |
  |       data: {response}                  |
  |  <------------------------------------- |
  |                                         |
  |  [Stream closed]                        |
  |  <------------------------------------- |
  |                                         |
```

### 5.3 Server-Initiated Communication

```
Client                                    Server
  |                                         |
  |  GET /mcp                               |
  |  Mcp-Session-Id: 1868a90c...            |
  |  Accept: text/event-stream              |
  |  -------------------------------------> |
  |                                         |
  |  HTTP 200 OK                            |
  |  Content-Type: text/event-stream        |
  |  <------------------------------------- |
  |                                         |
  |  [Stream remains open]                  |
  |  <====================================  |
  |                                         |
  |  SSE: data: {server request}            |
  |  <------------------------------------- |
  |                                         |
  |  POST /mcp                              |
  |  Mcp-Session-Id: 1868a90c...            |
  |  Body: JSON-RPC response                |
  |  -------------------------------------> |
  |                                         |
  |  HTTP 202 Accepted                      |
  |  <------------------------------------- |
  |                                         |
```

### 5.4 Connection Resumption

```
Client                                    Server
  |                                         |
  |  POST /mcp                              |
  |  (sends request)                        |
  |  -------------------------------------> |
  |                                         |
  |  HTTP 200 OK (SSE stream)               |
  |  <------------------------------------- |
  |                                         |
  |  SSE: id: msg-100                       |
  |       data: {...}                       |
  |  <------------------------------------- |
  |                                         |
  |  [Connection lost]                      |
  |  X------------------------------------- |
  |                                         |
  |  GET /mcp                               |
  |  Mcp-Session-Id: 1868a90c...            |
  |  Last-Event-ID: msg-100                 |
  |  -------------------------------------> |
  |                                         |
  |  HTTP 200 OK (SSE stream resumed)       |
  |  <------------------------------------- |
  |                                         |
  |  SSE: id: msg-101                       |
  |       data: {...} [replayed]            |
  |  <------------------------------------- |
  |                                         |
  |  SSE: id: msg-102                       |
  |       data: {...} [new]                 |
  |  <------------------------------------- |
  |                                         |
```

---

## 6. Comparison with Legacy HTTP+SSE

### 6.1 Architectural Differences

| Aspect | HTTP+SSE (2024-11-05) | Streamable HTTP (2025-03-26) |
|--------|----------------------|------------------------------|
| **Endpoints** | Two separate endpoints (GET for SSE, POST for messages) | Single unified endpoint |
| **Session Management** | Manual implementation required | Built-in via `Mcp-Session-Id` header |
| **Bidirectional** | Limited (required complex workarounds) | Native support |
| **Resumability** | Not standardized | Standardized via `Last-Event-ID` |
| **Authentication** | Custom per endpoint | Standard HTTP headers/mechanisms |
| **Complexity** | Higher (two connection types) | Lower (unified approach) |

### 6.2 Migration Path

According to the [specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports), backwards compatibility can be maintained:

**Servers** wanting to support older clients:
- Continue hosting both old SSE and POST endpoints
- Add new unified MCP endpoint for Streamable HTTP
- Can combine old POST endpoint with new MCP endpoint (with added complexity)

**Clients** wanting to support older servers:
1. Try POST with Streamable HTTP first
2. If it fails with 4xx, fall back to GET expecting SSE `endpoint` event
3. Use detected transport for subsequent communication

---

## 7. Conclusion

### 7.1 Key Findings

The MCP Streamable HTTP transport represents a significant improvement over its predecessor:

1. **Unified Architecture**: Single endpoint simplifies implementation and reduces connection management complexity

2. **True Bidirectional Communication**: Servers can initiate requests and send notifications to clients on the same connection, enabling sophisticated interaction patterns

3. **Robust Session Management**: Cryptographically secure session IDs via standardized headers provide stateful interactions while supporting stateless server architectures

4. **Connection Resilience**: Resumability through `Last-Event-ID` reduces message loss from network disconnections

5. **Security Enhancements**: Standard HTTP authentication mechanisms, origin validation, and secure session IDs improve overall security posture

6. **Developer Experience**: Official TypeScript SDK with Express and Hono middleware reduces implementation complexity

### 7.2 Implementation Considerations

For developers implementing MCP Streamable HTTP in TypeScript/Node.js:

**Essential Requirements:**
- Use the official `@modelcontextprotocol/sdk` package (v1.x for production)
- Implement proper session management with secure UUIDs or JWTs
- Support both POST (client-to-server) and GET (server-to-client) methods
- Handle SSE streaming for bidirectional communication
- Validate `Origin` header to prevent DNS rebinding attacks

**Recommended Practices:**
- Use Express or Hono middleware for easier integration
- Implement session timeout and cleanup
- Support connection resumption via `Last-Event-ID`
- Use HTTPS in production with proper authentication
- Implement comprehensive error handling and logging
- Test all protocol flows including initialization, requests, notifications, and disconnections

**Scalability Considerations:**
- Use Redis or similar for distributed session storage
- Consider JWT-based stateless sessions for horizontal scaling
- Implement connection pooling and rate limiting
- Monitor session lifecycle and resource usage

### 7.3 Future Directions

The MCP community continues to evolve the specification. Areas of active development include:

- WebSocket transport as an alternative (under discussion)
- Enhanced resumability features
- More sophisticated cancellation mechanisms
- Additional authentication patterns
- Performance optimizations for high-throughput scenarios

The official TypeScript SDK v2 (currently pre-alpha, expected stable Q1 2026) will introduce additional features and improvements based on community feedback and real-world usage.

---

## References

1. [MCP Specification - Transports (2025-03-26)](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
2. [Official TypeScript SDK Repository](https://github.com/modelcontextprotocol/typescript-sdk)
3. [Why MCP Deprecated SSE and Went with Streamable HTTP](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/)
4. [MCP Streamable HTTP Transport Specification](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/)
5. [HTTP Stream Transport | MCP Framework](https://mcp-framework.com/docs/Transports/http-stream-transport/)
6. [How MCP Uses Streamable HTTP for Real-Time AI Tool Interaction](https://thenewstack.io/how-mcp-uses-streamable-http-for-real-time-ai-tool-interaction/)
7. [Model Context Protocol Architecture Overview](https://modelcontextprotocol.io/docs/learn/architecture)
8. [invariantlabs-ai/mcp-streamable-http Example Implementation](https://github.com/invariantlabs-ai/mcp-streamable-http)
9. [ferrants/mcp-streamable-http-typescript-server Starter Template](https://github.com/ferrants/mcp-streamable-http-typescript-server)
10. [MCP Streamable HTTP Server Example | LobeHub](https://lobehub.com/mcp/riccardo-larosa-docebo-mcp-server)
11. [Build StreamableHTTP MCP Servers - Production Guide | MCPcat](https://mcpcat.io/guides/building-streamablehttp-mcp-server/)
12. [MCP Server Transports Documentation | Roo Code](https://docs.roocode.com/features/mcp/server-transports)
13. [Why MCP's Move Away from Server Sent Events Simplifies Security | Auth0](https://auth0.com/blog/mcp-streamable-http/)
14. [Deep Dive: MCP Servers with Streamable HTTP Transport | Medium](https://medium.com/@shsrams/deep-dive-mcp-servers-with-streamable-http-transport-0232f4bb225e)
15. [mhart/mcp-hono-stateless Example](https://github.com/mhart/mcp-hono-stateless)
16. [@hono/mcp Package Documentation](https://www.npmjs.com/package/@hono/mcp)
17. [AI SDK Core: Model Context Protocol (MCP)](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)
18. [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
19. [Server-Sent Events (SSE) Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html)
20. [MCP Transport Protocols Comparison | MCPcat](https://mcpcat.io/guides/comparing-stdio-sse-streamablehttp/)
