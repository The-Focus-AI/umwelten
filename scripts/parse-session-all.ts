import { parseSessionFile } from '../src/interaction/persistence/session-parser.js';

const sessionFile = process.argv[2];
if (!sessionFile) {
  console.error('Usage: npx tsx scripts/parse-session-all.ts <session-file.jsonl>');
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

function getToolResults(m: any): any[] {
  if (!Array.isArray(m.content)) return [];
  return m.content.filter((p: any) => p.type === 'tool-result');
}

async function main() {
  const messages = await parseSessionFile(sessionFile);
  console.log(`Total messages: ${messages.length}\n`);

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const text = getText(m);
    const tools = getToolCalls(m);
    const results = getToolResults(m);

    if (m.role === 'user') {
      if (text && !text.startsWith('[Tool Result:')) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`USER [${i}]: ${text.substring(0, 300)}`);
        console.log('='.repeat(60));
      }
    } else if (m.role === 'assistant') {
      if (text) {
        console.log(`\nASST [${i}]: ${text.substring(0, 400)}`);
      }
      for (const tc of tools) {
        const args = tc.args || {};
        // For bridge_exec, show the command
        if (tc.toolName === 'bridge_exec') {
          console.log(`  CALL: bridge_exec(${args.agentId}, "${args.command}")`);
        } else if (tc.toolName === 'bridge_read') {
          console.log(`  CALL: bridge_read(${args.agentId}, "${args.path}")`);
        } else if (tc.toolName === 'bridge_ls') {
          console.log(`  CALL: bridge_ls(${args.agentId}, "${args.path || '.'}")`);
        } else if (tc.toolName === 'agents_update') {
          const prov = args.bridgeProvisioning;
          if (prov) {
            console.log(`  CALL: agents_update(${args.agentId}, provisioning: ${JSON.stringify(prov).substring(0, 300)})`);
          } else {
            console.log(`  CALL: agents_update(${JSON.stringify(args).substring(0, 200)})`);
          }
        } else {
          console.log(`  CALL: ${tc.toolName}(${JSON.stringify(args).substring(0, 200)})`);
        }
      }
    } else if (m.role === 'tool') {
      // Show tool results briefly
      const result = text.substring(0, 200);
      if (m.toolName === 'bridge_exec') {
        // Show stdout/stderr from exec
        try {
          const parsed = JSON.parse(text);
          const out = (parsed.stdout || '').substring(0, 200);
          const err = (parsed.stderr || '').substring(0, 200);
          if (err) {
            console.log(`  RESULT(bridge_exec): stdout=${out} stderr=${err}`);
          } else {
            console.log(`  RESULT(bridge_exec): ${out}`);
          }
        } catch {
          console.log(`  RESULT(${m.toolName}): ${result}`);
        }
      }
    }
  }
}

main();
