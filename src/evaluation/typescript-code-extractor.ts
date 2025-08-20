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
  
  // Fix missing comparison operators in while loops and conditions
  fixedCode = fixedCode.replace(/(\w+\.size)\s+(\d+)/g, '$1 < $2');
  fixedCode = fixedCode.replace(/(\w+\.length)\s+(\d+)/g, '$1 < $2');
  fixedCode = fixedCode.replace(/(\w+)\s+(\d+)\s*\)/g, '$1 < $2)');
  
  // Fix common variable name issues
  fixedCode = fixedCode.replace(/\bsize\s+<\s+(\d+)/g, 'size < $1');
  
  return fixedCode;
}

/**
 * Ensures the code outputs to console.log instead of writing to files
 * @param code The TypeScript code to modify
 * @returns The modified code that outputs to console.log
 */
export function ensureConsoleOutput(code: string): string {
  let modifiedCode = code;
  
  // Remove file writing operations
  modifiedCode = modifiedCode.replace(/fs\.writeFileSync\([^)]+\);/g, '');
  modifiedCode = modifiedCode.replace(/fs\.writeFile\([^)]+\);/g, '');
  modifiedCode = modifiedCode.replace(/fs\.writeFileSync\([^)]+\)/g, '');
  modifiedCode = modifiedCode.replace(/fs\.writeFile\([^)]+\)/g, '');
  
  // Remove file system imports if they're not needed
  if (!modifiedCode.includes('fs.readFile') && !modifiedCode.includes('fs.readFileSync')) {
    modifiedCode = modifiedCode.replace(/import\s+\*\s+as\s+fs\s+from\s+['"]fs['"];?\n?/g, '');
    modifiedCode = modifiedCode.replace(/import\s+fs\s+from\s+['"]fs['"];?\n?/g, '');
  }
  
  // Remove path imports if they're not needed
  if (!modifiedCode.includes('path.resolve') && !modifiedCode.includes('path.join')) {
    modifiedCode = modifiedCode.replace(/import\s+\*\s+as\s+path\s+from\s+['"]path['"];?\n?/g, '');
    modifiedCode = modifiedCode.replace(/import\s+path\s+from\s+['"]path['"];?\n?/g, '');
  }
  
  // Find the main generation function and ensure it outputs to console.log
  if (modifiedCode.includes('generateShowNames') || modifiedCode.includes('generateFunnyShowNames')) {
    // Look for where the names are generated and add console.log
    if (modifiedCode.includes('const names =') || modifiedCode.includes('const showNames =')) {
      modifiedCode = modifiedCode.replace(
        /(const\s+(?:names|showNames)\s*=\s*[^;]+;)/g,
        '$1\n$2.forEach(name => console.log(name));'
      );
    }
    
    // If there's a return statement, add console.log before it
    if (modifiedCode.includes('return names') || modifiedCode.includes('return showNames')) {
      modifiedCode = modifiedCode.replace(
        /(return\s+(?:names|showNames));/g,
        '$1.forEach(name => console.log(name));\nreturn $2;'
      );
    }
  }
  
  // If the code has a main execution block, ensure it outputs
  if (modifiedCode.includes('console.log(') && !modifiedCode.includes('forEach')) {
    // Add forEach after any existing console.log
    modifiedCode = modifiedCode.replace(
      /(console\.log\([^)]+\));/g,
      '$1\nnames.forEach(name => console.log(name));'
    );
  }
  
  // If there's no console.log at all, add a simple one at the end
  if (!modifiedCode.includes('console.log')) {
    modifiedCode += '\n\n// Output the generated names\nnames.forEach(name => console.log(name));';
  }
  
  return modifiedCode;
}

/**
 * Analyzes TypeScript code quality
 * @param code The TypeScript code to analyze
 * @returns Analysis object with quality metrics
 */
export function analyzeTypeScriptCode(code: string) {
  const errors: string[] = [];
  
  // Check for common syntax errors
  if (code.includes('i  100') || code.includes('i  count')) {
    errors.push('Invalid loop condition syntax');
  }
  
  if (!code.includes('function') && !code.includes('const') && !code.includes('let')) {
    errors.push('No function or variable declarations found');
  }
  
  if (!code.includes('console.log') && !code.includes('return')) {
    errors.push('No output mechanism found');
  }
  
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
    hasSyntaxErrors: code.includes('i  100') || code.includes('i  count'),
    isValid: errors.length === 0,
    errors: errors
  };
}
