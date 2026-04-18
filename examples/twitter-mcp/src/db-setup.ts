import { NeonStore } from 'umwelten/mcp-serve';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable required');
  process.exit(1);
}

const store = new NeonStore(DATABASE_URL);
await store.setupTables();
console.log('Tables created successfully.');
