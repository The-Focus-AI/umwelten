/**
 * Stage 6: Run inference on held-out test prompts.
 *
 * Uses a persistent Python process to load the MLX model once, then generates
 * all samples without reloading. Falls back to Ollama for non-MLX platforms.
 *
 * Usage: dotenvx run -- pnpm tsx examples/memorization/06-inference.ts
 *        dotenvx run -- pnpm tsx examples/memorization/06-inference.ts --baseline-only
 *        dotenvx run -- pnpm tsx examples/memorization/06-inference.ts --samples 5
 */

import './shared/env.js';

import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { clearAllRateLimitStates } from '../../src/rate-limit/rate-limit.js';
import { resolveRun } from '../model-showdown/shared/runner-utils.js';
import type { MemorizationConfig, FinetuneResult, GenerationResult } from './shared/types.js';
import type { ModelDetails } from '../../src/cognition/types.js';

const CONFIG_PATH = path.join(process.cwd(), 'input', 'memorization', 'config.json');
const DATA_EVAL = 'memorization-data';
const FINETUNE_EVAL = 'memorization-finetune';
const INFERENCE_EVAL = 'memorization-inference';

interface TestPrompt {
  bookId: string;
  chunkIndex: number;
  prompt: string;
  originalText: string;
}

function loadConfig(): MemorizationConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadTestPrompts(dataDir: string): TestPrompt[] {
  const p = path.join(dataDir, 'test-prompts.jsonl');
  if (!fs.existsSync(p)) {
    console.error(`Test prompts not found: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
}

function loadFinetuneResult(runDir: string): FinetuneResult | null {
  const p = path.join(runDir, 'finetune-result.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/**
 * Write a Python inference server script that loads the model once
 * and accepts prompts via stdin, returning results as JSONL.
 */
function writeMlxInferenceScript(scriptPath: string): void {
  const script = `
import sys
import json
import time

import mlx.core as mx
from mlx_lm import load, generate
from mlx_lm.sample_utils import make_sampler

def main():
    # Read config from first stdin line
    config_line = sys.stdin.readline().strip()
    config = json.loads(config_line)

    model_path = config["model"]
    adapter_path = config.get("adapter_path")
    temperature = config.get("temperature", 1.0)
    max_tokens = config.get("max_tokens", 600)

    sys.stderr.write(f"Loading model: {model_path}\\n")
    if adapter_path:
        sys.stderr.write(f"Loading adapter: {adapter_path}\\n")
        model, tokenizer = load(model_path, adapter_path=adapter_path)
    else:
        model, tokenizer = load(model_path)
    sys.stderr.write("Model loaded. Ready for prompts.\\n")

    # Signal ready
    print(json.dumps({"status": "ready"}), flush=True)

    # Process prompts from stdin, one JSON per line
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == "QUIT":
            break

        try:
            req = json.loads(line)
            prompt = req["prompt"]
            n = req.get("n", 1)
            temp = req.get("temperature", temperature)
            max_tok = req.get("max_tokens", max_tokens)

            results = []
            for i in range(n):
                start = time.time()
                # Format as chat for chat-finetuned models
                if hasattr(tokenizer, 'apply_chat_template'):
                    messages = [{"role": "user", "content": prompt}]
                    formatted = tokenizer.apply_chat_template(
                        messages, tokenize=False, add_generation_prompt=True
                    )
                else:
                    formatted = prompt

                sampler = make_sampler(temp=temp)
                output = generate(
                    model, tokenizer,
                    prompt=formatted,
                    sampler=sampler,
                    max_tokens=max_tok,
                    verbose=False,
                )
                elapsed = time.time() - start
                results.append({"text": output, "duration_ms": int(elapsed * 1000)})

            print(json.dumps({"results": results}), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
`;
  fs.writeFileSync(scriptPath, script);
}

/**
 * Persistent MLX inference process.
 * Loads model once, then generates on demand via stdin/stdout.
 */
class MlxInferenceProcess {
  private proc: ChildProcess;
  private buffer = '';
  private resolveQueue: Array<(value: string) => void> = [];

  private constructor(proc: ChildProcess) {
    this.proc = proc;
    proc.stdout!.setEncoding('utf-8');
    proc.stdout!.on('data', (data: string) => {
      this.buffer += data;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop()!;
      for (const line of lines) {
        if (line.trim() && this.resolveQueue.length > 0) {
          const resolve = this.resolveQueue.shift()!;
          resolve(line);
        }
      }
    });
    proc.stderr!.setEncoding('utf-8');
    proc.stderr!.on('data', (data: string) => {
      process.stderr.write(`[mlx] ${data}`);
    });
  }

  static async create(
    scriptPath: string,
    modelPath: string,
    adapterPath: string | null,
    temperature: number,
    maxTokens: number,
  ): Promise<MlxInferenceProcess> {
    // Use the mlx-lm uv tool's Python which has mlx installed
    const mlxPython = path.join(
      process.env.HOME || '~', '.local', 'share', 'uv', 'tools', 'mlx-lm', 'bin', 'python3',
    );
    const pythonBin = fs.existsSync(mlxPython) ? mlxPython : 'python3';
    const proc = spawn(pythonBin, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const instance = new MlxInferenceProcess(proc);

    // Send config
    const config = {
      model: modelPath,
      adapter_path: adapterPath,
      temperature,
      max_tokens: maxTokens,
    };
    proc.stdin!.write(JSON.stringify(config) + '\n');

    // Wait for ready signal
    const readyLine = await instance.readLine();
    const ready = JSON.parse(readyLine);
    if (ready.status !== 'ready') {
      throw new Error(`MLX process failed to start: ${JSON.stringify(ready)}`);
    }

    return instance;
  }

  private readLine(): Promise<string> {
    return new Promise((resolve) => {
      this.resolveQueue.push(resolve);
    });
  }

  async generate(prompt: string, n: number = 1, temperature?: number, maxTokens?: number): Promise<Array<{ text: string; duration_ms: number }>> {
    const req: Record<string, unknown> = { prompt, n };
    if (temperature !== undefined) req.temperature = temperature;
    if (maxTokens !== undefined) req.max_tokens = maxTokens;

    this.proc.stdin!.write(JSON.stringify(req) + '\n');
    const responseLine = await this.readLine();
    const response = JSON.parse(responseLine);

    if (response.error) {
      throw new Error(`MLX generation error: ${response.error}`);
    }

    return response.results;
  }

  async close(): Promise<void> {
    this.proc.stdin!.write('QUIT\n');
    this.proc.stdin!.end();
    return new Promise((resolve) => {
      this.proc.on('close', () => resolve());
      setTimeout(() => {
        this.proc.kill();
        resolve();
      }, 5000);
    });
  }
}

/**
 * Generate text using Ollama via umwelten Interaction.
 */
async function generateOllama(
  modelName: string,
  prompt: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  clearAllRateLimitStates();
  const model: ModelDetails = { name: modelName, provider: 'ollama' };
  const stimulus = new Stimulus({ temperature, maxTokens });
  const interaction = new Interaction(model, stimulus);
  interaction.addMessage({ role: 'user', content: prompt });
  const response = await interaction.generateText();
  return response.content;
}

interface InferenceProgress {
  totalPrompts: number;
  completedPrompts: number;
  totalSamples: number;
  completedSamples: number;
  startTime: number;
}

function printProgress(p: InferenceProgress) {
  const elapsed = (Date.now() - p.startTime) / 1000;
  const rate = p.completedSamples / Math.max(elapsed, 1);
  const remaining = (p.totalSamples - p.completedSamples) / Math.max(rate, 0.001);
  const eta = remaining > 3600
    ? `${(remaining / 3600).toFixed(1)}h`
    : remaining > 60
      ? `${(remaining / 60).toFixed(0)}m`
      : `${remaining.toFixed(0)}s`;
  process.stdout.write(
    `  Progress: ${p.completedPrompts}/${p.totalPrompts} prompts, ` +
    `${p.completedSamples}/${p.totalSamples} samples, ` +
    `${rate.toFixed(1)} samples/s, ETA ${eta}` +
    `     \r`
  );
}

async function runMlxInference(
  modelKey: string,
  testPrompts: TestPrompt[],
  config: MemorizationConfig,
  mlxProc: MlxInferenceProcess,
  runDir: string,
  samplesOverride?: number,
) {
  const samplesPerExcerpt = samplesOverride ?? config.samplesPerExcerpt;
  const progress: InferenceProgress = {
    totalPrompts: testPrompts.length,
    completedPrompts: 0,
    totalSamples: testPrompts.length * samplesPerExcerpt,
    completedSamples: 0,
    startTime: Date.now(),
  };

  for (const tp of testPrompts) {
    const bookDir = path.join(runDir, tp.bookId);
    fs.mkdirSync(bookDir, { recursive: true });

    const outPath = path.join(bookDir, `chunk-${tp.chunkIndex}`, `${modelKey}.jsonl`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    // Check for existing results (resume support)
    let existingCount = 0;
    if (fs.existsSync(outPath)) {
      const content = fs.readFileSync(outPath, 'utf-8').trim();
      existingCount = content ? content.split('\n').filter(l => l.trim()).length : 0;
    }

    if (existingCount >= samplesPerExcerpt) {
      progress.completedPrompts++;
      progress.completedSamples += samplesPerExcerpt;
      continue;
    }

    const remaining = samplesPerExcerpt - existingCount;

    // Generate in batches — MLX Python process handles one at a time but stays loaded
    const results: GenerationResult[] = [];
    for (let i = existingCount; i < samplesPerExcerpt; i++) {
      try {
        const genResults = await mlxProc.generate(tp.prompt, 1, config.temperature, config.maxTokens || 600);
        for (const gr of genResults) {
          results.push({
            bookId: tp.bookId,
            chunkIndex: tp.chunkIndex,
            sampleIndex: i,
            generation: gr.text,
            model: modelKey,
            durationMs: gr.duration_ms,
          });
        }
      } catch (err) {
        console.error(`\n    Error ${tp.bookId} chunk ${tp.chunkIndex} sample ${i}: ${err instanceof Error ? err.message : err}`);
      }
      progress.completedSamples++;

      if (progress.completedSamples % 5 === 0) {
        printProgress(progress);
      }

      // Write incrementally every 10 samples for resume safety
      if (results.length >= 10 || i === samplesPerExcerpt - 1) {
        const lines = results.map(r => JSON.stringify(r));
        fs.appendFileSync(outPath, lines.join('\n') + '\n');
        results.length = 0;
      }
    }

    progress.completedPrompts++;
    if (progress.completedPrompts % 10 === 0) {
      process.stdout.write('\n');
    }
  }
  process.stdout.write('\n');
}

async function runOllamaInference(
  modelKey: string,
  testPrompts: TestPrompt[],
  config: MemorizationConfig,
  modelName: string,
  runDir: string,
  samplesOverride?: number,
) {
  const samplesPerExcerpt = samplesOverride ?? config.samplesPerExcerpt;
  const maxTokens = config.maxTokens || 600;
  const progress: InferenceProgress = {
    totalPrompts: testPrompts.length,
    completedPrompts: 0,
    totalSamples: testPrompts.length * samplesPerExcerpt,
    completedSamples: 0,
    startTime: Date.now(),
  };

  for (const tp of testPrompts) {
    const bookDir = path.join(runDir, tp.bookId);
    fs.mkdirSync(bookDir, { recursive: true });

    const outPath = path.join(bookDir, `chunk-${tp.chunkIndex}`, `${modelKey}.jsonl`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    let existingCount = 0;
    if (fs.existsSync(outPath)) {
      const content = fs.readFileSync(outPath, 'utf-8').trim();
      existingCount = content ? content.split('\n').filter(l => l.trim()).length : 0;
    }

    if (existingCount >= samplesPerExcerpt) {
      progress.completedPrompts++;
      progress.completedSamples += samplesPerExcerpt;
      continue;
    }

    const results: GenerationResult[] = [];

    for (let i = existingCount; i < samplesPerExcerpt; i++) {
      const startMs = Date.now();
      try {
        const generation = await generateOllama(modelName, tp.prompt, config.temperature, maxTokens);
        results.push({
          bookId: tp.bookId,
          chunkIndex: tp.chunkIndex,
          sampleIndex: i,
          generation,
          model: modelKey,
          durationMs: Date.now() - startMs,
        });
      } catch (err) {
        console.error(`\n    Error ${tp.bookId} chunk ${tp.chunkIndex} sample ${i}: ${err instanceof Error ? err.message : err}`);
      }
      progress.completedSamples++;

      if (progress.completedSamples % 5 === 0) {
        printProgress(progress);
      }

      if (results.length >= 10 || i === samplesPerExcerpt - 1) {
        const lines = results.map(r => JSON.stringify(r));
        fs.appendFileSync(outPath, lines.join('\n') + '\n');
        results.length = 0;
      }
    }

    progress.completedPrompts++;
  }
  process.stdout.write('\n');
}

async function main() {
  console.log('=== Stage 6: Inference ===\n');

  const config = loadConfig();
  const baselineOnly = process.argv.includes('--baseline-only');
  const samplesArg = process.argv.findIndex(a => a === '--samples');
  const samplesOverride = samplesArg >= 0 ? parseInt(process.argv[samplesArg + 1], 10) : undefined;

  const dataRun = resolveRun(DATA_EVAL);
  const finetuneRun = resolveRun(FINETUNE_EVAL);
  const { runId, runDir } = resolveRun(INFERENCE_EVAL);

  const testPrompts = loadTestPrompts(dataRun.runDir);
  const samplesPerExcerpt = samplesOverride ?? config.samplesPerExcerpt;
  const maxTokens = config.maxTokens || 600;

  console.log(`Test prompts: ${testPrompts.length}`);
  console.log(`Samples per excerpt: ${samplesPerExcerpt}`);
  console.log(`Temperature: ${config.temperature}`);
  console.log(`Max tokens: ${maxTokens}`);
  console.log(`Output: ${runDir}\n`);

  const scriptPath = path.join(runDir, 'mlx_inference.py');

  if (config.platform === 'mlx') {
    writeMlxInferenceScript(scriptPath);

    // --- Baseline ---
    console.log('--- Baseline (non-finetuned) ---');
    console.log('Loading model (no adapter)...');
    const baselineProc = await MlxInferenceProcess.create(
      scriptPath, config.baseModel, null, config.temperature, maxTokens,
    );
    await runMlxInference('baseline', testPrompts, config, baselineProc, runDir, samplesOverride);
    await baselineProc.close();
    console.log('Baseline complete.\n');

    if (!baselineOnly) {
      // --- Finetuned ---
      const finetuneResult = loadFinetuneResult(finetuneRun.runDir);
      if (!finetuneResult) {
        console.error('Finetuned model not found. Run 04-finetune-*.ts first.');
        console.error('Use --baseline-only to skip finetuned inference.');
        process.exit(1);
      }

      console.log('--- Finetuned ---');
      console.log(`Loading model with adapter: ${finetuneResult.adapterPath}`);
      const finetunedProc = await MlxInferenceProcess.create(
        scriptPath, finetuneResult.baseModel, finetuneResult.adapterPath, config.temperature, maxTokens,
      );
      await runMlxInference('finetuned', testPrompts, config, finetunedProc, runDir, samplesOverride);
      await finetunedProc.close();
      console.log('Finetuned complete.\n');
    }
  } else {
    // Ollama mode
    console.log('--- Baseline (non-finetuned) ---');
    const ollamaBase = config.ollamaBaseModel || 'qwen2.5:14b';
    await runOllamaInference('baseline', testPrompts, config, ollamaBase, runDir, samplesOverride);
    console.log('Baseline complete.\n');

    if (!baselineOnly) {
      console.log('--- Finetuned ---');
      await runOllamaInference('finetuned', testPrompts, config, 'memorization-finetuned', runDir, samplesOverride);
      console.log('Finetuned complete.\n');
    }
  }

  if (baselineOnly) {
    console.log('Baseline only mode. Skipping finetuned inference.');
  }

  console.log(`\nInference complete. Output: ${runDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
