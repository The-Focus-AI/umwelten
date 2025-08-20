/**
 * Advanced Code Quality Analyzer
 * Comprehensive analysis of generated TypeScript code quality and correctness
 */

import fs from 'fs';
import path from 'path';

export interface CodeQualityMetrics {
  // Basic metrics
  lines: number;
  functions: number;
  variables: number;
  complexity: number;
  
  // TypeScript specific
  typeAnnotations: number;
  interfaces: number;
  enums: number;
  generics: number;
  
  // Code quality indicators
  hasComments: boolean;
  hasErrorHandling: boolean;
  hasInputValidation: boolean;
  usesModernSyntax: boolean;
  
  // Logic analysis
  hasLoops: boolean;
  hasConditionals: boolean;
  hasRandomization: boolean;
  hasSetOrArrayUsage: boolean;
  
  // Task-specific analysis
  targetNumber: number | null;
  actualOutputCount: number | null;
  achievesTarget: boolean;
  outputQuality: 'excellent' | 'good' | 'fair' | 'poor';
  
  // Common issues
  syntaxErrors: string[];
  logicErrors: string[];
  performanceIssues: string[];
  bestPracticeViolations: string[];
}

export interface DockerOutputAnalysis {
  itemCount: number;
  uniqueItemCount: number;
  averageLength: number;
  containsTarget: boolean;
  outputFormat: 'array' | 'list' | 'json' | 'text' | 'unknown';
  sampleItems: string[];
  errors: string[];
}

