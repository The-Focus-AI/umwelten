// Test utility functions for environment variable checking
// Tests should only use environment variables that are already set

export function hasRequiredEnvVar(key: string): boolean {
  return !!process.env[key]
}

export function skipIfNoEnvVar(key: string, message?: string): void {
  if (!hasRequiredEnvVar(key)) {
    console.warn(`⚠️ ${key} not found in environment, skipping test`)
    throw new Error(`Test skipped: ${message || key} not available`)
  }
}

// Export commonly used environment variable checks
export const hasOpenRouterKey = () => hasRequiredEnvVar('OPENROUTER_API_KEY')
export const hasGoogleKey = () => hasRequiredEnvVar('GOOGLE_GENERATIVE_AI_API_KEY')
export const hasGitHubToken = () => hasRequiredEnvVar('GITHUB_TOKEN')
export const hasMinimaxKey = () => hasRequiredEnvVar('MINIMAX_API_KEY')

// Service availability checks
/**
 * Default Ollama tag for integration tests. Override with env `OLLAMA_TEST_MODEL` (e.g. `gemma4:31b`).
 */
export const OLLAMA_INTEGRATION_MODEL =
  process.env.OLLAMA_TEST_MODEL?.trim() || "gemma4:latest";

export async function checkOllamaConnection(host = 'http://localhost:11434'): Promise<boolean> {
  try {
    const response = await fetch(`${host}/api/tags`)
    return response.ok
  } catch (e) {
    return false
  }
}

export async function checkLMStudioConnection(host = 'http://localhost:1234/v1'): Promise<boolean> {
  try {
    const response = await fetch(`${host}/models`)
    return response.ok
  } catch (e) {
    return false
  }
}

export async function checkLlamaBarnConnection(host = 'http://localhost:2276/v1'): Promise<boolean> {
  try {
    const response = await fetch(`${host}/models`)
    return response.ok
  } catch (e) {
    return false
  }
}

export async function checkLlamaSwapConnection(host = 'http://localhost:8080/v1'): Promise<boolean> {
  try {
    const response = await fetch(`${host}/models`)
    return response.ok
  } catch (e) {
    return false
  }
}

