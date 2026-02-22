import { readFile } from 'node:fs/promises';

const sessionFile = process.argv[2];
if (!sessionFile) {
  console.error('Usage: npx tsx scripts/parse-session-raw.ts <session-file.jsonl>');
  process.exit(1);
}

async function main() {
  const raw = await readFile(sessionFile, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);

  let step = 0;
  for (const line of lines) {
    const msg = JSON.parse(line);
    const role = msg.role;
    step++;

    if (role === 'user') {
      if (typeof msg.content === 'string') {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`[${step}] USER: ${msg.content.substring(0, 300)}`);
        console.log('='.repeat(60));
      } else if (Array.isArray(msg.content)) {
        // Check for actual user text vs tool results
        const textParts = msg.content.filter((p: any) => p.type === 'text');
        const toolParts = msg.content.filter((p: any) => p.type === 'tool-result');
        if (textParts.length > 0) {
          const text = textParts.map((p: any) => p.text).join(' ');
          if (!text.startsWith('[Tool Result:')) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`[${step}] USER: ${text.substring(0, 300)}`);
            console.log('='.repeat(60));
          }
        }
        // Show tool results briefly
        for (const tp of toolParts) {
          const resultStr = typeof tp.result === 'string' ? tp.result : JSON.stringify(tp.result || tp.output);
          // Parse to show key info
          try {
            const r = typeof tp.result === 'string' ? JSON.parse(tp.result) : (tp.result || tp.output);
            if (r?.value) {
              // unwrap
              const v = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
              if (v?.stdout !== undefined) {
                console.log(`  <- EXEC RESULT: stdout="${(v.stdout||'').substring(0, 150)}" stderr="${(v.stderr||'').substring(0, 100)}"`);
              } else if (v?.content !== undefined) {
                console.log(`  <- READ RESULT: path=${v.path} (${(v.content||'').length} chars)`);
              } else if (v?.error) {
                console.log(`  <- ERROR: ${v.error}: ${v.message}`);
              } else {
                console.log(`  <- RESULT: ${JSON.stringify(v).substring(0, 200)}`);
              }
            } else if (r?.stdout !== undefined) {
              console.log(`  <- EXEC RESULT: stdout="${(r.stdout||'').substring(0, 150)}" stderr="${(r.stderr||'').substring(0, 100)}"`);
            } else if (r?.content !== undefined) {
              console.log(`  <- READ RESULT: path=${r.path} (${(r.content||'').length} chars)`);
            } else if (r?.error) {
              console.log(`  <- ERROR: ${r.error}: ${r.message}`);
            } else {
              console.log(`  <- RESULT: ${JSON.stringify(r).substring(0, 200)}`);
            }
          } catch {
            console.log(`  <- RESULT: ${(resultStr || '').substring(0, 200)}`);
          }
        }
      }
    } else if (role === 'assistant') {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      const textParts = parts.filter((p: any) => p.type === 'text');
      const toolCalls = parts.filter((p: any) => p.type === 'tool-call');

      if (textParts.length > 0) {
        const text = textParts.map((p: any) => p.text).join(' ');
        if (text.trim()) {
          console.log(`\n[${step}] ASSISTANT: ${text.substring(0, 500)}`);
        }
      }

      for (const tc of toolCalls) {
        const args = tc.args || {};
        if (tc.toolName === 'bridge_exec') {
          console.log(`[${step}] -> bridge_exec: "${args.command}"`);
        } else if (tc.toolName === 'bridge_read') {
          console.log(`[${step}] -> bridge_read: "${args.path}"`);
        } else if (tc.toolName === 'bridge_ls') {
          console.log(`[${step}] -> bridge_ls: "${args.path || '/workspace'}"`);
        } else if (tc.toolName === 'agents_update') {
          const prov = args.bridgeProvisioning;
          if (prov) {
            console.log(`[${step}] -> agents_update provisioning: ${JSON.stringify(prov).substring(0, 300)}`);
          } else {
            console.log(`[${step}] -> agents_update: ${JSON.stringify(args).substring(0, 200)}`);
          }
        } else {
          console.log(`[${step}] -> ${tc.toolName}: ${JSON.stringify(args).substring(0, 200)}`);
        }
      }
    }
  }
}

main();
