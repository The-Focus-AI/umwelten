import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file
const envPath = resolve(__dirname, '../../../../.env')
console.log('Loading .env from:', envPath)
console.log('Current directory:', __dirname)

const result = config({
  path: envPath
})

console.log('Dotenv config result:', result)
console.log('Current env vars:', {
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  NODE_ENV: process.env.NODE_ENV
})

// Verify required environment variables
const requiredEnvVars = ['OPENROUTER_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key])

if (missingEnvVars.length > 0) {
  console.warn(`⚠️ Missing environment variables: ${missingEnvVars.join(', ')}`)
  console.warn('Some tests may be skipped. See .env.example for required variables.')
} 