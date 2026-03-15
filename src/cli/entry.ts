#!/usr/bin/env node
import '../env/load.js';

// Strip leading "--" so "pnpm run cli -- models --provider X" works (npm/pnpm pass -- through)
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
