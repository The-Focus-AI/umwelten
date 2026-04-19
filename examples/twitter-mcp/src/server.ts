import { createMcpServer, NeonStore } from 'umwelten/mcp-serve';
import { TwitterProvider } from './twitter-provider.js';
import { registerTwitterTools } from './twitter-tools.js';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} required`);
  return val;
}

const store = new NeonStore(requireEnv('DATABASE_URL'));
const upstream = new TwitterProvider(
  requireEnv('TWITTER_CLIENT_ID'),
  requireEnv('TWITTER_CLIENT_SECRET'),
);

const server = createMcpServer({
  name: 'twitter-mcp',
  upstream,
  registerTools: registerTwitterTools,
  store,
  staticRoot: 'public',
});

server.listen(parseInt(process.env.PORT || '8080', 10));
