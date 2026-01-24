import { EvaluationAnalysis, AnalysisMetrics, ModelPerformance, StimulusPerformance } from './result-analyzer.js';
import { EvaluationResult } from '../types/evaluation-types.js';
import fs from 'fs';
import path from 'path';

export interface ReportConfig {
  outputDir: string;
  format: 'json' | 'html' | 'markdown' | 'all';
  includeDetails: boolean;
  includeRecommendations: boolean;
  includeCharts: boolean;
}

export class ReportGenerator {
  constructor(private config: ReportConfig) {}

  async generateReport(analysis: EvaluationAnalysis, results: EvaluationResult[]): Promise<string[]> {
    const files: string[] = [];

    if (this.config.format === 'json' || this.config.format === 'all') {
      const jsonFile = await this.generateJsonReport(analysis, results);
      files.push(jsonFile);
    }

    if (this.config.format === 'html' || this.config.format === 'all') {
      const htmlFile = await this.generateHtmlReport(analysis, results);
      files.push(htmlFile);
    }

    if (this.config.format === 'markdown' || this.config.format === 'all') {
      const markdownFile = await this.generateMarkdownReport(analysis, results);
      files.push(markdownFile);
    }

    return files;
  }

  private async generateJsonReport(analysis: EvaluationAnalysis, results: EvaluationResult[]): Promise<string> {
    const report = {
      timestamp: new Date().toISOString(),
      analysis,
      results: results.map(r => ({
        model: r.model,
        stimulusId: r.metadata.stimulusId,
        duration: r.metadata.duration,
        tokens: r.response.metadata.tokenUsage.promptTokens + r.response.metadata.tokenUsage.completionTokens,
        cost: r.response.metadata.cost?.total || 0,
        success: !r.metadata.error,
        error: r.metadata.error || null,
        timestamp: r.metadata.timestamp
      }))
    };

    const filename = `evaluation-report-${Date.now()}.json`;
    const filepath = path.join(this.config.outputDir, filename);
    
    await fs.promises.writeFile(filepath, JSON.stringify(report, null, 2));
    return filepath;
  }

