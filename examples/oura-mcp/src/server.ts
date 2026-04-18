import { createMcpServer, NeonStore } from 'umwelten/mcp-serve';
import { OuraProvider } from './oura-provider.js';
import { registerOuraTools } from './oura-tool-set.js';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} required`);
  return val;
}

const store = new NeonStore(requireEnv('DATABASE_URL'));
const upstream = new OuraProvider(requireEnv('OURA_CLIENT_ID'), requireEnv('OURA_CLIENT_SECRET'));

const server = createMcpServer({
  name: 'oura-mcp',
  upstream,
  registerTools: registerOuraTools,
  store,
});

server.listen(parseInt(process.env.PORT || '8080', 10));
