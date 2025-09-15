import { Command } from "commander";
import { Interaction, CLIInterface } from "../src/ui/index.js";
import { Stimulus } from "../src/stimulus/stimulus.js";
import { z } from "zod";
// Registry removed: tools are attached directly to Interaction
import fs from "fs";
import path from "path";

// Weather Tool using Vercel AI SDK format
const weatherTool = {
  description: "Get current weather information for a specific location. Can accept location names (like 'Cornwall CT') or coordinates.",
  inputSchema: z.object({
    location: z.string().describe("Location name (e.g., 'Cornwall CT', 'New York') or coordinates (e.g., '41.6612,-73.3291')"),
    units: z.enum(["celsius", "fahrenheit"]).default("fahrenheit").describe("Temperature units")
  }),
  execute: async (params: { location: string; units: string }) => {
    console.log(`[WEATHER] Called with:`, params);
    
    const { location, units } = params;
    
    try {
      let latitude: number, longitude: number;
      
      // Check if location is coordinates
      if (location.includes(',')) {
        const coords = location.split(',').map(c => parseFloat(c.trim()));
        if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) {
          throw new Error("Invalid coordinate format. Use 'latitude,longitude'");
        }
        [latitude, longitude] = coords;
      } else {
        // For location names, we'll use a simple mapping for common places
        // In a real implementation, you'd use a geocoding service
        const locationMap: Record<string, [number, number]> = {
          'cornwall ct': [41.6612, -73.3291],
          'cornwall, ct': [41.6612, -73.3291],
          'cornwall connecticut': [41.6612, -73.3291],
          'new york': [40.7128, -74.0060],
          'new york city': [40.7128, -74.0060],
          'london': [51.5074, -0.1278],
          'paris': [48.8566, 2.3522],
          'tokyo': [35.6762, 139.6503],
        };
        
        const normalizedLocation = location.toLowerCase().trim();
        const coords = locationMap[normalizedLocation];
        
        if (!coords) {
          throw new Error(`Location '${location}' not found. Please provide coordinates in format 'latitude,longitude' or use a supported city name.`);
        }
        
        [latitude, longitude] = coords;
      }
      
      // Use Open-Meteo API
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }
      
      const data = await response.json();
      const current = data.current;
      
      // Convert temperature if needed
      let temperature = current.temperature_2m;
      if (units === "fahrenheit") {
        temperature = (temperature * 9/5) + 32;
      }
      
      // Weather code descriptions
      const weatherCodes: Record<number, string> = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        71: "Slight snow",
        73: "Moderate snow",
        75: "Heavy snow",
        80: "Slight rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        95: "Thunderstorm",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail"
      };
      
      return {
        location: location,
        coordinates: { latitude, longitude },
        temperature: Math.round(temperature * 10) / 10,
        units,
        weather: weatherCodes[current.weather_code] || "Unknown",
        windSpeed: current.wind_speed_10m,
        humidity: current.relative_humidity_2m,
        timestamp: new Date().toISOString(),
        source: "Open-Meteo API"
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        location: location,
        success: false
      };
    }
  },
};

// Calculator Tool using Vercel AI SDK format
const calculatorTool = {
  description: "Calculate a mathematical expression (e.g., '5 + 3', '10 * 2')",
  inputSchema: z.object({
    expression: z.string().describe("Mathematical expression to calculate (e.g., '5 + 3')")
  }),
  execute: async (params: { expression: string }) => {
    console.log(`[CALCULATOR] Called with:`, params);
    
    const { expression } = params;
    
    try {
      // Simple expression parser for basic arithmetic
      const cleanExpression = expression.replace(/\s+/g, ' ').trim();
      
      // Use JavaScript's eval for simple expressions (in a real app, use a proper math parser)
      const result = eval(cleanExpression);
      
      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error("Invalid mathematical expression");
      }
      
      const toolResult = {
        expression: cleanExpression,
        result,
        formatted: `${cleanExpression} = ${result}`,
        timestamp: new Date().toISOString()
      };
      console.log(`[CALCULATOR] Returning result:`, toolResult);
      return toolResult;
    } catch (error) {
      const toolResult = {
        expression,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
      console.log(`[CALCULATOR] Returning error result:`, toolResult);
      return toolResult;
    }
  },
};

