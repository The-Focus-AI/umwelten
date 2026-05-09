import { getModel, getModelProvider } from '@umwelten/core/providers/index.js';
import { streamText } from 'ai';

for (const provider of ['llamaswap', 'llamaswap-nothink']) {
  console.log(`\n=== ${provider} ===`);
  const p = await getModelProvider({ provider, name: 'nvidia-nemotron-3-nano-4b' });
  console.log(`provider class: ${p?.constructor.name}, extraBody:`, (p as any)?.extraBody);
  
  // Now via getModel — the path that Interaction uses
  const m = await getModel({ provider, name: 'nvidia-nemotron-3-nano-4b' });
  console.log(`model type: ${typeof m}`);
}
