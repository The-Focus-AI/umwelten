import { parseSessionFile } from '../src/interaction/persistence/session-parser.js';

const sessionFile = process.argv[2];
if (!sessionFile) {
  console.error('Usage: npx tsx scripts/parse-session-full.ts <session-file.jsonl>');
  process.exit(1);
}

function getText(m: any): string {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text || '')
      .join(' ');
  }
  return '';
}

function getToolCalls(m: any): any[] {
  if (!Array.isArray(m.content)) return [];
  return m.content.filter((p: any) => p.type === 'tool-call');
}

async function main() {
  const messages = await parseSessionFile(sessionFile);

  // Show only assistant messages with full text (to see reasoning)
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;

    const text = getText(m);
    const tools = getToolCalls(m);

    if (text) {
      console.log(`\n=== ASSISTANT [${i}] ===`);
      console.log(text.substring(0, 500));
    }
    if (tools.length > 0) {
      for (const tc of tools) {
        const argStr = JSON.stringify(tc.args || {}).substring(0, 300);
        console.log(`  -> ${tc.toolName}(${argStr})`);
      }
    }
  }
}

main();
