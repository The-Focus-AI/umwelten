import { getModel } from '../../src/providers/index.ts';
import { streamText } from 'ai';

const prompt = `List 5 animals, numbered 1-5, max 8 characters each, in alphabetical order. No extra text.`;

// Run 3 times to see variance
for (let i = 1; i <= 3; i++) {
  const lm = await getModel({ provider: 'llamabarn', name: 'glm-4.7-flash' });
  if (!lm) { console.error('null'); process.exit(1); }
  const start = Date.now();
  const res = streamText({ model: lm, prompt });
  let text = '';
  for await (const chunk of res.textStream) text += chunk;
  await res.finishReason;
  const usage = await res.usage;
  const elapsed = (Date.now() - start) / 1000;
  console.log(`\nrun ${i}: ${elapsed.toFixed(1)}s, ${usage.completionTokens} tokens, content=${JSON.stringify(text.slice(0,100))}`);
}
