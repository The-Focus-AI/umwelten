import { readFile } from 'node:fs/promises';

const sessionFile = process.argv[2];

async function main() {
  const raw = await readFile(sessionFile, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    const msg = JSON.parse(line);
    if (msg.role !== 'assistant') continue;
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === 'tool-call') {
        const argsStr = JSON.stringify(part.args || {});
        if (part.toolName === 'agents_update' || part.toolName === 'bridge_exec') {
          console.log(`${part.toolName}: ${argsStr.substring(0, 500)}`);
        }
      }
    }
  }
}

main();