// File Analysis Tool using Vercel AI SDK format
const fileAnalysisTool = {
  description: "Analyze file content, size, or metadata",
  inputSchema: z.object({
    path: z.string().describe("Path to the file to analyze"),
    analysis: z.enum(["size", "content", "metadata"]).default("content").describe("Type of analysis to perform")
  }),
  execute: async (params: { path: string; analysis: string }) => {
    console.log(`[FILE_ANALYSIS] Called with:`, params);
    
    const { path: filePath, analysis } = params;
    
    try {
      const stats = await fs.promises.stat(filePath);
      
      if (analysis === 'size') {
        return {
          path: filePath,
          size: stats.size,
          sizeInKB: Math.round(stats.size / 1024),
          lastModified: stats.mtime.toISOString(),
          analysis: 'size'
        };
      }
      
      if (analysis === 'content') {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return {
          path: filePath,
          content: content.substring(0, 1000) + (content.length > 1000 ? '...' : ''),
          length: content.length,
          lines: content.split('\n').length,
          analysis: 'content'
        };
      }
      
      return {
        path: filePath,
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        permissions: stats.mode.toString(8),
        lastModified: stats.mtime.toISOString(),
        analysis: 'metadata'
      };
    } catch (error) {
      return {
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
        exists: false,
        analysis
      };
    }
  },
};

// Build a local tool set for this script
const scriptTools: Record<string, any> = {
  weather: weatherTool,
  calculator: calculatorTool,
  fileAnalysis: fileAnalysisTool,
};

export const chatCommand = new Command()
  .description("Interactive chat with a model using the new Interaction + Interface pattern")
  .option("-p, --provider <provider>", "Model provider (e.g., ollama, openrouter)", "ollama")
  .option("-m, --model <model>", "Model name (e.g., gpt-oss:latest, qwen3:latest)", "gpt-oss:latest")
  .option("-f, --file <filePath>", "File to include in the chat")
  .option("--prompt <prompt>", "Non-interactive prompt to send to the model")
  .option("--tools", "Enable tools for the chat session", true) // Default to true since this is the tools script
  .action(async (options: { provider: string; model: string; file?: string; prompt?: string; tools?: boolean }) => {
    const { provider, model, file, prompt, tools } = options;

    console.log(`🚀 Starting chat with ${provider}/${model} using the new Interaction pattern`);
    if (tools) {
      console.log("🔧 Tools enabled:", Object.keys(scriptTools));
    }
    console.log();

    // Create model details
    const modelDetails = {
      name: model,
      provider: provider,
    };

    try {
      // Create stimulus with tools
      const stimulus = new Stimulus({
        role: "helpful AI assistant with access to tools",
        objective: "be helpful and use available tools when needed",
        instructions: [
          "Always respond with text content first",
          "Use tools when you need specific information or calculations",
          "Be conversational and engaging"
        ],
        tools: tools ? scriptTools : undefined,
        runnerType: 'base'
      });
      
      // Create interaction with stimulus
      const chatInteraction = new Interaction(modelDetails, stimulus);
      
      if (tools) {
        console.log("✅ Custom tools registered:", Object.keys(scriptTools));
      }
      
      // Handle file attachment if provided
      if (file) {
        const filePath = path.resolve(file);
        if (!fs.existsSync(filePath)) {
          console.error(`Error: File '${file}' does not exist.`);
          process.exit(1);
        }
        
        try {
          await chatInteraction.addAttachmentFromPath(filePath);
          console.log(`📎 File attached: ${path.basename(filePath)}`);
        } catch (error) {
          console.error(`Error reading file '${file}':`, error);
          process.exit(1);
        }
      }

      // Handle non-interactive mode
      if (prompt) {
        console.log(`📝 Non-interactive mode - sending prompt: ${prompt}\n`);
        
        try {
          chatInteraction.addMessage({ role: "user", content: prompt });
          const response = await chatInteraction.generateText();
          console.log("🤖 Model Response:");
          if (response && response.trim()) {
            console.log(response);
          } else {
            console.log("[No response content received]");
          }
          console.log("\n✅ Chat session completed.");
        } catch (error) {
          console.error("❌ Error:", error);
        }
        
        process.exit(0);
      }

      // Interactive mode - use CLI interface
      console.log("💬 Starting interactive chat session...");
      console.log("Type 'exit' or 'quit' to end the conversation.\n");
      
      const cliInterface = new CLIInterface();
      await cliInterface.startChat(chatInteraction);

    } catch (error) {
      console.error("❌ Error:", error);
      process.exit(1);
    }
  });

// Execute the command if this file is run directly
if (import.meta.url.endsWith(process.argv[1])) {
  chatCommand.parse();
}
