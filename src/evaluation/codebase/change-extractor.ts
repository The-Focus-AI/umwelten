/**
 * Change extractor - extracts code changes from model responses
 * Supports unified diff, git patch, and markdown code block formats
 */

import type { ExtractedChanges, FileChange, DiffHunk } from './types.js';

/**
 * Extract code changes from a model response
 */
export function extractChanges(responseText: string): ExtractedChanges {
  const errors: string[] = [];
  let format: ExtractedChanges['format'] = 'unknown';
  const files: FileChange[] = [];

  // Try different extraction strategies in order of specificity
  const strategies = [
    extractGitPatchFormat,
    extractUnifiedDiffFormat,
    extractMarkdownCodeBlocks,
  ];

  let extractedFiles: FileChange[] = [];
  let detectedFormat: ExtractedChanges['format'] = 'unknown';

  for (const strategy of strategies) {
    const result = strategy(responseText);
    if (result.files.length > 0) {
      extractedFiles = result.files;
      detectedFormat = result.format;
      break;
    }
  }

  // If multiple formats detected, mark as mixed
  if (extractedFiles.length > 0) {
    files.push(...extractedFiles);
    format = detectedFormat;
  }

  return {
    success: files.length > 0,
    files,
    format,
    rawContent: responseText,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Extract changes in git patch format (git diff output)
 */
function extractGitPatchFormat(text: string): {
  files: FileChange[];
  format: ExtractedChanges['format'];
} {
  const files: FileChange[] = [];

  // Match git diff headers: diff --git a/path b/path
  const gitDiffPattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  const matches = Array.from(text.matchAll(gitDiffPattern));

  if (matches.length === 0) {
    return { files, format: 'unknown' };
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const startIdx = match.index!;
    const endIdx = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    const diffBlock = text.substring(startIdx, endIdx);

    const fileChange = parseGitDiffBlock(diffBlock);
    if (fileChange) {
      files.push(fileChange);
    }
  }

  return { files, format: 'git-patch' };
}

/**
 * Parse a single git diff block
 */
function parseGitDiffBlock(block: string): FileChange | null {
  const lines = block.split('\n');

  // Parse header
  const diffLine = lines.find(l => l.startsWith('diff --git'));
  if (!diffLine) return null;

  const pathMatch = diffLine.match(/^diff --git a\/(.+?) b\/(.+?)$/);
  if (!pathMatch) return null;

  const oldPath = pathMatch[1];
  const newPath = pathMatch[2];

  // Check for file operations
  const isNew = lines.some(l => l.startsWith('new file mode'));
  const isDeleted = lines.some(l => l.startsWith('deleted file mode'));
  const isRenamed = oldPath !== newPath;

  // Extract the unified diff content
  const unifiedDiffStart = lines.findIndex(l => l.startsWith('@@'));

  let diffContent = '';
  let hunks: DiffHunk[] = [];

  if (unifiedDiffStart !== -1) {
    diffContent = lines.slice(unifiedDiffStart).join('\n');
    hunks = parseDiffHunks(diffContent);
  } else if (!isDeleted && !isRenamed) {
    // No diff content found for a modification
    return null;
  }

  if (isNew) {
    // Extract full file content from diff
    const content = extractContentFromNewFileDiff(diffContent);
    return {
      path: newPath,
      type: 'create',
      content,
      diff: diffContent,
      hunks,
    };
  }

  if (isDeleted) {
    return {
      path: oldPath,
      type: 'delete',
    };
  }

  if (isRenamed) {
    return {
      path: oldPath,
      type: 'rename',
      newPath,
      diff: diffContent,
      hunks,
    };
  }

  // Regular modification
  return {
    path: newPath,
    type: 'modify',
    diff: diffContent,
    hunks,
  };
}

/**
 * Extract changes in unified diff format (diff -u output)
 */
function extractUnifiedDiffFormat(text: string): {
  files: FileChange[];
  format: ExtractedChanges['format'];
} {
  const files: FileChange[] = [];

  // Match unified diff headers: --- a/path and +++ b/path
  const unifiedDiffPattern = /^--- (?:a\/)?(.+?)\s*\n\+\+\+ (?:b\/)?(.+?)\s*$/gm;
  const matches = Array.from(text.matchAll(unifiedDiffPattern));

  if (matches.length === 0) {
    return { files, format: 'unknown' };
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const startIdx = match.index!;
    const endIdx = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    const diffBlock = text.substring(startIdx, endIdx);

    const fileChange = parseUnifiedDiffBlock(diffBlock);
    if (fileChange) {
      files.push(fileChange);
    }
  }

  return { files, format: 'unified-diff' };
}

/**
 * Parse a single unified diff block
 */
function parseUnifiedDiffBlock(block: string): FileChange | null {
  const lines = block.split('\n');

  // Parse header
  const oldFileLine = lines[0];
  const newFileLine = lines[1];

  const oldFileMatch = oldFileLine.match(/^--- (?:a\/)?(.+?)(?:\s|$)/);
  const newFileMatch = newFileLine.match(/^\+\+\+ (?:b\/)?(.+?)(?:\s|$)/);

  if (!oldFileMatch || !newFileMatch) return null;

  const oldPath = oldFileMatch[1];
  const newPath = newFileMatch[1];

  // Check for special paths indicating new/deleted files
  const isNew = oldPath === '/dev/null' || oldPath === 'dev/null';
  const isDeleted = newPath === '/dev/null' || newPath === 'dev/null';

  const diffContent = lines.slice(2).join('\n');
  const hunks = parseDiffHunks(diffContent);

  if (isNew) {
    const content = extractContentFromNewFileDiff(diffContent);
    return {
      path: newPath,
      type: 'create',
      content,
      diff: diffContent,
      hunks,
    };
  }

  if (isDeleted) {
    return {
      path: oldPath,
      type: 'delete',
    };
  }

  return {
    path: newPath,
    type: 'modify',
    diff: diffContent,
    hunks,
  };
}

/**
 * Parse diff hunks from unified diff content
 */
function parseDiffHunks(diffContent: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffContent.split('\n');

  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkHeaderMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);

    if (hunkHeaderMatch) {
      // Save previous hunk
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      // Start new hunk
      currentHunk = {
        oldStart: parseInt(hunkHeaderMatch[1], 10),
        oldLines: hunkHeaderMatch[2] ? parseInt(hunkHeaderMatch[2], 10) : 1,
        newStart: parseInt(hunkHeaderMatch[3], 10),
        newLines: hunkHeaderMatch[4] ? parseInt(hunkHeaderMatch[4], 10) : 1,
        lines: [],
      };
    } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      // Add line to current hunk
      currentHunk.lines.push(line);
    }
  }

  // Save last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Extract full file content from a new file diff (all lines start with +)
 */
