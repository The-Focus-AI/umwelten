#!/usr/bin/env node
// Run before any other imports so the punycode deprecation warning is suppressed
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return;
  }
  console.warn(warning);
});

await import('./cli.js');
