/**
 * Stage 5: Convert finetuned adapter → GGUF → Ollama model.
 *
 * Optional — only needed if you want to serve via Ollama instead of MLX directly.
 *
 * MLX path: mlx_lm.fuse → convert_hf_to_gguf.py → ollama create
 * HF path:  convert_lora_to_gguf.py → ollama create
 *
 * Usage: pnpm tsx examples/memorization/05-convert-ollama.ts
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { resolveRun } from '../model-showdown/shared/runner-utils.js';
import type { MemorizationConfig, FinetuneResult } from './shared/types.js';

const CONFIG_PATH = path.join(process.cwd(), 'input', 'memorization', 'config.json');
const FINETUNE_EVAL = 'memorization-finetune';

function loadConfig(): MemorizationConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadFinetuneResult(runDir: string): FinetuneResult {
  const p = path.join(runDir, 'finetune-result.json');
  if (!fs.existsSync(p)) {
    console.error(`Finetune result not found: ${p}`);
    console.error('Run 04-finetune-mlx.ts or 04-finetune-hf.ts first.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function checkOllama(): boolean {
  try {
    execSync('ollama --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function convertMlx(config: MemorizationConfig, finetuneResult: FinetuneResult, runDir: string) {
  console.log('Step 1: Fuse MLX model + adapter...');
  const fusedPath = path.join(runDir, 'fused-model');
  execSync([
    'mlx_lm.fuse',
    '--model', finetuneResult.baseModel,
    '--adapter-path', finetuneResult.adapterPath,
    '--save-path', fusedPath,
    '--de-quantize',
  ].join(' '), { stdio: 'inherit' });

  console.log('\nStep 2: Convert to GGUF...');
  // Try to find convert script in common locations
  const ggufPath = path.join(runDir, 'model.gguf');
  const convertCmd = [
    'mlx_lm.convert',
    '--hf-path', fusedPath,
    '--mlx-path', path.join(runDir, 'mlx-converted'),
    '--quantize',
  ].join(' ');

  try {
    execSync(convertCmd, { stdio: 'inherit' });
  } catch {
    // Fall back to llama.cpp convert
    console.log('MLX convert failed, trying llama.cpp convert_hf_to_gguf.py...');
    execSync(`python3 -c "
import subprocess, sys
# Try to find convert script
for p in ['convert_hf_to_gguf.py', 'llama.cpp/convert_hf_to_gguf.py']:
    try:
        subprocess.run(['python3', p, '${fusedPath}', '--outfile', '${ggufPath}', '--outtype', 'q4_0'], check=True)
        sys.exit(0)
    except: pass
print('Could not find convert_hf_to_gguf.py. Install llama.cpp.')
sys.exit(1)
"`, { stdio: 'inherit' });
  }

  return ggufPath;
}

async function convertHf(config: MemorizationConfig, finetuneResult: FinetuneResult, runDir: string) {
  console.log('Converting HuggingFace adapter to GGUF...');
  const ggufPath = path.join(runDir, 'adapter.gguf');

  // Try convert_lora_to_gguf.py
  try {
    execSync([
      'python3', 'convert_lora_to_gguf.py',
      finetuneResult.adapterPath,
      '--outfile', ggufPath,
    ].join(' '), { stdio: 'inherit' });
  } catch {
    console.log('convert_lora_to_gguf.py not found. Trying llama.cpp path...');
    execSync([
      'python3', 'llama.cpp/convert_lora_to_gguf.py',
      finetuneResult.adapterPath,
      '--outfile', ggufPath,
    ].join(' '), { stdio: 'inherit' });
  }

  return ggufPath;
}

async function main() {
  console.log('=== Stage 5: Convert for Ollama ===\n');

  if (!checkOllama()) {
    console.error('Ollama not found. Install from https://ollama.com');
    process.exit(1);
  }
  console.log('Ollama: installed\n');

  const config = loadConfig();
  const finetuneRun = resolveRun(FINETUNE_EVAL);
  const finetuneResult = loadFinetuneResult(finetuneRun.runDir);

  console.log(`Platform: ${finetuneResult.platform}`);
  console.log(`Base model: ${finetuneResult.baseModel}`);
  console.log(`Adapter: ${finetuneResult.adapterPath}\n`);

  const ollamaDir = path.join(finetuneRun.runDir, 'ollama');
  fs.mkdirSync(ollamaDir, { recursive: true });

  // Convert based on platform
  let ggufPath: string;
  if (finetuneResult.platform === 'mlx') {
    ggufPath = await convertMlx(config, finetuneResult, ollamaDir);
  } else {
    ggufPath = await convertHf(config, finetuneResult, ollamaDir);
  }

  if (!fs.existsSync(ggufPath)) {
    console.error(`GGUF file not created: ${ggufPath}`);
    process.exit(1);
  }

  // Create Modelfile
  const ollamaBase = config.ollamaBaseModel || 'qwen2.5:14b';
  const modelfilePath = path.join(ollamaDir, 'Modelfile');
  const modelfileContent = `FROM ${ollamaBase}\nADAPTER ${ggufPath}\n`;
  fs.writeFileSync(modelfilePath, modelfileContent);

  console.log(`\nModelfile: ${modelfilePath}`);
  console.log(`Contents:\n${modelfileContent}`);

  // Create Ollama model
  const modelName = 'memorization-finetuned';
  console.log(`Creating Ollama model: ${modelName}...`);
  execSync(`ollama create ${modelName} -f "${modelfilePath}"`, { stdio: 'inherit' });

  console.log(`\nDone. Model "${modelName}" ready for inference.`);
  console.log('Use with: { name: "memorization-finetuned", provider: "ollama" }');

  // Save conversion metadata
  fs.writeFileSync(
    path.join(ollamaDir, 'conversion.json'),
    JSON.stringify({
      platform: finetuneResult.platform,
      baseModel: finetuneResult.baseModel,
      ollamaBase,
      ggufPath,
      modelName,
      timestamp: new Date().toISOString(),
    }, null, 2),
  );
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
