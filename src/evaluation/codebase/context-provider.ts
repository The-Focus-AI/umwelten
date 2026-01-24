/**
 * Codebase context provider - loads codebase files and creates context for model prompts
 */

import { readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { glob } from 'glob';
import type { CodebaseConfig, CodebaseContext } from './types.js';
import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * Default patterns for common source files
 */
const DEFAULT_INCLUDE_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.py',
  '**/*.rs',
  '**/*.go',
  '**/*.java',
  '**/*.c',
  '**/*.cpp',
  '**/*.h',
  '**/*.hpp',
  '**/*.cs',
  '**/*.rb',
  '**/*.php',
  '**/*.swift',
  '**/*.kt',
  '**/*.scala',
  '**/*.md',
  '**/*.json',
  '**/*.yaml',
  '**/*.yml',
  '**/*.toml',
  '**/*.xml',
];

/**
 * Default patterns for files/directories to exclude
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/venv/**',
  '**/.venv/**',
  '**/env/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/.pytest_cache/**',
  '**/coverage/**',
  '**/.coverage',
  '**/.nyc_output/**',
  '**/tmp/**',
  '**/temp/**',
  '**/.DS_Store',
  '**/*.log',
  '**/*.min.js',
  '**/*.min.css',
  '**/vendor/**',
  '**/Cargo.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
];

/**
 * Default maximum context size (10MB)
 */
const DEFAULT_MAX_CONTEXT_SIZE = 10 * 1024 * 1024;

/**
 * Project type detection patterns
 */
const PROJECT_TYPE_MARKERS = {
  npm: ['package.json', 'pnpm-lock.yaml', 'yarn.lock'],
  pip: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'],
  cargo: ['Cargo.toml'],
  go: ['go.mod', 'go.sum'],
  maven: ['pom.xml'],
  gradle: ['build.gradle', 'build.gradle.kts', 'settings.gradle'],
};

/**
 * Language detection from file extensions
 */
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.md': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
};

/**
 * Detect project type from codebase contents
 */
export async function detectProjectType(codebasePath: string): Promise<string> {
  for (const [projectType, markers] of Object.entries(PROJECT_TYPE_MARKERS)) {
    for (const marker of markers) {
      try {
        const markerPath = join(codebasePath, marker);
        await stat(markerPath);
        return projectType;
      } catch {
        // File doesn't exist, try next marker
        continue;
      }
    }
  }

  return 'unknown';
}

/**
 * Get language identifier from file extension
 */
function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return LANGUAGE_MAP[ext];
}

/**
 * Generate a file tree representation
 */
function generateFileTree(files: string[], basePath: string): string {
  // Build tree structure
  const tree: Map<string, any> = new Map();

  for (const file of files) {
    const parts = file.split(sep);
    let current = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.has(part)) {
        current.set(part, i === parts.length - 1 ? null : new Map());
      }
      if (i < parts.length - 1) {
        current = current.get(part);
      }
    }
  }

  // Format tree as string
  const lines: string[] = [];

  function formatNode(node: Map<string, any>, prefix: string = '', isLast: boolean = true): void {
    const entries = Array.from(node.entries());

    for (let i = 0; i < entries.length; i++) {
      const [name, children] = entries[i];
      const isLastEntry = i === entries.length - 1;
      const connector = isLastEntry ? '└── ' : '├── ';
      const extension = isLastEntry ? '    ' : '│   ';

      lines.push(prefix + connector + name);

      if (children instanceof Map) {
        formatNode(children, prefix + extension, isLastEntry);
      }
    }
  }

  lines.push(basePath + sep);
  formatNode(tree);

  return lines.join('\n');
}

/**
 * Load codebase context from a directory
 */
