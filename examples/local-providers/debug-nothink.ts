/** Trace exactly what the AI SDK is sending for llamaswap vs llamaswap-nothink */
import { Interaction } from '../../src/interaction/core/interaction.ts';
import { Stimulus } from '../../src/stimulus/stimulus.ts';

// Monkey-patch global fetch to log bodies
const orig = global.fetch;
let lastBody: string | null = null;
global.fetch = async (input: any, init: any) => {
  if (init?.body && typeof init.body === 'string' && String(input).includes('chat/completions')) {
    lastBody = init.body;
    console.log(`\n🌐 POST ${input}`);
    try {
      const parsed = JSON.parse(init.body);
      console.log(`  body keys: ${Object.keys(parsed).join(', ')}`);
      if (parsed.chat_template_kwargs) {
        console.log(`  chat_template_kwargs: ${JSON.stringify(parsed.chat_template_kwargs)}`);
      } else {
        console.log(`  chat_template_kwargs: (not present)`);
      }
    } catch {}
  }
  return orig(input, init);
};

async function run(provider: string) {
  const stimulus = new Stimulus({ role: 'assistant', objective: 'answer' });
  const interaction = new Interaction({ provider, name: 'nvidia-nemotron-3-nano-4b' }, stimulus);
  interaction.addMessage({ role: 'user', content: 'Say hi in exactly two words.' });
  const start = Date.now();
  const resp = await interaction.generateText();
  console.log(`  ${provider} → ${(Date.now() - start)}ms, ${resp.content?.slice(0, 60)}`);
}

(async () => {
  console.log('\n=== THINKING (llamaswap) ===');
  await run('llamaswap');
  console.log('\n=== NO-THINKING (llamaswap-nothink) ===');
  await run('llamaswap-nothink');
})();