function extractContentFromNewFileDiff(diffContent: string): string {
  const lines = diffContent.split('\n');
  const contentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      // Remove the leading + and add to content
      contentLines.push(line.substring(1));
    }
  }

  return contentLines.join('\n');
}

/**
 * Extract changes from markdown code blocks
 */
function extractMarkdownCodeBlocks(text: string): {
  files: FileChange[];
  format: ExtractedChanges['format'];
} {
  const files: FileChange[] = [];

  // Match markdown code blocks with optional language and file path
  // Patterns:
  // ```typescript:src/file.ts
  // ```typescript
  // path: src/file.ts
  // ```
  const codeBlockPattern = /```(\w+)?(?::(.+?))?\s*\n([\s\S]*?)```/g;
  const matches = Array.from(text.matchAll(codeBlockPattern));

  if (matches.length === 0) {
    return { files, format: 'unknown' };
  }

  // Also look for explicit file path indicators before code blocks
  const filePathPattern = /(?:File|Path|Filename):\s*`?([^\s`\n]+)`?\s*\n+```/gi;
  const pathMatches = new Map<number, string>();

  for (const match of text.matchAll(filePathPattern)) {
    pathMatches.set(match.index!, match[1]);
  }

  for (const match of matches) {
    const language = match[1];
    const inlineFilePath = match[2];
    const content = match[3].trim();

    // Try to determine file path from various sources
    let filePath = inlineFilePath;

    if (!filePath) {
      // Look for path indicator before this code block
      const blockIndex = match.index!;
      for (const [pathIndex, path] of pathMatches) {
        if (pathIndex < blockIndex && blockIndex - pathIndex < 200) {
          filePath = path;
          break;
        }
      }
    }

    if (!filePath && language) {
      // Generate a default filename from language
      const extensions: Record<string, string> = {
        typescript: 'ts',
        javascript: 'js',
        python: 'py',
        rust: 'rs',
        go: 'go',
        java: 'java',
      };
      const ext = extensions[language] || language;
      filePath = `untitled.${ext}`;
    }

    if (!filePath) {
      filePath = 'untitled.txt';
    }

    // Determine if this is a new file or modification
    // For code blocks, we assume it's the full file content (create/modify)
    files.push({
      path: filePath,
      type: 'create', // Default to create; caller can refine based on context
      content,
    });
  }

  return { files, format: 'code-block' };
}

/**
 * Helper function to check if response contains any recognizable change format
 */
export function hasCodeChanges(responseText: string): boolean {
  // Check for git diff markers
  if (responseText.includes('diff --git') || responseText.includes('@@')) {
    return true;
  }

  // Check for unified diff markers
  if (responseText.includes('---') && responseText.includes('+++')) {
    return true;
  }

  // Check for code blocks
  if (responseText.includes('```')) {
    return true;
  }

  return false;
}

/**
 * Extract just the code blocks without trying to parse as changes
 * Useful for getting code snippets that aren't meant to be applied
 */
export function extractCodeSnippets(text: string): Array<{
  language?: string;
  content: string;
}> {
  const snippets: Array<{ language?: string; content: string }> = [];
  const codeBlockPattern = /```(\w+)?\s*\n([\s\S]*?)```/g;

  for (const match of text.matchAll(codeBlockPattern)) {
    snippets.push({
      language: match[1],
      content: match[2].trim(),
    });
  }

  return snippets;
}
