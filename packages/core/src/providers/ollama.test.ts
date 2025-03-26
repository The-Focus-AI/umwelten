import { describe, it, expect } from 'vitest'
import { createOllamaModel } from './ollama.ts'
import { generateText } from 'ai'

describe('Ollama Provider', () => {
  // First check if Ollama is running
  it('should be able to connect to Ollama', async () => {
    const response = await fetch('http://localhost:11434/api/version')
    expect(response.ok).toBe(true)
  })

  it('should generate text with gemma3 model and return usage stats', async () => {
    const model = createOllamaModel('gemma3')
    const prompt = 'Write a haiku about programming'
    
    const response = await generateText({
      model,
      prompt
    })

    console.log('Full response:', response)
    
    expect(response.text).toBeTruthy()
    expect(typeof response.text).toBe('string')
    console.log('Generated text:', response.text)
    
    // Check if we get usage statistics
    expect(response).toHaveProperty('usage')
    if (response.usage) {
      console.log('Usage stats:', response.usage)
      expect(response.usage).toHaveProperty('promptTokens')
      expect(response.usage).toHaveProperty('completionTokens')
      expect(response.usage).toHaveProperty('totalTokens')
      
      // Verify the numbers make sense
      expect(response.usage.promptTokens).toBeGreaterThan(0)
      expect(response.usage.completionTokens).toBeGreaterThan(0)
      expect(response.usage.totalTokens).toBe(
        response.usage.promptTokens + response.usage.completionTokens
      )
    }
  })
}) 