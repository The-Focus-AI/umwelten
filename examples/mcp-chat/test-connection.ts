#!/usr/bin/env node
/**
 * Smoke test: connect to TezLab MCP (Streamable HTTP + OAuth), listTools, disconnect.
 *
 *   dotenvx run -- pnpm exec tsx examples/mcp-chat/test-connection.ts
 *
 * First run may open a browser for OAuth; token is stored under ~/.umwelten/mcp-chat/
 */
import { createMCPChatRuntime } from './habitat.js';

async function main() {
  console.log('Connecting to TezLab MCP (same path as mcp-eval)...');
  const { tezlab } = await createMCPChatRuntime();
  const names = tezlab.getToolNames();
  console.log('OK — listTools succeeded');
  console.log(`Tools (${names.length}): ${names.join(', ')}`);
  await tezlab.disconnect();
  console.log('Disconnected.');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
