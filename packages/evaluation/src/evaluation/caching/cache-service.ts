import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { ModelSpec, PiTurnResult } from "@umwelten/pi";

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  key: string;
}

export interface CacheConfig {
  baseDir?: string;
  enabled?: boolean;
  maxAge?: number;
  verbose?: boolean;
}

export class EvaluationCache {
  private readonly baseDir: string;
  private readonly evaluationId: string;
  private readonly config: Required<CacheConfig>;

  constructor(evaluationId: string, config: CacheConfig = {}) {
    this.evaluationId = evaluationId;
    this.config = {
      baseDir:
        config.baseDir ||
        process.env.UMWELTEN_EVAL_DIR ||
        path.join(process.cwd(), "output", "evaluations"),
      enabled: config.enabled !== undefined ? config.enabled : true,
      maxAge: config.maxAge || 0,
      verbose: config.verbose || false,
    };
    this.baseDir = path.join(this.config.baseDir, this.evaluationId);
  }

  async getCachedTurn(
    model: ModelSpec,
    promptHash: string,
    execFn: () => Promise<PiTurnResult>,
  ): Promise<{ turn: PiTurnResult; cached: boolean }> {
    const safeModel = `${model.provider}-${model.name}${model.reasoningEffort ? `-${model.reasoningEffort}` : ""}`.replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    );
    const cacheFile = path.join(
      this.baseDir,
      "responses",
      `${safeModel}-${promptHash.slice(0, 12)}.json`,
    );

    if (this.config.enabled) {
      try {
        const raw = JSON.parse(await fs.readFile(cacheFile, "utf8")) as CacheEntry<PiTurnResult>;
        const expired =
          this.config.maxAge > 0 && Date.now() - raw.timestamp > this.config.maxAge;
        if (!expired && raw?.data) {
          return { turn: raw.data, cached: true };
        }
      } catch {
        // Cache miss
      }
    }

    const turn = await execFn();
    if (this.config.enabled) {
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(
        cacheFile,
        JSON.stringify({ data: turn, timestamp: Date.now(), key: safeModel }, null, 2),
      );
    }
    return { turn, cached: false };
  }

  static hashKey(payload: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }
}
