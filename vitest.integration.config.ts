import { defineConfig } from 'vitest/config'

/**
 * Integration test config — runs tests that hit real LLM APIs, local model
 * servers (Ollama, LM Studio, llama-swap, LlamaBarn), or Docker.
 *
 * These tests are skipped in the default `pnpm test:run` and require:
 *   - API keys in .env (GOOGLE_GENERATIVE_AI_API_KEY, OPENROUTER_API_KEY, etc.)
 *   - Local servers running (Ollama on :11434, etc.)
 *
 * Run with: pnpm test:integration
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.integration.test.ts'],
    environment: 'node',
    globals: true,
    reporters: ['verbose'],
    stdout: true,
    silent: false,
    testTimeout: 60000,
    diffLimit: 10000,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true
      }
    }
  },
  define: {
    'process.env': process.env
  }
})
