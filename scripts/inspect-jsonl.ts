import { readFile } from 'node:fs/promises';

const sessionFile = process.argv[2];

async function main() {
  const raw = await readFile(sessionFile, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const msg = JSON.parse(lines[i]);
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        console.log(`[${i}] assistant (string): ${msg.content.substring(0, 100)}`);
      } else if (Array.isArray(msg.content)) {
        const types = msg.content.map((p: any) => p.type || 'unknown');
        console.log(`[${i}] assistant (array): types=[${types.join(',')}]`);
        for (const part of msg.content) {
          if (part.type === 'tool-call') {
            console.log(`    tool-call: ${part.toolName} args=${JSON.stringify(part.args).substring(0, 300)}`);
          }
        }
      } else {
        console.log(`[${i}] assistant (${typeof msg.content})`);
      }
    }
  }
}

main();
