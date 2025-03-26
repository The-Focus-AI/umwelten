import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file
config({
  path: resolve(__dirname, '../.env')
})

// Verify required environment variables
const requiredEnvVars = ['OPENROUTER_API_KEY']
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key])

if (missingEnvVars.length > 0) {
  console.warn(`⚠️ Missing environment variables: ${missingEnvVars.join(', ')}`)
  console.warn('Some tests may be skipped. See .env.example for required variables.')
} 