export class AdvancedCodeAnalyzer {
  /**
   * Analyzes TypeScript code quality comprehensively
   */
  static analyzeCodeQuality(code: string): CodeQualityMetrics {
    const lines = code.split('\n').filter(line => line.trim().length > 0);
    
    return {
      // Basic metrics
      lines: lines.length,
      functions: this.countMatches(code, /function\s+\w+|const\s+\w+\s*=\s*\(/g),
      variables: this.countMatches(code, /(?:const|let|var)\s+\w+/g),
      complexity: this.calculateComplexity(code),
      
      // TypeScript specific
      typeAnnotations: this.countMatches(code, /:\s*\w+/g),
      interfaces: this.countMatches(code, /interface\s+\w+/g),
      enums: this.countMatches(code, /enum\s+\w+/g),
      generics: this.countMatches(code, /<[^>]+>/g),
      
      // Code quality indicators
      hasComments: /\/\/|\/\*/.test(code),
      hasErrorHandling: /try\s*{|catch\s*\(/.test(code),
      hasInputValidation: /if\s*\(.*\.length|if\s*\(.*undefined|if\s*\(!/.test(code),
      usesModernSyntax: /const\s+|let\s+|=>|\.map\(|\.filter\(/.test(code),
      
      // Logic analysis
      hasLoops: /for\s*\(|while\s*\(|\.forEach\(|\.map\(/.test(code),
      hasConditionals: /if\s*\(|switch\s*\(|\?\s*:/.test(code),
      hasRandomization: /Math\.random|Math\.floor/.test(code),
      hasSetOrArrayUsage: /new Set|new Array|\[\]/.test(code),
      
      // Task-specific analysis
      targetNumber: this.extractTargetNumber(code),
      actualOutputCount: null, // Will be filled from Docker output
      achievesTarget: false, // Will be determined from output analysis
      outputQuality: this.assessOutputQuality(code),
      
      // Common issues
      syntaxErrors: this.findSyntaxErrors(code),
      logicErrors: this.findLogicErrors(code),
      performanceIssues: this.findPerformanceIssues(code),
      bestPracticeViolations: this.findBestPracticeViolations(code)
    };
  }
  
  /**
   * Analyzes Docker container output
   */
  static analyzeDockerOutput(output: string): DockerOutputAnalysis {
    const lines = output.split('\n').filter(line => line.trim().length > 0);
    
    // Try to parse as different formats
    let items: string[] = [];
    let outputFormat: DockerOutputAnalysis['outputFormat'] = 'unknown';
    
    try {
      // Try JSON array format
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        items = parsed.map(String);
        outputFormat = 'json';
      }
    } catch {
      // Try numbered list format
      const numberedItems = lines.filter(line => /^\d+\./.test(line.trim()));
      if (numberedItems.length > 0) {
        items = numberedItems.map(line => line.replace(/^\d+\.\s*/, '').trim());
        outputFormat = 'list';
      } else {
        // Treat as text lines
        items = lines.filter(line => 
          !line.includes('npm warn') && 
          !line.includes('Node.js') && 
          !line.includes('notice') &&
          !line.includes('✅') &&
          !line.includes('Testing')
        );
        outputFormat = 'text';
      }
    }
    
    const uniqueItems = [...new Set(items)];
    
    return {
      itemCount: items.length,
      uniqueItemCount: uniqueItems.length,
      averageLength: items.length > 0 ? items.reduce((sum, item) => sum + item.length, 0) / items.length : 0,
      containsTarget: output.includes('1042'),
      outputFormat,
      sampleItems: items.slice(0, 10),
      errors: lines.filter(line => 
        line.includes('Error') || 
        line.includes('error') || 
        line.includes('failed') ||
        line.includes('TypeError') ||
        line.includes('ReferenceError')
      )
    };
  }
  
  /**
   * Combines code and output analysis for comprehensive evaluation
   */
  static generateComprehensiveAnalysis(
    modelName: string,
    code: string,
    dockerOutput: string | undefined,
    executionSuccess: boolean
  ) {
    const codeQuality = this.analyzeCodeQuality(code);
    const outputAnalysis = dockerOutput ? this.analyzeDockerOutput(dockerOutput) : null;
    
    // Update code quality with output analysis
    if (outputAnalysis) {
      codeQuality.actualOutputCount = outputAnalysis.itemCount;
      codeQuality.achievesTarget = outputAnalysis.uniqueItemCount >= (codeQuality.targetNumber || 1042);
    }
    
    return {
      modelName,
      timestamp: new Date().toISOString(),
      executionSuccess,
      codeQuality,
      outputAnalysis,
      overallAssessment: this.generateOverallAssessment(codeQuality, outputAnalysis, executionSuccess),
      recommendations: this.generateRecommendations(codeQuality, outputAnalysis)
    };
  }
  
  /**
   * Helper methods
   */
  private static countMatches(text: string, regex: RegExp): number {
    return (text.match(regex) || []).length;
  }
  
  private static calculateComplexity(code: string): number {
    // Simple cyclomatic complexity calculation
    const complexityKeywords = /if\s*\(|else\s+if|while\s*\(|for\s*\(|switch\s*\(|catch\s*\(|\|\||&&|\?\s*:/g;
    return 1 + this.countMatches(code, complexityKeywords);
  }
  
  private static extractTargetNumber(code: string): number | null {
    const match = code.match(/(\d+)/g);
    if (match) {
      const numbers = match.map(Number).filter(n => n > 100);
      return numbers.find(n => n === 1042) || numbers[0] || null;
    }
    return null;
  }
  
  private static assessOutputQuality(code: string): CodeQualityMetrics['outputQuality'] {
    let score = 0;
    
    if (/Set|unique|distinct/i.test(code)) score += 2;
    if (/random|Math\.random/i.test(code)) score += 1;
    if (/while|for.*length/i.test(code)) score += 1;
    if (/function.*generate/i.test(code)) score += 1;
    if (/console\.log|return/i.test(code)) score += 1;
    
    if (score >= 5) return 'excellent';
    if (score >= 3) return 'good';
    if (score >= 2) return 'fair';
    return 'poor';
  }
  
  private static findSyntaxErrors(code: string): string[] {
    const errors: string[] = [];
    
    // Common syntax errors
    if (/\w+\s+\d+\s*\)/g.test(code)) {
      errors.push('Missing comparison operator in loop condition');
    }
    
    if (/\(\s*\)/g.test(code) && !/function.*\(\s*\)/g.test(code)) {
      errors.push('Empty parentheses without function declaration');
    }
    
    // Unmatched brackets
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push('Unmatched braces');
    }
    
    return errors;
  }
  
  private static findLogicErrors(code: string): string[] {
    const errors: string[] = [];
    
    // Infinite loop potential
    if (/while\s*\(\s*true\s*\)/.test(code) && !/break/.test(code)) {
      errors.push('Potential infinite loop without break condition');
    }
    
    // Variable usage before declaration
    const lines = code.split('\n');
    const declaredVars = new Set<string>();
    
    for (const line of lines) {
      const varDecl = line.match(/(?:const|let|var)\s+(\w+)/);
      if (varDecl) {
        declaredVars.add(varDecl[1]);
      }
      
      const varUsage = line.match(/(\w+)(?:\.|=|\(|\[)/g);
      if (varUsage) {
        for (const usage of varUsage) {
          const varName = usage.replace(/[.=(\[].*/, '');
          if (!declaredVars.has(varName) && !['console', 'Math', 'Set', 'Array'].includes(varName)) {
            errors.push(`Variable '${varName}' used before declaration`);
          }
        }
      }
    }
    
    return errors;
  }
  
  private static findPerformanceIssues(code: string): string[] {
    const issues: string[] = [];
    
    // Inefficient array operations
    if (/\.push.*for|\.push.*while/.test(code)) {
      issues.push('Using push in loop - consider pre-allocation');
    }
    
    // Unnecessary repeated operations
    if (/Math\.random.*Math\.random/.test(code)) {
      issues.push('Multiple random calls - consider caching');
    }
    
    return issues;
  }
  
  private static findBestPracticeViolations(code: string): string[] {
    const violations: string[] = [];
    
    // No type annotations
    if (!/:\s*\w+/.test(code)) {
      violations.push('Missing type annotations');
    }
    
    // Using var instead of const/let
    if (/var\s+/.test(code)) {
      violations.push('Using var instead of const/let');
    }
    
    // No error handling
    if (!/try|catch/.test(code)) {
      violations.push('No error handling implemented');
    }
    
    return violations;
  }
  
  private static generateOverallAssessment(
    codeQuality: CodeQualityMetrics,
    outputAnalysis: DockerOutputAnalysis | null,
    executionSuccess: boolean
  ): string {
    if (!executionSuccess) {
      return 'Failed - Code contains syntax or runtime errors preventing execution';
    }
    
    if (!outputAnalysis) {
      return 'Unknown - No output analysis available';
    }
    
    if (codeQuality.achievesTarget && outputAnalysis.uniqueItemCount >= 1042) {
      return 'Excellent - Meets all requirements with good code quality';
    }
    
    if (outputAnalysis.itemCount > 0) {
      return 'Partial - Code executes but may not meet all requirements';
    }
    
    return 'Poor - Code executes but produces insufficient output';
  }
  
  private static generateRecommendations(
    codeQuality: CodeQualityMetrics,
    outputAnalysis: DockerOutputAnalysis | null
  ): string[] {
    const recommendations: string[] = [];
    
    if (codeQuality.syntaxErrors.length > 0) {
      recommendations.push('Fix syntax errors to ensure code compilation');
    }
    
    if (codeQuality.logicErrors.length > 0) {
      recommendations.push('Address logic errors to improve code correctness');
    }
    
    if (!codeQuality.hasSetOrArrayUsage && codeQuality.targetNumber) {
      recommendations.push('Use Set data structure to ensure unique items');
    }
    
    if (!codeQuality.hasRandomization) {
      recommendations.push('Add randomization to generate diverse content');
    }
    
    if (outputAnalysis && outputAnalysis.itemCount < (codeQuality.targetNumber || 1042)) {
      recommendations.push(`Increase output to meet target of ${codeQuality.targetNumber || 1042} items`);
    }
    
    if (codeQuality.bestPracticeViolations.length > 0) {
      recommendations.push('Follow TypeScript best practices for better code quality');
    }
    
    return recommendations;
  }
}
