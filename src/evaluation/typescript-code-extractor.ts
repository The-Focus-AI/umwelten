/**
 * TypeScript Code Extractor
 * Utility functions for extracting and validating TypeScript code from model responses
 */

/**
 * Extracts TypeScript code from a model response
 * @param response The model response content
 * @returns The extracted TypeScript code or null if not found
 */
export function extractTypeScriptCode(response: string): string | null {
  // Support both ```typescript and ```ts code blocks
  const codeBlockRegex = /```(?:typescript|ts)\n([\s\S]*?)\n```/;
  const match = response.match(codeBlockRegex);
  return match ? match[1].trim() : null;
}

/**
 * Validates TypeScript syntax (basic validation)
 * @param code The TypeScript code to validate
 * @returns True if the code appears to have valid TypeScript structure
 */
export function validateTypeScriptSyntax(code: string): boolean {
  if (!code) return false;
  try {
    // Basic TypeScript validation
    const hasValidStructure = code.includes('function') || code.includes('const') || code.includes('let') || code.includes('class');
    const hasValidSyntax = !code.includes('undefined') || code.includes('return') || code.includes('console.log');
    return hasValidStructure && hasValidSyntax;
  } catch {
    return false;
  }
}

/**
 * Counts TypeScript keywords in content
 * @param content The content to analyze
 * @returns Number of TypeScript keywords found
 */
export function countTypeScriptKeywords(content: string): number {
  const keywords = [
    'function', 'const', 'let', 'var', 'class', 'interface', 'type', 'enum', 
    'import', 'export', 'return', 'if', 'else', 'for', 'while', 'switch', 
    'case', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'this', 
    'super', 'extends', 'implements', 'static', 'async', 'await', 'Promise', 
    'Array', 'Object', 'String', 'Number', 'Boolean'
  ];
  
  return keywords.reduce((count, keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'g');
    return count + (content.match(regex) || []).length;
  }, 0);
}

/**
 * Fixes common TypeScript syntax errors
 * @param code The TypeScript code to fix
 * @returns The fixed TypeScript code
 */
export function fixCommonTypeScriptErrors(code: string): string {
  let fixedCode = code;
  
  // Fix common loop condition errors
  fixedCode = fixedCode.replace(/i\s+(\d+)/g, 'i < $1');
  fixedCode = fixedCode.replace(/i\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, 'i < $1');
  
  return fixedCode;
}

/**
 * Analyzes TypeScript code quality
 * @param code The TypeScript code to analyze
 * @returns Analysis object with quality metrics
 */
export function analyzeTypeScriptCode(code: string) {
  return {
    length: code.length,
    functions: (code.match(/function/g) || []).length,
    arrays: (code.match(/\[/g) || []).length,
    objects: (code.match(/\{/g) || []).length,
    comments: (code.match(/\/\//g) || []).length,
    imports: (code.match(/import/g) || []).length,
    exports: (code.match(/export/g) || []).length,
    classes: (code.match(/class/g) || []).length,
    keywords: countTypeScriptKeywords(code),
    hasConsoleLog: code.includes('console.log'),
    hasTarget1042: code.includes('1042'),
    hasSyntaxErrors: code.includes('i  100') || code.includes('i  count')
  };
}
