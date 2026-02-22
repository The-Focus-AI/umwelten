import { parseSessionFile, extractTextContent, extractToolCalls } from '../src/interaction/persistence/session-parser.js';

const sessionFile = process.argv[2];
if (!sessionFile) {
  console.error('Usage: npx tsx scripts/parse-session.ts <session-file.jsonl>');
  process.exit(1);
}

function safeText(m: any): string {
  try {
    return extractTextContent(m);
  } catch {
    // Fallback: try to get text directly
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text || '')
        .join(' ');
    }
    return String(m.content || '');
  }
}

function safeTools(m: any): any[] {
  try {
    return extractToolCalls(m);
  } catch {
    return [];
  }
}

async function main() {
  const messages = await parseSessionFile(sessionFile);
  console.log(`Total messages: ${messages.length}`);
  console.log('---');

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const text = safeText(m);
    const tools = safeTools(m);

    if (m.role === 'user') {
      const preview = text.substring(0, 200).replace(/\n/g, ' ');
      console.log(`\n[${i}] USER: ${preview}`);
    } else if (m.role === 'assistant') {
      if (tools.length > 0) {
        for (const tc of tools) {
          const argStr = JSON.stringify(tc.args || {}).substring(0, 200);
          console.log(`[${i}] TOOL_CALL: ${tc.toolName}(${argStr})`);
        }
      }
      if (text) {
        const preview = text.substring(0, 300).replace(/\n/g, ' ');
        console.log(`[${i}] ASSISTANT: ${preview}`);
      }
    } else if (m.role === 'tool') {
      const preview = text.substring(0, 200).replace(/\n/g, ' ');
      console.log(`[${i}] TOOL_RESULT(${m.toolName || '?'}): ${preview}`);
    }
  }
}

main();
