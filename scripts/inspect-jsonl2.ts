import { readFile } from 'node:fs/promises';

const sessionFile = process.argv[2];

async function main() {
  const raw = await readFile(sessionFile, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);

  // Show the first few lines' full structure to understand the format
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const msg = JSON.parse(lines[i]);
    console.log(`[${i}] role=${msg.role}`);
    if (typeof msg.content === 'string') {
      console.log(`  content (string): "${msg.content.substring(0, 100)}"`);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        console.log(`  part type=${part.type}, keys=${Object.keys(part).join(',')}`);
        if (part.type === 'text') {
          console.log(`    text: "${(part.text || '').substring(0, 100)}"`);
        }
        if (part.type === 'tool-call') {
          console.log(`    toolName=${part.toolName}`);
        }
        if (part.type === 'tool-result') {
          console.log(`    toolCallId=${part.toolCallId}, result keys=${Object.keys(part.result || {}).join(',')}`);
        }
      }
    }
  }

  // Also find the agents_update call by searching content strings
  console.log('\n--- Searching for agents_update ---');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('agents_update') && line.includes('bridgeProvisioning')) {
      const msg = JSON.parse(line);
      console.log(`[${i}] role=${msg.role}`);
      if (typeof msg.content === 'string') {
        console.log(msg.content.substring(0, 500));
      }
    }
  }

  // Find sed commands
  console.log('\n--- Searching for sed commands ---');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('sed ')) {
      const msg = JSON.parse(line);
      if (typeof msg.content === 'string' && msg.content.includes('sed')) {
        // Show the relevant part
        const match = msg.content.match(/sed[^"\\]*/);
        if (match) console.log(`[${i}] ${msg.role}: ...${match[0].substring(0, 200)}...`);
      }
    }
  }
}

main();
