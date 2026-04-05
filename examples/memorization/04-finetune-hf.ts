/**
 * Stage 4b: Finetune with HuggingFace PEFT/TRL.
 *
 * Writes a Python training script and executes it via subprocess.
 * Uses trl.SFTTrainer + peft.LoraConfig for LoRA finetuning.
 * Cost: $0 (local, but needs GPU or patience on CPU).
 *
 * Usage: pnpm tsx examples/memorization/04-finetune-hf.ts
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

function checkHfDeps(): boolean {
  try {
    execSync('python3 -c "from trl import SFTTrainer; from peft import LoraConfig"', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function generateTrainingScript(
  config: MemorizationConfig,
  dataDir: string,
  outputDir: string,
): string {
  return `#!/usr/bin/env python3
"""HuggingFace PEFT/TRL finetuning script (auto-generated)."""

import json
import time
from datasets import Dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig

# Load data
def load_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]

train_data = load_jsonl("${dataDir}/train.jsonl")
valid_data = load_jsonl("${dataDir}/valid.jsonl")

# Format for SFTTrainer
def format_example(example):
    msgs = example["messages"]
    return {"text": f"<|user|>\\n{msgs[0]['content']}\\n<|assistant|>\\n{msgs[1]['content']}"}

train_dataset = Dataset.from_list([format_example(e) for e in train_data])
valid_dataset = Dataset.from_list([format_example(e) for e in valid_data])

print(f"Train: {len(train_dataset)} samples")
print(f"Valid: {len(valid_dataset)} samples")

# Model
model_id = "${config.baseModel}"
print(f"Loading model: {model_id}")

tokenizer = AutoTokenizer.from_pretrained(model_id)
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

# Try quantized loading if bitsandbytes available
try:
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype="float16",
    )
    model = AutoModelForCausalLM.from_pretrained(model_id, quantization_config=bnb_config)
    print("Loaded with 4-bit quantization")
except Exception:
    model = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype="auto")
    print("Loaded without quantization")

# LoRA config
lora_config = LoraConfig(
    r=${config.loraRank},
    lora_alpha=${config.loraRank * 2},
    target_modules=["q_proj", "v_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

# Training config
training_config = SFTConfig(
    output_dir="${outputDir}/hf-adapter",
    num_train_epochs=${config.epochs},
    per_device_train_batch_size=${config.batchSize},
    per_device_eval_batch_size=${config.batchSize},
    eval_strategy="epoch",
    save_strategy="epoch",
    logging_steps=10,
    learning_rate=2e-4,
    weight_decay=0.01,
    warmup_ratio=0.03,
    lr_scheduler_type="cosine",
    report_to="none",
    max_seq_length=2048,
)

# Train
trainer = SFTTrainer(
    model=model,
    train_dataset=train_dataset,
    eval_dataset=valid_dataset,
    peft_config=lora_config,
    args=training_config,
    processing_class=tokenizer,
)

start = time.time()
trainer.train()
duration = time.time() - start

# Save
trainer.model.save_pretrained("${outputDir}/hf-adapter")
tokenizer.save_pretrained("${outputDir}/hf-adapter")

# Save result
result = {
    "train_loss": trainer.state.log_history[-1].get("train_loss"),
    "eval_loss": trainer.state.log_history[-1].get("eval_loss"),
    "duration_seconds": round(duration),
}
with open("${outputDir}/hf-train-result.json", "w") as f:
    json.dump(result, f, indent=2)

print(f"\\nDone in {round(duration)}s")
print(f"Adapter saved to: ${outputDir}/hf-adapter")
`;
}

async function main() {
  console.log('=== Stage 4b: HuggingFace PEFT/TRL Finetuning ===\n');

  if (!checkHfDeps()) {
    console.error('HuggingFace dependencies not found. Install:');
    console.error('  pip install transformers trl peft datasets bitsandbytes');
    process.exit(1);
  }
  console.log('HuggingFace deps: installed\n');

  const config = loadConfig();
  if (config.platform !== 'hf') {
    console.log(`Platform is "${config.platform}", not "hf". Use 04-finetune-mlx.ts for MLX.`);
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

  console.log(`Data: ${dataRun.runDir}`);
  console.log(`  Train: ${trainLines} samples`);
  console.log(`  Valid: ${validLines} samples`);
  console.log(`Model: ${config.baseModel}`);
  console.log(`Epochs: ${config.epochs}`);
  console.log(`Batch size: ${config.batchSize}`);
  console.log(`LoRA rank: ${config.loraRank}\n`);

  fs.mkdirSync(runDir, { recursive: true });

  // Write Python script
  const script = generateTrainingScript(config, dataRun.runDir, runDir);
  const scriptPath = path.join(runDir, 'train.py');
  fs.writeFileSync(scriptPath, script);
  console.log(`Training script: ${scriptPath}\n`);

  console.log('--- HuggingFace Output ---');
  const startTime = Date.now();

  try {
    execSync(`python3 "${scriptPath}"`, {
      stdio: 'inherit',
      timeout: 7200_000, // 2 hour timeout
    });
  } catch (err: any) {
    console.error('\nHuggingFace finetuning failed.');
    if (err.status) console.error(`Exit code: ${err.status}`);
    process.exit(1);
  }

  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  console.log('--- End HuggingFace Output ---\n');

  // Read HF train result if available
  let trainLoss: number | undefined;
  let validLoss: number | undefined;
  const hfResultPath = path.join(runDir, 'hf-train-result.json');
  if (fs.existsSync(hfResultPath)) {
    const hfResult = JSON.parse(fs.readFileSync(hfResultPath, 'utf-8'));
    trainLoss = hfResult.train_loss;
    validLoss = hfResult.eval_loss;
  }

  const result: FinetuneResult = {
    platform: 'hf',
    baseModel: config.baseModel,
    adapterPath: path.join(runDir, 'hf-adapter'),
    epochs: config.epochs,
    loraRank: config.loraRank,
    batchSize: config.batchSize,
    trainSamples: trainLines,
    validSamples: validLines,
    trainLoss,
    validLoss,
    durationSeconds,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(runDir, 'finetune-result.json'),
    JSON.stringify(result, null, 2),
  );

  console.log(`Finetuning complete in ${durationSeconds}s`);
  console.log(`Adapter: ${result.adapterPath}`);
  console.log(`Output: ${runDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
