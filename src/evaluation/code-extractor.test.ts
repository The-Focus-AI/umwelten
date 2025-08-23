import { describe, it, expect } from 'vitest';
import { 
  extractAllCodeBlocks, 
  getCodeForLanguage, 
  getAvailableLanguages, 
  hasLanguage,
  fixCommonCodeErrors,
  ensureConsoleOutput
} from './code-extractor.js';

describe('Code Extractor', () => {
  describe('extractAllCodeBlocks', () => {
    it('should extract TypeScript code blocks', () => {
      const response = `
Here's a TypeScript solution:

\`\`\`typescript
function generateShowNames(): string[] {
  const names = [];
  for (let i = 0; i < 1042; i++) {
    names.push(\`Show \${i}\`);
  }
  return names;
}
\`\`\`

This will generate 1042 show names.
`;

      const result = extractAllCodeBlocks(response);
      
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].language).toBe('typescript');
      expect(result.blocks[0].code).toContain('function generateShowNames');
      expect(result.primaryLanguage).toBe('typescript');
    });

    it('should extract multiple language code blocks', () => {
      const response = `
Here are solutions in multiple languages:

\`\`\`typescript
function generateNames(): string[] {
  return Array.from({length: 1042}, (_, i) => \`Show \${i}\`);
}
\`\`\`

\`\`\`python
def generate_names():
    return [f"Show {i}" for i in range(1042)]
\`\`\`

\`\`\`ruby
def generate_names
  (0...1042).map { |i| "Show \#{i}" }
end
\`\`\`
`;

      const result = extractAllCodeBlocks(response);
      
      expect(result.blocks).toHaveLength(3);
      expect(result.blocks.map(b => b.language)).toEqual(['typescript', 'python', 'ruby']);
      expect(result.blocks[0].code).toContain('function generateNames');
      expect(result.blocks[1].code).toContain('def generate_names');
      expect(result.blocks[2].code).toContain('def generate_names');
    });

    it('should infer language from code content when no language specified', () => {
      const response = `
Here's some code:

\`\`\`
def generate_names():
    names = []
    for i in range(1042):
        names.append(f"Show {i}")
    return names
\`\`\`
`;

      const result = extractAllCodeBlocks(response);
      
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].language).toBe('python');
      expect(result.blocks[0].code).toContain('def generate_names');
    });

    it('should handle code blocks without language specification', () => {
      const response = `
Here's some JavaScript:

\`\`\`
const names = [];
for (let i = 0; i < 1042; i++) {
  names.push(\`Show \${i}\`);
}
console.log(names);
\`\`\`
`;

      const result = extractAllCodeBlocks(response);
      
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].language).toBe('javascript');
      expect(result.blocks[0].code).toContain('const names');
    });
  });

  describe('getCodeForLanguage', () => {
    it('should return code for specific language', () => {
      const extracted = extractAllCodeBlocks(`
\`\`\`typescript
function ts() { return "typescript"; }
\`\`\`

\`\`\`python
def py(): return "python"
\`\`\`
`);

      const typescriptCode = getCodeForLanguage(extracted, 'typescript');
      const pythonCode = getCodeForLanguage(extracted, 'python');
      
      expect(typescriptCode).toContain('function ts()');
      expect(pythonCode).toContain('def py()');
    });

    it('should return null for non-existent language', () => {
      const extracted = extractAllCodeBlocks(`
\`\`\`typescript
function ts() { return "typescript"; }
\`\`\`
`);

      const rubyCode = getCodeForLanguage(extracted, 'ruby');
      expect(rubyCode).toBeNull();
    });

    it('should handle language aliases (ts/typescript, js/javascript)', () => {
      const extracted = extractAllCodeBlocks(`
\`\`\`ts
console.log("TypeScript");
\`\`\`
\`\`\`js
console.log("JavaScript");
\`\`\`
`);

      // Should find TypeScript code when looking for 'typescript'
      const typescriptCode = getCodeForLanguage(extracted, 'typescript');
      expect(typescriptCode).toBe('console.log("TypeScript");');
      
      // Should find JavaScript code when looking for 'javascript'
      const javascriptCode = getCodeForLanguage(extracted, 'javascript');
      expect(javascriptCode).toBe('console.log("JavaScript");');
      
      // Should find TypeScript code when looking for 'ts'
      const tsCode = getCodeForLanguage(extracted, 'ts');
      expect(tsCode).toBe('console.log("TypeScript");');
      
      // Should find JavaScript code when looking for 'js'
      const jsCode = getCodeForLanguage(extracted, 'js');
      expect(jsCode).toBe('console.log("JavaScript");');
    });

    it('should handle Swift code blocks', () => {
      const extracted = extractAllCodeBlocks(`
\`\`\`swift
func generateNames() -> [String] {
    return (0..<1042).map { "Show \\($0)" }
}
print(generateNames())
\`\`\`
`);

      const swiftCode = getCodeForLanguage(extracted, 'swift');
      expect(swiftCode).toContain('func generateNames()');
      expect(swiftCode).toContain('print(generateNames())');
    });
  });

  describe('getAvailableLanguages', () => {
    it('should return unique language names', () => {
      const extracted = extractAllCodeBlocks(`
\`\`\`typescript
function ts() { return "typescript"; }
\`\`\`

\`\`\`python
def py(): return "python"
\`\`\`

\`\`\`typescript
function ts2() { return "typescript2"; }
\`\`\`
`);

      const languages = getAvailableLanguages(extracted);
      expect(languages).toEqual(['typescript', 'python']);
    });
  });

  describe('hasLanguage', () => {
    it('should return true for existing language', () => {
      const extracted = extractAllCodeBlocks(`
\`\`\`typescript
function ts() { return "typescript"; }
\`\`\`
`);

      expect(hasLanguage(extracted, 'typescript')).toBe(true);
      expect(hasLanguage(extracted, 'python')).toBe(false);
    });

    it('should handle language aliases', () => {
      const extracted = extractAllCodeBlocks(`
\`\`\`ts
console.log("TypeScript");
\`\`\`
\`\`\`js
console.log("JavaScript");
\`\`\`
`);

      // Should recognize 'ts' as 'typescript'
      expect(hasLanguage(extracted, 'typescript')).toBe(true);
      expect(hasLanguage(extracted, 'ts')).toBe(true);
      
      // Should recognize 'js' as 'javascript'
      expect(hasLanguage(extracted, 'javascript')).toBe(true);
      expect(hasLanguage(extracted, 'js')).toBe(true);
      
      // Should not recognize other languages
      expect(hasLanguage(extracted, 'python')).toBe(false);
    });

    it('should infer Swift from code content', () => {
      const response = `
Here's some Swift code:

\`\`\`
func generateNames() -> [String] {
    let names = (0..<1042).map { "Show \\($0)" }
    return names
}
print(generateNames())
\`\`\`
`;

      const result = extractAllCodeBlocks(response);
      
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].language).toBe('swift');
      expect(result.blocks[0].code).toContain('func generateNames');
    });
  });

  describe('fixCommonCodeErrors', () => {
    it('should fix TypeScript loop conditions', () => {
      const code = `
for (let i = 0; i 10; i++) {
  console.log(i);
}
`;
      const fixed = fixCommonCodeErrors(code, 'typescript');
      expect(fixed).toContain('i < 10');
    });

    it('should fix Python print statements', () => {
      const code = `
print "Hello World"
print name
`;
      const fixed = fixCommonCodeErrors(code, 'python');
      expect(fixed).toContain('print("Hello World")');
      expect(fixed).toContain('print(name)');
    });

    it('should add shebang to bash scripts', () => {
      const code = `
echo "Hello World"
for i in {1..10}; do
  echo $i
done
`;
      const fixed = fixCommonCodeErrors(code, 'bash');
      expect(fixed).toContain('#!/bin/bash');
    });

    it('should fix Swift print statements and string interpolation', () => {
      const code = `
print "Hello World"
let message = "Count: \${count}"
print message
`;
      const fixed = fixCommonCodeErrors(code, 'swift');
      expect(fixed).toContain('print("Hello World")');
      expect(fixed).toContain('let message = "Count: \\(count)"');
      expect(fixed).toContain('print(message)');
    });
  });

  describe('ensureConsoleOutput', () => {
    it('should remove file writing from TypeScript', () => {
      const code = `
import * as fs from 'fs';
const names = ['Show 1', 'Show 2'];
fs.writeFileSync('output.txt', names.join('\\n'));
console.log(names);
`;
      const modified = ensureConsoleOutput(code, 'typescript');
      expect(modified).not.toContain('fs.writeFileSync');
      expect(modified).toContain('console.log(names)');
    });

    it('should remove file writing from Python', () => {
      const code = `
names = ['Show 1', 'Show 2']
with open('output.txt', 'w') as f:
    f.write('\\n'.join(names))
print(names)
`;
      const modified = ensureConsoleOutput(code, 'python');
      expect(modified).not.toContain('with open');
      expect(modified).toContain('print(names)');
    });

    it('should remove file writing from Swift', () => {
      const code = `
let names = ["Show 1", "Show 2"]
try names.joined(separator: "\\n").write(toFile: "output.txt", atomically: true, encoding: .utf8)
print(names)
`;
      const modified = ensureConsoleOutput(code, 'swift');
      expect(modified).not.toContain('write(toFile:');
      expect(modified).toContain('print(names)');
    });
  });
});
