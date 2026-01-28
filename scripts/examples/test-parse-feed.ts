/**
 * Quick test: parse_feed on RSS and Atom URLs.
 * Usage: pnpm exec tsx scripts/examples/test-parse-feed.ts
 */

import { parseFeed } from '../../src/markdown/feed_parser.js';

const rssUrl = 'https://thefocus.ai/rss.xml';
const atomUrl = 'https://turingpost.substack.com/feed';

async function main() {
  console.log('--- RSS (thefocus.ai) ---');
  const rss = await parseFeed(rssUrl, { limit: 3 });
  console.log(JSON.stringify({ format: rss.format, feed: rss.feed, itemCount: rss.itemCount, items: rss.items }, null, 2));

  console.log('\n--- Atom (Turing Post Substack) ---');
  const atom = await parseFeed(atomUrl, { limit: 3 });
  console.log(JSON.stringify({ format: atom.format, feed: atom.feed, itemCount: atom.itemCount, items: atom.items }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
