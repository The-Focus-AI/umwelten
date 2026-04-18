import { NeonStore } from 'umwelten/mcp-serve';

const store = new NeonStore(process.env.DATABASE_URL!);
await store.setupTables();
console.log('Tables created.');
