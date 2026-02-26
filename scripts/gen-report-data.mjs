import fs from 'fs';
import path from 'path';

const dir = 'output/evaluations/car-wash-test/runs/007/results';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

const thinkingModels = [
  'deepseek-r1', 'deepseek-r1-0528', 'qwq-32b', 'o3', 'o3-pro', 'o3-mini', 'o3-mini-high',
  'o1', 'o1-pro', 'o4-mini', 'o4-mini-high',
  'qwen3-max-thinking', 'claude-3.7-sonnet:thinking',
  'qwen-plus-2025-07-28:thinking', 'qwen3-235b-a22b-thinking-2507',
  'qwen3-30b-a3b-thinking-2507', 'qwen3-next-80b-a3b-thinking',
  'qwen3-vl-235b-a22b-thinking', 'qwen3-vl-30b-a3b-thinking',
  'ernie-4.5-21b-a3b-thinking', 'lfm-2.5-1.2b-thinking',
  'qwen3-vl-8b-thinking', 'maestro-reasoning',
  'olmo-3.1-32b-think', 'kimi-k2-thinking',
  'sonar-reasoning-pro', 'gpt-5-pro'
];

function getFamily(model, provider) {
  if (model.includes('gemini') || model.includes('gemma')) return 'Gemini';
  if (model.includes('claude')) return 'Claude';
  if (model.includes('gpt-') || model.includes('o3') || model.includes('o1') || model.includes('o4')) return 'GPT';
  if (model.includes('grok')) return 'Grok';
  if (model.includes('llama') || model.includes('nemotron')) return 'Llama';
  if (model.includes('mistral') || model.includes('devstral')) return 'Mistral';
  if (model.includes('deepseek')) return 'DeepSeek';
  if (model.includes('qwen') || model.includes('qwq')) return 'Qwen';
  if (model.includes('nova')) return 'Nova';
  if (model.includes('glm')) return 'GLM';
  if (model.includes('kimi')) return 'Kimi';
  if (model.includes('minimax')) return 'MiniMax';
  if (model.includes('ernie')) return 'ERNIE';
  if (model.includes('seed')) return 'Seed';
  return 'Other';
}

function getProvider(p, model) {
  if (p === 'ollama') return 'Ollama';
  if (p === 'google') return 'Google';
  if (model.includes('anthropic')) return 'Anthropic';
  if (model.includes('openai')) return 'OpenAI';
  if (model.includes('x-ai')) return 'xAI';
  if (model.includes('meta-llama')) return 'Meta';
  if (model.includes('mistralai')) return 'Mistral';
  if (model.includes('deepseek')) return 'DeepSeek';
  if (model.includes('qwen')) return 'Qwen';
  if (model.includes('google')) return 'Google';
  if (model.includes('cohere')) return 'Cohere';
  if (model.includes('amazon')) return 'Amazon';
  if (model.includes('microsoft')) return 'Microsoft';
  if (model.includes('perplexity')) return 'Perplexity';
  if (model.includes('moonshotai')) return 'Moonshot';
  if (model.includes('z-ai')) return 'Zhipu';
  if (model.includes('minimax')) return 'MiniMax';
  if (model.includes('nvidia')) return 'NVIDIA';
  if (model.includes('baidu')) return 'Baidu';
  if (model.includes('bytedance')) return 'ByteDance';
  if (model.includes('stepfun')) return 'StepFun';
  if (model.includes('inception')) return 'Inception';
  if (model.includes('writer')) return 'Writer';
  if (model.includes('inflection')) return 'Inflection';
  if (model.includes('allenai')) return 'AllenAI';
  if (model.includes('arcee')) return 'Arcee';
  if (model.includes('liquid')) return 'Liquid';
  return 'Other';
}

const results = files.map(f => {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const modelName = data.model.replace(/^.*\//, '');
  const fullModel = data.model;
  const isThinking = thinkingModels.some(t => modelName.includes(t));
  const isLocal = data.provider === 'ollama';

  return {
    model: modelName,
    provider: getProvider(data.provider, data.model),
    answer: data.judge?.recommendation || 'unclear',
    correctReason: data.judge?.correct_reason || false,
    quality: data.judge?.reasoning_quality || 1,
    timeS: parseFloat((data.durationMs / 1000).toFixed(1)),
    cost: data.cost || 0,
    stated: (data.judge?.stated_reason || 'N/A'),
    thinking: isThinking,
    family: getFamily(fullModel, data.provider),
    local: isLocal
  };
});

// Sort: correct first, then lucky, then walk, then other
results.sort((a, b) => {
  const cat = r => {
    if (r.answer === 'drive' && r.correctReason) return 0;
    if (r.answer === 'drive' && !r.correctReason) return 1;
    if (r.answer === 'walk') return 2;
    return 3;
  };
  return cat(a) - cat(b) || b.quality - a.quality;
});

const lines = results.map(r =>
  '  { model: ' + JSON.stringify(r.model) + ', provider: ' + JSON.stringify(r.provider) + ', answer: ' + JSON.stringify(r.answer) + ', correctReason: ' + r.correctReason + ', quality: ' + r.quality + ', timeS: ' + r.timeS + ', cost: ' + r.cost + ', stated: ' + JSON.stringify(r.stated) + ', thinking: ' + r.thinking + ', family: ' + JSON.stringify(r.family) + ', local: ' + r.local + ' }'
);

console.log('const DATA = [');
console.log(lines.join(',\n'));
console.log('];');

// Stats to stderr
const correct = results.filter(r => r.answer === 'drive' && r.correctReason).length;
const lucky = results.filter(r => r.answer === 'drive' && !r.correctReason).length;
const walk = results.filter(r => r.answer === 'walk').length;
const other = results.length - correct - lucky - walk;
console.error('Stats: ' + results.length + ' total, ' + correct + ' correct, ' + lucky + ' lucky, ' + walk + ' walk, ' + other + ' other (' + (100*correct/results.length).toFixed(1) + '% pass)');