export async function loadCodebaseContext(
  config: CodebaseConfig
): Promise<CodebaseContext> {
  const {
    path: codebasePath,
    include = DEFAULT_INCLUDE_PATTERNS,
    exclude = DEFAULT_EXCLUDE_PATTERNS,
    maxContextSize = DEFAULT_MAX_CONTEXT_SIZE,
    includeFileTree = true,
  } = config;

  // Detect project type if not specified
  const projectType = config.projectType || (await detectProjectType(codebasePath));

  // Find matching files
  const matchedFiles = await glob(include, {
    cwd: codebasePath,
    ignore: exclude,
    nodir: true,
    dot: false,
  });

  // Load file contents with size tracking
  const files: CodebaseContext['files'] = [];
  const truncatedFiles: string[] = [];
  let totalSize = 0;

  for (const file of matchedFiles.sort()) {
    const fullPath = join(codebasePath, file);

    try {
      const fileStats = await stat(fullPath);

      // Skip if adding this file would exceed max context size
      if (totalSize + fileStats.size > maxContextSize) {
        truncatedFiles.push(file);
        continue;
      }

      const content = await readFile(fullPath, 'utf-8');
      const language = getLanguageFromPath(file);

      files.push({
        path: file,
        content,
        language,
      });

      totalSize += content.length;
    } catch (error) {
      // Skip files that can't be read (e.g., binary files, permission issues)
      console.warn(`Warning: Could not read file ${file}:`, error);
      continue;
    }
  }

  // Generate file tree if requested
  let fileTree: string | undefined;
  if (includeFileTree) {
    const allFiles = [...files.map(f => f.path), ...truncatedFiles];
    fileTree = generateFileTree(allFiles, codebasePath);
  }

  return {
    config,
    projectType,
    fileTree,
    files,
    totalSize,
    truncatedFiles: truncatedFiles.length > 0 ? truncatedFiles : undefined,
  };
}

/**
 * Format codebase context as a prompt for the model
 */
export function formatCodebaseContextPrompt(context: CodebaseContext): string {
  const lines: string[] = [];

  // Project overview
  lines.push('# Codebase Context');
  lines.push('');
  lines.push(`Project Type: ${context.projectType}`);
  lines.push(`Total Files: ${context.files.length}`);
  lines.push(`Context Size: ${(context.totalSize / 1024).toFixed(2)} KB`);
  lines.push('');

  // File tree
  if (context.fileTree) {
    lines.push('## File Structure');
    lines.push('');
    lines.push('```');
    lines.push(context.fileTree);
    lines.push('```');
    lines.push('');
  }

  // Truncation warning
  if (context.truncatedFiles && context.truncatedFiles.length > 0) {
    lines.push(`**Note:** ${context.truncatedFiles.length} files were excluded due to size limits.`);
    lines.push('');
  }

  // File contents
  lines.push('## Source Files');
  lines.push('');

  for (const file of context.files) {
    lines.push(`### ${file.path}`);
    lines.push('');

    if (file.language) {
      lines.push('```' + file.language);
      lines.push(file.content);
      lines.push('```');
    } else {
      lines.push('```');
      lines.push(file.content);
      lines.push('```');
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Create a Stimulus from codebase context
 */
export function createCodebaseStimulus(
  context: CodebaseContext,
  taskPrompt: string,
  taskId?: string
): Stimulus {
  const contextPrompt = formatCodebaseContextPrompt(context);
  const fullPrompt = `${contextPrompt}\n\n---\n\n# Task\n\n${taskPrompt}`;

  return new Stimulus({
    id: taskId || `codebase-${Date.now()}`,
    name: `Codebase Task: ${taskPrompt.substring(0, 50)}...`,
    description: taskPrompt,
    role: 'coding assistant',
    objective: 'Modify the codebase according to the task requirements',
    instructions: [fullPrompt],
    systemContext: JSON.stringify({
      codebasePath: context.config.path,
      projectType: context.projectType,
      fileCount: context.files.length,
      contextSize: context.totalSize,
      truncatedFileCount: context.truncatedFiles?.length || 0,
    }),
  });
}

/**
 * Load relevant files only (useful for focused tasks)
 */
export async function loadRelevantFiles(
  codebasePath: string,
  filePaths: string[]
): Promise<CodebaseContext['files']> {
  const files: CodebaseContext['files'] = [];

  for (const filePath of filePaths) {
    const fullPath = join(codebasePath, filePath);

    try {
      const content = await readFile(fullPath, 'utf-8');
      const language = getLanguageFromPath(filePath);

      files.push({
        path: filePath,
        content,
        language,
      });
    } catch (error) {
      console.warn(`Warning: Could not read file ${filePath}:`, error);
      continue;
    }
  }

  return files;
}
