/**
 * Generic Code Extractor
 * Extracts code blocks from model responses and identifies their language types
 */

export interface CodeBlock {
  language: string;
  code: string;
  startIndex: number;
  endIndex: number;
}

export interface ExtractedCode {
  blocks: CodeBlock[];
  primaryLanguage?: string;
  allCode: string;
}

/**
 * Extracts all code blocks from a model response
 * @param response The model response content
 * @returns Object containing all code blocks and their languages
 */
export function extractAllCodeBlocks(response: string): ExtractedCode {
  const blocks: CodeBlock[] = [];
  
  // Match all code blocks (with or without language specification)
  const allCodeBlocks = response.match(/```(\w+)?\n([\s\S]*?)\n```/g);
  
  if (allCodeBlocks) {
    for (const codeBlock of allCodeBlocks) {
      // Extract language and code from the block
      const match = codeBlock.match(/```(\w+)?\n([\s\S]*?)\n```/);
      if (match) {
        const rawLanguage = match[1] ? match[1].toLowerCase() : inferLanguageFromCode(match[2].trim());
        const language = normalizeLanguage(rawLanguage);
        const code = match[2].trim();
        const startIndex = response.indexOf(codeBlock);
        
        blocks.push({
          language,
          code,
          startIndex,
          endIndex: startIndex + codeBlock.length
        });
      }
    }
  }
  
  // Combine all code into one string
  const allCode = blocks.map(block => block.code).join('\n\n');
  
  // Determine primary language (most common or first)
  const languageCounts = blocks.reduce((counts, block) => {
    counts[block.language] = (counts[block.language] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  
  const primaryLanguage = Object.keys(languageCounts).length > 0 
    ? Object.entries(languageCounts).sort(([,a], [,b]) => b - a)[0][0]
    : undefined;
  
  return {
    blocks,
    primaryLanguage,
    allCode
  };
}

/**
 * Normalizes language names to handle aliases
 * @param language The language name to normalize
 * @returns Normalized language name
 */
function normalizeLanguage(language: string): string {
  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'typescript': 'typescript',
    'js': 'javascript',
    'javascript': 'javascript',
    'py': 'python',
    'python': 'python',
    'rb': 'ruby',
    'ruby': 'ruby',
    'pl': 'perl',
    'perl': 'perl',
    'sh': 'bash',
    'bash': 'bash',
    'php': 'php',
    'java': 'java',
    'go': 'go',
    'rust': 'rust',
    'swift': 'swift'
  };
  
  return languageMap[language.toLowerCase()] || language.toLowerCase();
}

/**
 * Infers programming language from code content
 * @param code The code to analyze
 * @returns Inferred language name
 */
function inferLanguageFromCode(code: string): string {
  const languageHints = [
    { language: 'typescript', patterns: ['function', 'const', 'let', 'interface', 'type', 'import', 'export'] },
    { language: 'javascript', patterns: ['function', 'const', 'let', 'var', 'console.log', '=>'] },
    { language: 'python', patterns: ['def ', 'import ', 'print(', 'if __name__', 'class ', 'self.'] },
    { language: 'ruby', patterns: ['def ', 'puts ', 'class ', 'attr_accessor', 'require ', 'module '] },
    { language: 'perl', patterns: ['sub ', 'my ', 'print ', 'use ', 'package ', '$', '@', '%'] },
    { language: 'bash', patterns: ['#!/bin/bash', 'echo ', 'for ', 'while ', 'if [', 'function '] },
    { language: 'php', patterns: ['<?php', 'function ', 'echo ', 'class ', 'public ', 'private '] },
    { language: 'java', patterns: ['public class', 'public static void main', 'System.out.println', 'import java'] },
    { language: 'go', patterns: ['package main', 'func ', 'import ', 'fmt.Println', 'var ', 'type '] },
    { language: 'rust', patterns: ['fn ', 'let ', 'println!', 'use ', 'struct ', 'impl '] },
    { language: 'swift', patterns: ['func ', 'var ', 'let ', 'print(', 'import ', 'class ', 'struct ', 'enum ', 'protocol '] }
  ];
  
  const scores: Record<string, number> = {};
  
  for (const hint of languageHints) {
    let score = 0;
    for (const pattern of hint.patterns) {
      const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const matches = code.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    scores[hint.language] = score;
  }
  
  // Return the language with the highest score, or 'unknown' if no clear match
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return 'unknown';
  
  const bestLanguage = Object.entries(scores).find(([, score]) => score === maxScore)?.[0];
  return bestLanguage || 'unknown';
}

/**
 * Gets code for a specific language from extracted blocks
 * @param extracted Extracted code object
 * @param language Target language
 * @returns Code for the specified language, or null if not found
 */
export function getCodeForLanguage(extracted: ExtractedCode, language: string): string | null {
  const normalizedLanguage = normalizeLanguage(language);
  const languageBlocks = extracted.blocks.filter(block => block.language === normalizedLanguage);
  if (languageBlocks.length === 0) return null;
  
  return languageBlocks.map(block => block.code).join('\n\n');
}

/**
 * Gets all available languages from extracted code
 * @param extracted Extracted code object
 * @returns Array of unique language names
 */
export function getAvailableLanguages(extracted: ExtractedCode): string[] {
  return [...new Set(extracted.blocks.map(block => block.language))];
}

/**
 * Validates if the extracted code contains the expected language
 * @param extracted Extracted code object
 * @param expectedLanguage Expected language
 * @returns True if the expected language is found
 */
export function hasLanguage(extracted: ExtractedCode, expectedLanguage: string): boolean {
  const normalizedLanguage = normalizeLanguage(expectedLanguage);
  return extracted.blocks.some(block => block.language === normalizedLanguage);
}

/**
 * Fixes common code issues across languages
 * @param code The code to fix
 * @param language The programming language
 * @returns Fixed code
 */
export function fixCommonCodeErrors(code: string, language: string): string {
  let fixedCode = code;
  const normalizedLanguage = normalizeLanguage(language);
  
  switch (normalizedLanguage) {
    case 'typescript':
    case 'javascript':
      // Fix common loop condition errors
      fixedCode = fixedCode.replace(/i\s+(\d+)/g, 'i < $1');
      fixedCode = fixedCode.replace(/i\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, 'i < $1');
      // Fix missing comparison operators
      fixedCode = fixedCode.replace(/(\w+\.size)\s+(\d+)/g, '$1 < $2');
      fixedCode = fixedCode.replace(/(\w+\.length)\s+(\d+)/g, '$1 < $2');
      break;
      
    case 'python':
      // Fix print statements
      fixedCode = fixedCode.replace(/print\s+([^()\n]+)/g, 'print($1)');
      break;
      
    case 'ruby':
      // Fix puts statements
      fixedCode = fixedCode.replace(/puts\s+([^()]+)/g, 'puts $1');
      break;
      
    case 'bash':
      // Ensure executable permissions
      if (!fixedCode.startsWith('#!/bin/bash') && !fixedCode.startsWith('#!/bin/sh')) {
        fixedCode = '#!/bin/bash\n' + fixedCode;
      }
      break;
      
    case 'swift':
      // Fix print statements
      fixedCode = fixedCode.replace(/print\s+([^()\n]+)/g, 'print($1)');
      // Fix string interpolation
      fixedCode = fixedCode.replace(/\$\{([^}]+)\}/g, '\\($1)');
      break;
  }
  
  return fixedCode;
}

/**
 * Ensures code outputs to console/print instead of writing to files
 * @param code The code to modify
 * @param language The programming language
 * @returns Modified code that outputs to console
 */
export function ensureConsoleOutput(code: string, language: string): string {
  let modifiedCode = code;
  const normalizedLanguage = normalizeLanguage(language);
  
  switch (normalizedLanguage) {
    case 'typescript':
    case 'javascript':
      // Remove file writing operations
      modifiedCode = modifiedCode.replace(/fs\.writeFileSync\([^)]+\);?\n?/g, '');
      modifiedCode = modifiedCode.replace(/fs\.writeFile\([^)]+\);?\n?/g, '');
      // Remove file system imports if not needed
      if (!modifiedCode.includes('fs.readFile') && !modifiedCode.includes('fs.readFileSync')) {
        modifiedCode = modifiedCode.replace(/import\s+\*\s+as\s+fs\s+from\s+['"]fs['"];?\n?/g, '');
        modifiedCode = modifiedCode.replace(/import\s+fs\s+from\s+['"]fs['"];?\n?/g, '');
      }
      break;
      
    case 'python':
      // Remove file writing operations
      modifiedCode = modifiedCode.replace(/with open\([^)]+\) as f:/g, '# File writing removed');
      modifiedCode = modifiedCode.replace(/f\.write\([^)]+\)/g, '# File writing removed');
      break;
      
    case 'ruby':
      // Remove file writing operations
      modifiedCode = modifiedCode.replace(/File\.write\([^)]+\)/g, '# File writing removed');
      modifiedCode = modifiedCode.replace(/File\.open\([^)]+\)/g, '# File writing removed');
      break;
      
    case 'perl':
      // Remove file writing operations
      modifiedCode = modifiedCode.replace(/open\([^)]+\)/g, '# File writing removed');
      break;
      
    case 'swift':
      // Remove file writing operations
      modifiedCode = modifiedCode.replace(/try\s+String\(contentsOfFile:[^)]+\)/g, '# File writing removed');
      modifiedCode = modifiedCode.replace(/try\s+[^)]+\.write\(toFile:[^)]+\)/g, '# File writing removed');
      modifiedCode = modifiedCode.replace(/\.write\(toFile:[^)]+\)/g, '# File writing removed');
      break;
  }
  
  return modifiedCode;
}
