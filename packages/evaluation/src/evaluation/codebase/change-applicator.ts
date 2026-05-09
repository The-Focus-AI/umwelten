/**
 * Change applicator - applies extracted changes to an isolated codebase copy
 */

import { mkdir, readFile, writeFile, unlink, rename as renameFile, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ExtractedChanges,
  FileChange,
  ApplicationResult,
  FileApplicationResult,
  DiffHunk,
} from './types.js';

/**
 * Apply extracted changes to a codebase copy
 */
export async function applyChanges(
  codebasePath: string,
  changes: ExtractedChanges,
  workdirBase?: string
): Promise<ApplicationResult> {
  // Create isolated working directory
  const timestamp = Date.now();
  const workdir = workdirBase
    ? join(workdirBase, `codebase-${timestamp}`)
    : join(tmpdir(), `umwelten-codebase-${timestamp}`);

  try {
    // Copy codebase to working directory
    await cp(codebasePath, workdir, { recursive: true });

    // Apply each file change
    const fileResults: FileApplicationResult[] = [];
    let overallSuccess = true;

    for (const fileChange of changes.files) {
      const result = await applyFileChange(workdir, fileChange);
      fileResults.push(result);

      if (!result.success) {
        overallSuccess = false;
      }
    }

    return {
      success: overallSuccess,
      workdir,
      files: fileResults,
    };
  } catch (error) {
    return {
      success: false,
      workdir,
      files: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply a single file change
 */
async function applyFileChange(
  workdir: string,
  change: FileChange
): Promise<FileApplicationResult> {
  const filePath = join(workdir, change.path);

  try {
    switch (change.type) {
      case 'create':
        return await applyCreateChange(filePath, change);

      case 'modify':
        return await applyModifyChange(filePath, change);

      case 'delete':
        return await applyDeleteChange(filePath);

      case 'rename':
        return await applyRenameChange(workdir, change);

      default:
        return {
          path: change.path,
          success: false,
          operation: 'skipped',
          error: `Unknown change type: ${(change as any).type}`,
        };
    }
  } catch (error) {
    return {
      path: change.path,
      success: false,
      operation: 'skipped',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply a create operation (new file)
 */
async function applyCreateChange(
  filePath: string,
  change: FileChange
): Promise<FileApplicationResult> {
  if (!change.content) {
    return {
      path: change.path,
      success: false,
      operation: 'skipped',
      error: 'No content provided for create operation',
    };
  }

  try {
    // Ensure parent directory exists
    const parentDir = dirname(filePath);
    await mkdir(parentDir, { recursive: true });

    // Write the file
    await writeFile(filePath, change.content, 'utf-8');

    return {
      path: change.path,
      success: true,
      operation: 'created',
    };
  } catch (error) {
    return {
      path: change.path,
      success: false,
      operation: 'skipped',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply a modify operation (patch existing file)
 */
async function applyModifyChange(
  filePath: string,
  change: FileChange
): Promise<FileApplicationResult> {
  try {
    // Read existing file
    const originalContent = await readFile(filePath, 'utf-8');

    // If full content is provided, use it
    if (change.content) {
      await writeFile(filePath, change.content, 'utf-8');
      return {
        path: change.path,
        success: true,
        operation: 'modified',
      };
    }

    // Otherwise, apply hunks
    if (!change.hunks || change.hunks.length === 0) {
      return {
        path: change.path,
        success: false,
        operation: 'skipped',
        error: 'No content or hunks provided for modify operation',
      };
    }

    const result = applyHunks(originalContent, change.hunks);

    if (!result.success) {
      return {
        path: change.path,
        success: false,
        operation: 'skipped',
        error: result.error,
        hunksApplied: result.appliedCount,
        hunksFailed: result.failedCount,
      };
    }

    // Write modified content
    await writeFile(filePath, result.content, 'utf-8');

    return {
      path: change.path,
      success: true,
      operation: 'modified',
      hunksApplied: result.appliedCount,
      hunksFailed: result.failedCount,
    };
  } catch (error) {
    return {
      path: change.path,
      success: false,
      operation: 'skipped',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply diff hunks to file content
 */
function applyHunks(
  originalContent: string,
  hunks: DiffHunk[]
): { success: boolean; content: string; appliedCount: number; failedCount: number; error?: string } {
  const lines = originalContent.split('\n');
  let appliedCount = 0;
  let failedCount = 0;

  // Apply hunks in order (they should not overlap)
  for (const hunk of hunks) {
    const result = applyHunk(lines, hunk);

    if (result.success) {
      appliedCount++;
    } else {
      failedCount++;
      return {
        success: false,
        content: '',
        appliedCount,
        failedCount,
        error: result.error,
      };
    }
  }

  return {
    success: true,
    content: lines.join('\n'),
    appliedCount,
    failedCount,
  };
}

/**
 * Apply a single diff hunk
 */
function applyHunk(
  lines: string[],
  hunk: DiffHunk
): { success: boolean; error?: string } {
  // Convert to 0-based indexing
  const startLine = hunk.oldStart - 1;

  // Verify that the context matches
  const expectedLines: string[] = [];
  const newLines: string[] = [];

  for (const line of hunk.lines) {
    if (line.startsWith(' ')) {
      // Context line - should match in both old and new
      expectedLines.push(line.substring(1));
      newLines.push(line.substring(1));
    } else if (line.startsWith('-')) {
      // Line removed from old
      expectedLines.push(line.substring(1));
    } else if (line.startsWith('+')) {
      // Line added to new
      newLines.push(line.substring(1));
    }
  }

  // Verify context matches
  for (let i = 0; i < expectedLines.length; i++) {
    const lineIndex = startLine + i;
    if (lineIndex >= lines.length) {
      return {
        success: false,
        error: `Hunk expects line ${lineIndex + 1} but file has only ${lines.length} lines`,
      };
    }

    if (lines[lineIndex] !== expectedLines[i]) {
      return {
        success: false,
        error: `Line ${lineIndex + 1} mismatch. Expected: "${expectedLines[i]}", Got: "${lines[lineIndex]}"`,
      };
    }
  }

  // Apply the change
  lines.splice(startLine, expectedLines.length, ...newLines);

  return { success: true };
}

/**
 * Apply a delete operation
 */
async function applyDeleteChange(filePath: string): Promise<FileApplicationResult> {
  try {
    await unlink(filePath);

    return {
      path: filePath,
      success: true,
      operation: 'deleted',
    };
  } catch (error) {
    return {
      path: filePath,
      success: false,
      operation: 'skipped',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply a rename operation
 */
async function applyRenameChange(
  workdir: string,
  change: FileChange
): Promise<FileApplicationResult> {
  if (!change.newPath) {
    return {
      path: change.path,
      success: false,
      operation: 'skipped',
      error: 'No new path provided for rename operation',
    };
  }

  try {
    const oldPath = join(workdir, change.path);
    const newPath = join(workdir, change.newPath);

    // Ensure parent directory exists for new path
    const parentDir = dirname(newPath);
    await mkdir(parentDir, { recursive: true });

    // Rename the file
    await renameFile(oldPath, newPath);

    // If there are content changes, apply them
    if (change.hunks && change.hunks.length > 0) {
      const content = await readFile(newPath, 'utf-8');
      const result = applyHunks(content, change.hunks);

      if (result.success) {
        await writeFile(newPath, result.content, 'utf-8');
      } else {
        return {
          path: change.path,
          success: false,
          operation: 'renamed',
          error: `Renamed but failed to apply changes: ${result.error}`,
          hunksApplied: result.appliedCount,
          hunksFailed: result.failedCount,
        };
      }
    }

    return {
      path: change.path,
      success: true,
      operation: 'renamed',
    };
  } catch (error) {
    return {
      path: change.path,
      success: false,
      operation: 'skipped',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Clean up a working directory
 */
export async function cleanupWorkdir(workdir: string): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(workdir, { recursive: true, force: true });
}
