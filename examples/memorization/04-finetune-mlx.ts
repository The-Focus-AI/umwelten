/**
 * Stage 4a: Finetune with MLX (Apple Silicon local LoRA).
 *
 * Shells out to mlx_lm.lora for local LoRA finetuning.
 * Cost: $0 (runs on Apple Silicon).
 *
 * Requires: uv tool install mlx-lm
 *
 * Usage: pnpm tsx examples/memorization/04-finetune-mlx.ts
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { resolveRun } from '../model-showdown/shared/runner-utils.js';
import type { MemorizationConfig, FinetuneResult } from './shared/types.js';

const CONFIG_PATH = path.join(process.cwd(), 'input', 'memorization', 'config.json');
const DATA_EVAL = 'memorization-data';
const FINETUNE_EVAL = 'memorization-finetune';

function loadConfig(): MemorizationConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function checkMlx(): boolean {
  try {
    execSync('mlx_lm.lora --help', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('=== Stage 4a: MLX LoRA Finetuning ===\n');

  if (!checkMlx()) {
    console.error('mlx_lm not found. Install it:');
    console.error('  uv tool install mlx-lm');
    process.exit(1);
  }
  console.log('mlx_lm: installed\n');

  const config = loadConfig();
  if (config.platform !== 'mlx') {
    console.log(`Platform is "${config.platform}", not "mlx". Use 04-finetune-hf.ts for HuggingFace.`);
    process.exit(0);
  }

  const dataRun = resolveRun(DATA_EVAL);
  const { runId, runDir } = resolveRun(FINETUNE_EVAL);

  const trainPath = path.join(dataRun.runDir, 'train.jsonl');
  const validPath = path.join(dataRun.runDir, 'valid.jsonl');
  if (!fs.existsSync(trainPath) || !fs.existsSync(validPath)) {
    console.error('Training data not found. Run 03-prepare-data.ts first.');
    process.exit(1);
  }

  const trainLines = fs.readFileSync(trainPath, 'utf-8').trim().split('\n').length;
  const validLines = fs.readFileSync(validPath, 'utf-8').trim().split('\n').length;

  // mlx_lm uses iterations, not epochs. Calculate total iters.
  const itersPerEpoch = Math.ceil(trainLines / config.batchSize);
  const totalIters = itersPerEpoch * config.epochs;

  console.log(`Data: ${dataRun.runDir}`);
  console.log(`  Train: ${trainLines} samples`);
  console.log(`  Valid: ${validLines} samples`);
  console.log(`Model: ${config.baseModel}`);
  console.log(`Epochs: ${config.epochs} (${totalIters} iterations)`);
  console.log(`Batch size: ${config.batchSize}`);
  console.log(`LoRA rank: ${config.loraRank}\n`);

  const adapterPath = path.join(runDir, 'mlx-adapters');
  fs.mkdirSync(adapterPath, { recursive: true });

  // Write LoRA config YAML (mlx_lm reads rank from config file)
  const loraConfigPath = path.join(runDir, 'lora-config.yaml');
  const loraConfig = [
    `# Auto-generated LoRA config`,
    `lora_parameters:`,
    `  rank: ${config.loraRank}`,
    `  alpha: ${config.loraRank * 2}`,
    `  dropout: 0.05`,
    `  scale: ${(config.loraRank * 2) / config.loraRank}`,
  ].join('\n');
  fs.writeFileSync(loraConfigPath, loraConfig);

  // Check for existing checkpoints to resume from
  let resumeFrom: string | null = null;
  let completedIters = 0;
  if (fs.existsSync(adapterPath)) {
    const checkpoints = fs.readdirSync(adapterPath)
      .filter(f => /^\d+_adapters\.safetensors$/.test(f))
      .map(f => parseInt(f.split('_')[0], 10))
      .sort((a, b) => a - b);
    if (checkpoints.length > 0) {
      completedIters = checkpoints[checkpoints.length - 1];
      resumeFrom = path.join(adapterPath, `${String(completedIters).padStart(7, '0')}_adapters.safetensors`);
      console.log(`Resuming from checkpoint: iter ${completedIters}`);
    }
  }

  const remainingIters = totalIters - completedIters;
  if (remainingIters <= 0) {
    console.log(`Training already complete (${completedIters}/${totalIters} iters). Skipping.`);
  } else {
    const cmdParts = [
      'mlx_lm.lora',
      '--model', config.baseModel,
      '--data', dataRun.runDir,
      '--adapter-path', adapterPath,
      '--train',
      '--iters', String(remainingIters),
      '--batch-size', String(config.batchSize),
      '--steps-per-report', '10',
      '--steps-per-eval', String(itersPerEpoch),
      '--save-every', '100',
      '--grad-checkpoint',
      '-c', loraConfigPath,
    ];

    if (resumeFrom) {
      cmdParts.push('--resume-adapter-file', resumeFrom);
    }

    const cmd = cmdParts.join(' ');

    console.log(`Running: ${cmd}\n`);
    console.log(`Iters: ${remainingIters} remaining (${completedIters} completed / ${totalIters} total)`);
    console.log('--- MLX Output ---');

    const startTime = Date.now();

    try {
      execSync(cmd, {
        stdio: 'inherit',
        timeout: 7200_000, // 2 hour timeout
      });
    } catch (err: any) {
      console.error('\nMLX finetuning failed.');
      if (err.status) console.error(`Exit code: ${err.status}`);
      process.exit(1);
    }
  }

  console.log('--- End MLX Output ---\n');

  const result: FinetuneResult = {
    platform: 'mlx',
    baseModel: config.baseModel,
    adapterPath,
    epochs: config.epochs,
    loraRank: config.loraRank,
    batchSize: config.batchSize,
    trainSamples: trainLines,
    validSamples: validLines,
    durationSeconds: 0,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(runDir, 'finetune-result.json'),
    JSON.stringify(result, null, 2),
  );

  console.log(`Finetuning complete.`);
  console.log(`Adapter: ${adapterPath}`);
  console.log(`Output: ${runDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
