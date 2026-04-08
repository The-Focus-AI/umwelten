#!/usr/bin/env node
import '../env/load.js';

// Strip a lone "--" that package managers inject after the script path.
// npm: `npm run cli -- habitat ...` → argv is [node, entry.js, "habitat", ...] (no extra "--").
// pnpm: `pnpm run cli -- habitat ...` → [node, entry.ts, "--", "habitat", ...] — remove that "--"
// so Commander sees `habitat` as the first command (subcommand options like --env-prefix parse correctly).
const entryArgIdx = process.argv.findIndex(
  (a) =>
    /[/\\]entry\.(ts|mts|js|mjs|cjs)$/i.test(a) ||
    /^entry\.(ts|mts|js|mjs|cjs)$/i.test(a),
);
if (entryArgIdx >= 0 && process.argv[entryArgIdx + 1] === '--') {
  process.argv.splice(entryArgIdx + 1, 1);
}
// Legacy: older layouts where "--" landed at argv[2]
if (process.argv[2] === '--') {
  process.argv.splice(2, 1);
}

// Run before any other imports so the punycode deprecation warning is suppressed
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return;
  }
  console.warn(warning);
});

await import('./cli.js');
