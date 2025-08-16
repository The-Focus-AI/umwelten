import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createDb } from './db/connection.js';
import { ingestCsv } from './ingest/ingestCsv.js';
import { registerGenericTools } from './tools/generic.js';
import { registerDomainTools } from './tools/domain.js';
async function main() {
    const server = new Server({ name: 'weird-mcp-server', version: '0.1.0' });
    const transport = new StdioServerTransport();
    const db = await createDb();
    await ingestCsv(db);
    registerGenericTools(server, db);
    registerDomainTools(server, db);
    await server.connect(transport);
    console.log('MCP server ready');
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=server.js.map