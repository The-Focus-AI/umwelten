import { describe, it, expect } from 'vitest';
import {
  extractChanges,
  hasCodeChanges,
  extractCodeSnippets,
} from './change-extractor.js';

describe('change-extractor', () => {
  describe('extractChanges', () => {
    describe('git patch format', () => {
      it('should extract a new file from git diff', () => {
        const gitDiff = `
diff --git a/src/hello.ts b/src/hello.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/hello.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  return "world";
+}
`;

        const result = extractChanges(gitDiff);

        expect(result.success).toBe(true);
        expect(result.format).toBe('git-patch');
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.path).toBe('src/hello.ts');
        expect(file.type).toBe('create');
        expect(file.content).toBe('export function hello() {\n  return "world";\n}');
        expect(file.hunks).toBeDefined();
        expect(file.hunks?.[0].newStart).toBe(1);
        expect(file.hunks?.[0].newLines).toBe(3);
      });

      it('should extract a modified file from git diff', () => {
        const gitDiff = `
diff --git a/src/utils.ts b/src/utils.ts
index abc123..def456 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,6 @@
 export function add(a: number, b: number) {
-  return a + b;
+  // Perform addition
+  return a + b + 0;
 }
`;

        const result = extractChanges(gitDiff);

        expect(result.success).toBe(true);
        expect(result.format).toBe('git-patch');
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.path).toBe('src/utils.ts');
        expect(file.type).toBe('modify');
        expect(file.hunks).toBeDefined();
        expect(file.hunks?.length).toBe(1);
      });

      it('should extract a deleted file from git diff', () => {
        const gitDiff = `
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc123..0000000
--- a/src/old.ts
+++ /dev/null
`;

        const result = extractChanges(gitDiff);

        expect(result.success).toBe(true);
        expect(result.format).toBe('git-patch');
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.path).toBe('src/old.ts');
        expect(file.type).toBe('delete');
      });

      it('should extract a renamed file from git diff', () => {
        const gitDiff = `
diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
`;

        const result = extractChanges(gitDiff);

        expect(result.success).toBe(true);
        expect(result.format).toBe('git-patch');
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.path).toBe('src/old-name.ts');
        expect(file.type).toBe('rename');
        expect(file.newPath).toBe('src/new-name.ts');
      });

      it('should extract multiple files from git diff', () => {
        const gitDiff = `
diff --git a/src/file1.ts b/src/file1.ts
new file mode 100644
--- /dev/null
+++ b/src/file1.ts
@@ -0,0 +1,1 @@
+export const a = 1;

diff --git a/src/file2.ts b/src/file2.ts
new file mode 100644
--- /dev/null
+++ b/src/file2.ts
@@ -0,0 +1,1 @@
+export const b = 2;
`;

        const result = extractChanges(gitDiff);

        expect(result.success).toBe(true);
        expect(result.files).toHaveLength(2);
        expect(result.files[0].path).toBe('src/file1.ts');
        expect(result.files[1].path).toBe('src/file2.ts');
      });
    });

    describe('unified diff format', () => {
      it('should extract a new file from unified diff', () => {
        const unifiedDiff = `
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+function test() {
+  return true;
+}
`;

        const result = extractChanges(unifiedDiff);

        expect(result.success).toBe(true);
        expect(result.format).toBe('unified-diff');
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.path).toBe('src/new.ts');
        expect(file.type).toBe('create');
        expect(file.content).toContain('function test()');
      });

      it('should extract a modified file from unified diff', () => {
        const unifiedDiff = `
--- a/src/file.ts
+++ b/src/file.ts
@@ -10,7 +10,8 @@ function example() {
   const x = 1;
-  const y = 2;
+  const y = 3;
+  const z = 4;
   return x + y;
 }
`;

        const result = extractChanges(unifiedDiff);

        expect(result.success).toBe(true);
        expect(result.format).toBe('unified-diff');
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.path).toBe('src/file.ts');
        expect(file.type).toBe('modify');
        expect(file.hunks).toBeDefined();
        expect(file.hunks?.[0].oldStart).toBe(10);
        expect(file.hunks?.[0].oldLines).toBe(7);
        expect(file.hunks?.[0].newStart).toBe(10);
        expect(file.hunks?.[0].newLines).toBe(8);
      });

      it('should extract a deleted file from unified diff', () => {
        const unifiedDiff = `
--- a/src/removed.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-function old() {
-  return false;
-}
`;

        const result = extractChanges(unifiedDiff);

        expect(result.success).toBe(true);
        expect(result.format).toBe('unified-diff');
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.path).toBe('src/removed.ts');
        expect(file.type).toBe('delete');
      });

      it('should handle multiple hunks in a single file', () => {
        const unifiedDiff = `
--- a/src/multi.ts
+++ b/src/multi.ts
@@ -1,3 +1,4 @@
 function a() {
+  console.log('a');
   return 1;
 }
@@ -10,3 +11,4 @@ function b() {
 function c() {
+  console.log('c');
   return 3;
 }
`;

        const result = extractChanges(unifiedDiff);

        expect(result.success).toBe(true);
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.hunks).toHaveLength(2);
        expect(file.hunks?.[0].oldStart).toBe(1);
        expect(file.hunks?.[1].oldStart).toBe(10);
      });
    });

    describe('markdown code blocks', () => {
      it('should extract code from markdown with inline file path', () => {
        const markdown = `
Here's the new file:

\`\`\`typescript:src/example.ts
export function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`
`;

        const result = extractChanges(markdown);

        expect(result.success).toBe(true);
        expect(result.format).toBe('code-block');
        expect(result.files).toHaveLength(1);

        const file = result.files[0];
        expect(file.path).toBe('src/example.ts');
        expect(file.type).toBe('create');
        expect(file.content).toContain('export function greet');
      });

      it('should extract code from markdown with path label', () => {
        const markdown = `
Create a new file:

File: \`src/utils.ts\`

\`\`\`typescript
export function add(a: number, b: number) {
  return a + b;
}
\`\`\`
`;

        const result = extractChanges(markdown);

        expect(result.success).toBe(true);
        expect(result.files).toHaveLength(1);
        expect(result.files[0].path).toBe('src/utils.ts');
      });

      it('should generate default filename from language', () => {
        const markdown = `
\`\`\`python
def hello():
    return "world"
\`\`\`
`;

        const result = extractChanges(markdown);

        expect(result.success).toBe(true);
        expect(result.files).toHaveLength(1);
        expect(result.files[0].path).toBe('untitled.py');
      });

      it('should extract multiple code blocks', () => {
        const markdown = `
\`\`\`typescript:src/a.ts
export const a = 1;
\`\`\`

\`\`\`typescript:src/b.ts
export const b = 2;
\`\`\`
`;

        const result = extractChanges(markdown);

        expect(result.success).toBe(true);
        expect(result.files).toHaveLength(2);
        expect(result.files[0].path).toBe('src/a.ts');
        expect(result.files[1].path).toBe('src/b.ts');
      });
    });

    describe('edge cases', () => {
      it('should return unsuccessful result for plain text', () => {
        const text = 'This is just plain text with no code changes.';

        const result = extractChanges(text);

        expect(result.success).toBe(false);
        expect(result.files).toHaveLength(0);
        expect(result.format).toBe('unknown');
      });

      it('should handle empty input', () => {
        const result = extractChanges('');

        expect(result.success).toBe(false);
        expect(result.files).toHaveLength(0);
      });

      it('should prioritize git patch over other formats', () => {
        const mixed = `
Some text with a code block:

\`\`\`typescript
const x = 1;
\`\`\`

And also a git diff:

diff --git a/src/file.ts b/src/file.ts
new file mode 100644
--- /dev/null
+++ b/src/file.ts
@@ -0,0 +1,1 @@
+export const y = 2;
`;

        const result = extractChanges(mixed);

        expect(result.success).toBe(true);
        expect(result.format).toBe('git-patch');
        expect(result.files).toHaveLength(1);
        expect(result.files[0].path).toBe('src/file.ts');
      });
    });
  });

  describe('hasCodeChanges', () => {
    it('should detect git diff markers', () => {
      expect(hasCodeChanges('diff --git a/file b/file')).toBe(true);
      expect(hasCodeChanges('@@ -1,1 +1,1 @@')).toBe(true);
    });

    it('should detect unified diff markers', () => {
      expect(hasCodeChanges('--- a/file\n+++ b/file')).toBe(true);
    });

    it('should detect code blocks', () => {
      expect(hasCodeChanges('```typescript\ncode\n```')).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(hasCodeChanges('Just regular text')).toBe(false);
    });
  });

  describe('extractCodeSnippets', () => {
    it('should extract code snippets with language', () => {
      const text = `
\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`python
y = 2
\`\`\`
`;

      const snippets = extractCodeSnippets(text);

      expect(snippets).toHaveLength(2);
      expect(snippets[0].language).toBe('typescript');
      expect(snippets[0].content).toBe('const x = 1;');
      expect(snippets[1].language).toBe('python');
      expect(snippets[1].content).toBe('y = 2');
    });

    it('should extract code snippets without language', () => {
      const text = '```\nplain code\n```';

      const snippets = extractCodeSnippets(text);

      expect(snippets).toHaveLength(1);
      expect(snippets[0].language).toBeUndefined();
      expect(snippets[0].content).toBe('plain code');
    });

    it('should return empty array for no code blocks', () => {
      const snippets = extractCodeSnippets('No code here');

      expect(snippets).toHaveLength(0);
    });
  });
});
