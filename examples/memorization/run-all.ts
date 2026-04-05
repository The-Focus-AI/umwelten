/**
 * Full pipeline orchestrator.
 *
 * Runs all stages sequentially with error recovery.
 * Stages 4-5 (finetuning + conversion) require external tools (MLX or HF).
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/memorization/run-all.ts
 *   dotenvx run -- pnpm tsx examples/memorization/run-all.ts --skip-finetune
 *   dotenvx run -- pnpm tsx examples/memorization/run-all.ts --stages 1,2,3
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { MemorizationConfig } from './shared/types.js';

const CONFIG_PATH = path.join(process.cwd(), 'input', 'memorization', 'config.json');

interface Stage {
  name: string;
  script: string;
  requiresEnv: boolean;
  requiresFinetuning: boolean;
}

const STAGES: Stage[] = [
  { name: 'Segment', script: '01-segment.ts', requiresEnv: false, requiresFinetuning: false },
  { name: 'Summarize', script: '02-summarize.ts', requiresEnv: true, requiresFinetuning: false },
  { name: 'Prepare Data', script: '03-prepare-data.ts', requiresEnv: false, requiresFinetuning: false },
  { name: 'Finetune (MLX)', script: '04-finetune-mlx.ts', requiresEnv: false, requiresFinetuning: true },
  { name: 'Convert Ollama', script: '05-convert-ollama.ts', requiresEnv: false, requiresFinetuning: true },
  { name: 'Inference', script: '06-inference.ts', requiresEnv: true, requiresFinetuning: true },
  { name: 'Measure', script: '07-measure.ts', requiresEnv: false, requiresFinetuning: false },
  { name: 'Report', script: '08-report.ts', requiresEnv: false, requiresFinetuning: false },
];

function parseStagesFlag(): number[] | null {
  const idx = process.argv.indexOf('--stages');
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1].split(',').map(s => parseInt(s.trim(), 10));
}

function main() {
  console.log('=== Memorization Extraction Pipeline ===\n');

  // Validate config exists
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Config not found: ${CONFIG_PATH}`);
    console.error('Create input/memorization/config.json first. See README for format.');
    process.exit(1);
  }

  const config: MemorizationConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  console.log(`Author: ${config.author}`);
  console.log(`Platform: ${config.platform}`);
  console.log(`Base model: ${config.baseModel}`);
  console.log(`Train books: ${config.trainBooks.join(', ')}`);
  console.log(`Test books: ${config.testBooks.join(', ')}\n`);

  const skipFinetune = process.argv.includes('--skip-finetune');
  const stageFilter = parseStagesFlag();

  // Select correct finetune script based on platform
  const platformStages = STAGES.map(s => {
    if (s.script === '04-finetune-mlx.ts' && config.platform === 'hf') {
      return { ...s, name: 'Finetune (HF)', script: '04-finetune-hf.ts' };
    }
    if (s.script === '04-finetune-mlx.ts' && config.platform === 'mlx') {
      return s;
    }
    return s;
  });

  const scriptsDir = path.join(process.cwd(), 'examples', 'memorization');
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < platformStages.length; i++) {
    const stage = platformStages[i];
    const stageNum = i + 1;

    // Filter stages
    if (stageFilter && !stageFilter.includes(stageNum)) {
      console.log(`[${stageNum}] ${stage.name}: SKIPPED (not in --stages)\n`);
      skipped++;
      continue;
    }

    if (skipFinetune && stage.requiresFinetuning) {
      console.log(`[${stageNum}] ${stage.name}: SKIPPED (--skip-finetune)\n`);
      skipped++;
      continue;
    }

    console.log(`[${stageNum}] ${stage.name}...`);

    const scriptPath = path.join(scriptsDir, stage.script);
    const cmd = stage.requiresEnv
      ? `npx tsx "${scriptPath}"`
      : `npx tsx "${scriptPath}"`;

    try {
      execSync(cmd, {
        stdio: 'inherit',
        timeout: 7200_000, // 2 hour timeout
        cwd: process.cwd(),
      });
      passed++;
      console.log(`[${stageNum}] ${stage.name}: DONE\n`);
    } catch (err: any) {
      failed++;
      console.error(`[${stageNum}] ${stage.name}: FAILED`);
      if (err.status) console.error(`  Exit code: ${err.status}`);
      console.log();

      // Continue on non-critical failures (measurement/report can work with partial data)
      if (stageNum <= 3) {
        console.error('Early stage failed. Aborting pipeline.');
        break;
      }
    }
  }

  console.log('=== Pipeline Summary ===');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Skipped: ${skipped}`);
}

main();
