# AI Model Evaluation Tool

## Overview

This command-line tool allows you to evaluate and compare AI models across different providers, focusing on usability, cost transparency, and comprehensive model information. It is designed for developers, teams managing model costs, researchers, and CLI automation users.

## Core Features

- **Model Discovery**: Search and filter models, view detailed information, and compare capabilities.
- **Cost Management**: Display clear cost information, identify free models, and show cost breakdowns.
- **User Experience**: Beautiful, color-coded output, human-readable formatting, and pipe-friendly operation.

## Getting Started

### Prerequisites

- **Node.js** (v20+)
- **pnpm** for package management
- **API Keys**: Ensure you have the necessary API keys for the providers you intend to use. These should be stored in a `.env` file.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/model-eval.git
   cd model-eval
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up your `.env` file with the required API keys:
   ```plaintext
   OPENROUTER_API_KEY=your_openrouter_api_key
   OLAMA_API_KEY=your_olama_api_key
   VERCEL_AI_KEY=your_vercel_ai_key
   ```

### Usage

#### Running a Model Evaluation

To run a model evaluation, use the `run` command. Here's an example using the `frankenstein-eval.json`:

```bash
pnpm cli run --prompt "What are the key themes and moral implications in Mary Shelley's Frankenstein regarding the relationship between creator and creation?" --model gpt-4-turbo-preview --format json
```

This command will:

- Use the `gpt-4-turbo-preview` model to analyze the prompt.
- Output the results in JSON format.
- Log details such as response speed, quality, and cost.

#### Example: Frankenstein Analysis

The `frankenstein-eval.json` provides a structured evaluation setup:

```json
{
  "prompt": {
    "title": "Frankenstein Analysis",
    "question": "What are the key themes and moral implications in Mary Shelley's Frankenstein regarding the relationship between creator and creation?",
    "context": "Consider the dynamic between Victor Frankenstein and his creation, focusing on themes of responsibility, ambition, and the consequences of scientific advancement without ethical consideration.",
    "parameters": {
      "max_tokens": 1000,
      "temperature": 0.7,
      "top_p": 0.95
    }
  },
  "rubric": {
    "evaluation_prompt": "Evaluate the response based on the following criteria, considering depth of analysis, textual evidence, and clarity of reasoning.",
    "scoring_criteria": {
      "thematic_analysis": {
        "description": "Understanding and analysis of key themes",
        "points": 10
      },
      "moral_implications": {
        "description": "Analysis of moral and ethical implications",
        "points": 10
      }
    }
  }
}
```

### Advanced Features

- **Model Comparison**: Compare models based on cost, speed, and quality.
- **Batch Processing**: Run evaluations in batch mode for multiple prompts.
- **Web Dashboard**: Visualize results using a local web dashboard built with React and Vite.

## Development

### Directory Structure

```
model-eval/
├── apps/
│   ├── cli/              # Command-line interface
│   └── dashboard/        # Local web UI
├── packages/
│   ├── core/             # Shared logic
│   ├── store/            # Data storage
│   └── metrics/          # Scoring and validation
├── runs/
│   ├── run_001/
│   │   ├── prompt.json
│   │   ├── outputs.json
│   │   ├── metadata.json
│   │   └── index.html
└── .env
```

### Testing

- **Unit Tests**: Use Vitest for testing core functionalities.
- **Integration Tests**: Ensure end-to-end functionality of CLI commands.
- **Manual QA**: Run evaluations against known prompts and compare results.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details. 