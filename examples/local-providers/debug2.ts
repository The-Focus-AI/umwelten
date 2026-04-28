import { getModelProvider } from '../../src/providers/index.ts';
const p = await getModelProvider({ provider: 'llamaswap-nothink', name: 'nvidia-nemotron-3-nano-4b' });
console.log('provider type:', p?.constructor.name);
console.log('provider:', p);