  private async generateHtmlReport(analysis: EvaluationAnalysis, results: EvaluationResult[]): Promise<string> {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Evaluation Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
        .header { background: #f4f4f4; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .metric-card { background: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 5px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; color: #333; }
        .metric-label { color: #666; margin-top: 5px; }
        .section { margin-bottom: 30px; }
        .section h2 { color: #333; border-bottom: 2px solid #007acc; padding-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f4f4f4; font-weight: bold; }
        .success { color: #28a745; }
        .error { color: #dc3545; }
        .recommendations { background: #e7f3ff; padding: 15px; border-radius: 5px; border-left: 4px solid #007acc; }
        .recommendations ul { margin: 10px 0; padding-left: 20px; }
        .chart { background: #f9f9f9; padding: 20px; border-radius: 5px; margin: 15px 0; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Evaluation Report</h1>
        <p>Generated on ${new Date().toLocaleString()}</p>
    </div>

    <div class="metrics">
        <div class="metric-card">
            <div class="metric-value">${analysis.metrics.totalEvaluations}</div>
            <div class="metric-label">Total Evaluations</div>
        </div>
        <div class="metric-card">
            <div class="metric-value ${analysis.metrics.successRate >= 80 ? 'success' : 'error'}">${analysis.metrics.successRate.toFixed(1)}%</div>
            <div class="metric-label">Success Rate</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${(analysis.metrics.averageDuration / 1000).toFixed(1)}s</div>
            <div class="metric-label">Avg Duration</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">$${analysis.metrics.totalCost.toFixed(2)}</div>
            <div class="metric-label">Total Cost</div>
        </div>
    </div>

    <div class="section">
        <h2>Model Performance</h2>
        <table>
            <thead>
                <tr>
                    <th>Model</th>
                    <th>Evaluations</th>
                    <th>Success Rate</th>
                    <th>Avg Duration</th>
                    <th>Avg Tokens</th>
                    <th>Total Cost</th>
                </tr>
            </thead>
            <tbody>
                ${analysis.modelPerformance.map(m => `
                    <tr>
                        <td>${m.model.provider}:${m.model.name}</td>
                        <td>${m.evaluations}</td>
                        <td class="${m.successRate >= 80 ? 'success' : 'error'}">${m.successRate.toFixed(1)}%</td>
                        <td>${(m.averageDuration / 1000).toFixed(1)}s</td>
                        <td>${m.averageTokens.toFixed(0)}</td>
                        <td>$${m.totalCost.toFixed(2)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <div class="section">
        <h2>Stimulus Performance</h2>
        <table>
            <thead>
                <tr>
                    <th>Stimulus ID</th>
                    <th>Evaluations</th>
                    <th>Success Rate</th>
                    <th>Avg Duration</th>
                    <th>Avg Tokens</th>
                    <th>Total Cost</th>
                    <th>Models</th>
                </tr>
            </thead>
            <tbody>
                ${analysis.stimulusPerformance.map(s => `
                    <tr>
                        <td>${s.stimulusId}</td>
                        <td>${s.evaluations}</td>
                        <td class="${s.successRate >= 80 ? 'success' : 'error'}">${s.successRate.toFixed(1)}%</td>
                        <td>${(s.averageDuration / 1000).toFixed(1)}s</td>
                        <td>${s.averageTokens.toFixed(0)}</td>
                        <td>$${s.totalCost.toFixed(2)}</td>
                        <td>${s.models.map(m => m.name).join(', ')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    ${analysis.errors.length > 0 ? `
    <div class="section">
        <h2>Errors</h2>
        <table>
            <thead>
                <tr>
                    <th>Model</th>
                    <th>Stimulus</th>
                    <th>Error</th>
                    <th>Timestamp</th>
                </tr>
            </thead>
            <tbody>
                ${analysis.errors.map(e => `
                    <tr>
                        <td>${e.model.provider}:${e.model.name}</td>
                        <td>${e.stimulusId}</td>
                        <td class="error">${e.error}</td>
                        <td>${e.timestamp.toLocaleString()}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    ` : ''}

    ${analysis.recommendations.length > 0 ? `
    <div class="section">
        <h2>Recommendations</h2>
        <div class="recommendations">
            <ul>
                ${analysis.recommendations.map(r => `<li>${r}</li>`).join('')}
            </ul>
        </div>
    </div>
    ` : ''}
</body>
</html>`;

    const filename = `evaluation-report-${Date.now()}.html`;
    const filepath = path.join(this.config.outputDir, filename);
    
    await fs.promises.writeFile(filepath, html);
    return filepath;
  }

  private async generateMarkdownReport(analysis: EvaluationAnalysis, results: EvaluationResult[]): Promise<string> {
    const markdown = `# Evaluation Report

Generated on ${new Date().toLocaleString()}

## Summary

- **Total Evaluations**: ${analysis.metrics.totalEvaluations}
- **Success Rate**: ${analysis.metrics.successRate.toFixed(1)}%
- **Average Duration**: ${(analysis.metrics.averageDuration / 1000).toFixed(1)}s
- **Total Cost**: $${analysis.metrics.totalCost.toFixed(2)}
- **Average Tokens**: ${analysis.metrics.averageTokens.toFixed(0)}

## Model Performance

| Model | Evaluations | Success Rate | Avg Duration | Avg Tokens | Total Cost |
|-------|-------------|--------------|--------------|------------|------------|
${analysis.modelPerformance.map(m => `| ${m.model.provider}:${m.model.name} | ${m.evaluations} | ${m.successRate.toFixed(1)}% | ${(m.averageDuration / 1000).toFixed(1)}s | ${m.averageTokens.toFixed(0)} | $${m.totalCost.toFixed(2)} |`).join('\n')}

## Stimulus Performance

| Stimulus ID | Evaluations | Success Rate | Avg Duration | Avg Tokens | Total Cost | Models |
|-------------|-------------|--------------|--------------|------------|------------|--------|
${analysis.stimulusPerformance.map(s => `| ${s.stimulusId} | ${s.evaluations} | ${s.successRate.toFixed(1)}% | ${(s.averageDuration / 1000).toFixed(1)}s | ${s.averageTokens.toFixed(0)} | $${s.totalCost.toFixed(2)} | ${s.models.map(m => m.name).join(', ')} |`).join('\n')}

${analysis.errors.length > 0 ? `## Errors

| Model | Stimulus | Error | Timestamp |
|-------|----------|-------|-----------|
${analysis.errors.map(e => `| ${e.model.provider}:${e.model.name} | ${e.stimulusId} | ${e.error} | ${e.timestamp.toLocaleString()} |`).join('\n')}
` : ''}

${analysis.recommendations.length > 0 ? `## Recommendations

${analysis.recommendations.map(r => `- ${r}`).join('\n')}
` : ''}

## Detailed Results

${this.config.includeDetails ? results.map((result, index) => `
### Result ${index + 1}

- **Model**: ${result.model.provider}:${result.model.name}
- **Stimulus**: ${result.metadata.stimulusId}
- **Duration**: ${result.metadata.duration}ms
- **Tokens**: ${result.response.metadata.tokenUsage.promptTokens + result.response.metadata.tokenUsage.completionTokens}
- **Cost**: $${(result.response.metadata.cost?.total || 0).toFixed(4)}
- **Success**: ${!result.metadata.error ? 'Yes' : 'No'}
${result.metadata.error ? `- **Error**: ${result.metadata.error}` : ''}
- **Response Preview**: ${result.response.content.substring(0, 200)}...
`).join('\n') : ''}
`;

    const filename = `evaluation-report-${Date.now()}.md`;
    const filepath = path.join(this.config.outputDir, filename);
    
    await fs.promises.writeFile(filepath, markdown);
    return filepath;
  }
}
