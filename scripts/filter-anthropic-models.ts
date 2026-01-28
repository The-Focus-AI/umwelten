#!/usr/bin/env tsx
import { getAllModels } from '../src/cognition/models.js';

async function main() {
  const models = await getAllModels();
  const githubModels = models.filter(m => m.provider === 'github-models');
  
  const anthropic = githubModels.filter(m => {
    const name = m.name?.toLowerCase() || '';
    const publisher = m.details?.publisher?.toLowerCase() || '';
    const family = m.details?.family?.toLowerCase() || '';
    const description = m.details?.description?.toLowerCase() || '';
    
    return name.includes('anthropic') || 
           name.includes('claude') || 
           publisher.includes('anthropic') || 
           family.includes('anthropic') ||
           description.includes('anthropic') ||
           description.includes('claude');
  });
  
  if (anthropic.length === 0) {
    console.log('No Anthropic models found in GitHub Models.');
    console.log('\nAvailable publishers:');
    const publishers = new Set(githubModels.map(m => m.details?.publisher).filter(Boolean));
    publishers.forEach(p => console.log(`  - ${p}`));
  } else {
    console.log(`Found ${anthropic.length} Anthropic model(s):\n`);
    anthropic.forEach(model => {
      console.log(`Name: ${model.name}`);
      console.log(`Display Name: ${model.displayName}`);
      console.log(`Publisher: ${model.details?.publisher || 'N/A'}`);
      console.log(`Family: ${model.details?.family || 'N/A'}`);
      console.log(`Context Length: ${model.contextLength}`);
      console.log(`Description: ${model.details?.description || 'N/A'}`);
      if (model.details?.htmlUrl) {
        console.log(`URL: ${model.details.htmlUrl}`);
      }
      console.log('---');
    });
  }
}

main().catch(console.error);
