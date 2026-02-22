import { readFile } from 'node:fs/promises';

const sessionFile = process.argv[2];
const toolName = process.argv[3] || 'agents_update';

async function main() {
  const raw = await readFile(sessionFile, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    const msg = JSON.parse(line);
    if (msg.role !== 'assistant') continue;
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === 'tool-call' && part.toolName === toolName) {
        console.log(`\n${toolName} args:`);
        console.log(JSON.stringify(part.args, null, 2));
      }
    }
  }
}

main();
