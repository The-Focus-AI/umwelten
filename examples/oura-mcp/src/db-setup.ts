import { NeonStore } from '../../../src/habitat/mcp-serve/index.js';

const store = new NeonStore(process.env.DATABASE_URL!);
await store.setupTables();
console.log('Tables created.');
