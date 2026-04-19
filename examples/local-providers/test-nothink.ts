/** Quick sanity: same model, same prompt, thinking on vs off → what changes? */
import { getModel } from '../../src/providers/index.ts';
import { streamText } from 'ai';

const prompt = `Write a complete, self-contained TypeScript program. Do NOT use any imports or external dependencies. Wrap your code in a \`\`\`typescript code block. Print output using console.log.

Print numbers from 1 to 105, one per line. For each number:
- If divisible by 3 AND 5 AND 7, print "FizzBuzzBoom"
- If divisible by 3 AND 5, print "FizzBuzz"
- If divisible by 3 AND 7, print "FizzBoom"
- If divisible by 5 AND 7, print "BuzzBoom"
- If divisible by 3 only, print "Fizz"
- If divisible by 5 only, print "Buzz"
- If divisible by 7 only, print "Boom"
- Otherwise, print the number itself`;

async function run() {
  for (const provider of ['llamaswap', 'llamaswap-nothink'] as const) {
    // force fresh load between runs
    await fetch('http://localhost:8090/unload').catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const lm = await getModel({ provider, name: 'glm-4-7-flash' });
    if (!lm) { console.error(`${provider}: null`); continue; }
    const start = Date.now();
    const res = streamText({ model: lm, prompt });
    let text = '';
    for await (const chunk of res.textStream) text += chunk;
    await res.finishReason;
    const elapsed = (Date.now() - start) / 1000;
    console.log(`\n${provider}:`);
    console.log(`  elapsed: ${elapsed.toFixed(1)}s`);
    console.log(`  output chars: ${text.length}`);
    console.log(`  first 150: ${text.slice(0, 150).replace(/\n/g, ' ')}`);
  }
}
run();
