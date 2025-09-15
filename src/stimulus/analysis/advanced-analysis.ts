import { Stimulus } from '../../stimulus/stimulus.js';

export const DataAnalysisStimulus = new Stimulus({
  id: 'data-analysis',
  name: 'Data Analysis and Insights',
  description: 'Test models\' ability to analyze data and extract meaningful insights',

  role: "data analyst",
  objective: "analyze data and provide actionable insights",
  instructions: [
    "Examine the provided data thoroughly",
    "Identify patterns, trends, and anomalies",
    "Calculate relevant statistics and metrics",
    "Provide clear explanations of findings",
    "Suggest actionable recommendations",
    "Use appropriate data visualization concepts",
    "Consider potential biases and limitations",
    "Provide confidence levels for conclusions"
  ],
  output: [
    "Executive summary of findings",
    "Detailed analysis with supporting data",
    "Key insights and patterns identified",
    "Statistical analysis and metrics",
    "Visualization recommendations",
    "Actionable recommendations",
    "Limitations and caveats"
  ],
  examples: [
    {
      input: "Analyze sales data for Q1-Q4",
      output: `## Executive Summary
Sales increased 23% year-over-year, with Q4 showing the strongest performance at 31% growth.

## Key Findings
- Q4 sales: $2.3M (31% increase)
- Best performing product: Product A (45% of total sales)
- Seasonal pattern: 15% higher sales in Q4 vs Q1

## Recommendations
1. Increase inventory for Product A in Q4
2. Investigate Q2 dip for improvement opportunities
3. Consider Q4 marketing strategies for other products`
    }
  ],
  temperature: 0.2,
  maxTokens: 1500,
  runnerType: 'base'
});

export const CodeReviewStimulus = new Stimulus({
  id: 'code-review',
  name: 'Code Review and Analysis',
  description: 'Test models\' ability to review code and provide constructive feedback',

  role: "senior software engineer",
  objective: "review code and provide constructive feedback",
  instructions: [
    "Examine code quality, readability, and maintainability",
    "Identify potential bugs, security issues, and performance problems",
    "Check adherence to coding standards and best practices",
    "Suggest improvements for clarity and efficiency",
    "Consider edge cases and error handling",
    "Evaluate test coverage and quality",
    "Provide specific, actionable feedback",
    "Balance criticism with positive reinforcement"
  ],
  output: [
    "Overall code quality assessment",
    "Specific issues identified with line references",
    "Security and performance concerns",
    "Suggestions for improvement",
    "Positive aspects to maintain",
    "Priority levels for fixes",
    "Best practices recommendations"
  ],
  examples: [
    {
      input: "Review this JavaScript function",
      output: `## Code Review

### Issues Found
1. **Line 5**: Missing null check for user parameter
2. **Line 8**: Potential memory leak with event listeners
3. **Line 12**: Hardcoded timeout value should be configurable

### Suggestions
- Add input validation
- Use WeakMap for event listener cleanup
- Extract timeout to configuration

### Positive Aspects
- Good function naming
- Clear variable names
- Proper error handling structure`
    }
  ],
  temperature: 0.3,
  maxTokens: 1200,
  runnerType: 'base'
});

export const BusinessAnalysisStimulus = new Stimulus({
  id: 'business-analysis',
  name: 'Business Analysis and Strategy',
  description: 'Test models\' ability to analyze business situations and provide strategic insights',

  role: "business analyst",
  objective: "analyze business situations and provide strategic recommendations",
  instructions: [
    "Analyze the business context and situation",
    "Identify key stakeholders and their interests",
    "Assess risks and opportunities",
    "Consider market conditions and competitive landscape",
    "Provide data-driven recommendations",
    "Consider implementation challenges and timelines",
    "Evaluate cost-benefit implications",
    "Suggest success metrics and KPIs"
  ],
  output: [
    "Situation analysis and context",
    "Stakeholder analysis",
    "Risk and opportunity assessment",
    "Strategic recommendations",
    "Implementation plan",
    "Success metrics and KPIs",
    "Timeline and milestones",
    "Resource requirements"
  ],
  examples: [
    {
      input: "Analyze the impact of remote work on our company",
      output: `## Business Analysis: Remote Work Impact

### Current Situation
- 80% of employees now work remotely
- Productivity metrics show 15% increase
- Employee satisfaction up 23%

### Key Opportunities
- Reduced office costs: $2M annually
- Access to global talent pool
- Improved work-life balance

### Risks
- Communication challenges
- Team cohesion concerns
- Technology infrastructure needs

### Recommendations
1. Invest in collaboration tools
2. Implement regular team building
3. Develop remote work policies
4. Measure productivity and satisfaction quarterly`
    }
  ],
  temperature: 0.4,
  maxTokens: 1800,
  runnerType: 'base'
});

export const TechnicalWritingStimulus = new Stimulus({
  id: 'technical-writing',
  name: 'Technical Documentation Writing',
  description: 'Test models\' ability to write clear, comprehensive technical documentation',

  role: "technical writer",
  objective: "create clear, comprehensive technical documentation",
  instructions: [
    "Write clear, concise, and accurate documentation",
    "Use appropriate technical terminology",
    "Include code examples and diagrams where helpful",
    "Structure content logically with proper headings",
    "Consider the target audience's technical level",
    "Include troubleshooting and FAQ sections",
    "Use consistent formatting and style",
    "Ensure all information is current and accurate"
  ],
  output: [
    "Clear title and introduction",
    "Step-by-step instructions",
    "Code examples with explanations",
    "Troubleshooting section",
    "FAQ section",
    "Related resources and links",
    "Proper formatting and structure"
  ],
  examples: [
    {
      input: "Document the API authentication process",
      output: `# API Authentication

## Overview
Our API uses OAuth 2.0 for authentication. All requests must include a valid access token.

## Getting Started
1. Register your application
2. Obtain client credentials
3. Request access token
4. Include token in API requests

## Code Example
\`\`\`javascript
const response = await fetch('/api/data', {
  headers: {
    'Authorization': 'Bearer YOUR_ACCESS_TOKEN'
  }
});
\`\`\`

## Troubleshooting
- **401 Unauthorized**: Check token validity
- **403 Forbidden**: Verify permissions`
    }
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base'
});
