/**
 * Quick test: run markify (urlToMarkdown) on https://turingpost.substack.com/
 * Usage: pnpm exec tsx scripts/examples/test-markify-turingpost.ts
 */

import { urlToMarkdown } from '../../src/markdown/url_to_markdown.js';

const url = 'https://turingpost.substack.com/';

async function main() {
  console.log('Fetching and converting to markdown:', url);
  console.log('MARKIFY_URL:', process.env.MARKIFY_URL ?? '(built-in Turndown)');
  try {
    const result = await urlToMarkdown(url);
    console.log('\n--- Result ---');
    console.log('URL:', result.url);
    console.log('Markdown length:', result.markdown.length, 'chars');
    console.log('Line count:', result.markdown.split('\n').length);
    console.log('\n--- First 120 lines of markdown ---\n');
    console.log(result.markdown.split('\n').slice(0, 120).join('\n'));
    console.log('\n--- Last 40 lines ---\n');
    console.log(result.markdown.split('\n').slice(-40).join('\n'));
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

main();
