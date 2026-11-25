/**
 * Isolated git checkout creation, tamper-proof restoration of protected files,
 * held-out hidden-test overlay, and deterministic pass/fail + partial-credit grading.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CodingLanguage,
  CodingTaskSpec,
  CodingTestCounts,
} from "./types.js";

const execFileAsync = promisify(execFile);

const SKIP_COPY_NAMES = new Set([".git", "node_modules", "__pycache__"]);
const SKIP_SNAPSHOT_NAMES = new Set(["node_modules", "__pycache__"]);

async function collectSortedFiles(dir: string, root: string = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (SKIP_COPY_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSortedFiles(full, root)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

async function copyDirFiltered(
  srcDir: string,
  destDir: string,
  skipNames: ReadonlySet<string> = SKIP_COPY_NAMES,
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirFiltered(srcPath, destPath, skipNames);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Deterministic SHA-256 hash across prompt, test commands, protected paths,
 * baseline repo files, and held-out hidden tests so caches invalidate on any edit.
 */
export async function computeTaskHash(task: CodingTaskSpec): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(
    JSON.stringify({
      id: task.id,
      language: task.language,
      prompt: task.prompt,
      visibleTestCommand: task.visibleTestCommand,
      hiddenTestCommand: task.hiddenTestCommand,
      protectedPaths: task.protectedPaths,
    }),
  );

  for (const [label, dir] of [
    ["repo", task.repoDir],
    ["hidden", task.hiddenTestsDir],
  ] as const) {
    const files = await collectSortedFiles(dir);
    for (const rel of files) {
      hash.update(`\0${label}:${rel}\0`);
      hash.update(await fs.readFile(path.join(dir, rel)));
    }
  }

  return hash.digest("hex").slice(0, 16);
}

export interface PreparedCheckout {
  dir: string;
  baselineCommit: string;
  cleanup: () => Promise<void>;
}

/**
 * Materialize an isolated temporary git repository initialized at a clean
 * baseline commit so agents never share state or mutate fixture sources.
 */
export async function prepareIsolatedGitCheckout(
  repoDir: string,
): Promise<PreparedCheckout> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "umwelten-codebench-"));
  await copyDirFiltered(repoDir, dir);

  const runGit = async (args: string[]) =>
    execFileAsync("git", args, { cwd: dir, encoding: "utf8" });

  await runGit(["init", "-q"]);
  await runGit(["config", "user.name", "Umwelten Bench"]);
  await runGit(["config", "user.email", "bench@thefocus.ai"]);
  await runGit(["add", "-A"]);
  await runGit(["commit", "-q", "-m", "baseline"]);
  const { stdout } = await runGit(["rev-parse", "HEAD"]);

  return {
    dir,
    baselineCommit: stdout.trim(),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Parse test pass/fail/total counts from `node --test` (TS) or
 * `python3 -m unittest` (Python) output.
 */
export function parseTestCounts(
  language: CodingLanguage,
  stdout: string,
  stderr: string,
  exitCode: number,
): CodingTestCounts {
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();

  if (language === "typescript") {
    const totalMatch = combined.match(/ℹ\s+tests\s+(\d+)/);
    const passMatch = combined.match(/ℹ\s+pass\s+(\d+)/);
    const failMatch = combined.match(/ℹ\s+fail\s+(\d+)/);

    if (totalMatch && passMatch && failMatch) {
      const total = Number(totalMatch[1]);
      const passed = Number(passMatch[1]);
      const failed = Number(failMatch[1]);
      return { passed, failed, total, exitCode, output: combined };
    }

    // Fallback to TAP lines (`ok N - ...` / `not ok N - ...`)
    const okLines = combined.match(/^ok \d+/gm)?.length ?? 0;
    const notOkLines = combined.match(/^not ok \d+/gm)?.length ?? 0;
    if (okLines + notOkLines > 0) {
      return {
        passed: okLines,
        failed: notOkLines,
        total: okLines + notOkLines,
        exitCode,
        output: combined,
      };
    }

    return {
      passed: exitCode === 0 ? 1 : 0,
      failed: exitCode === 0 ? 0 : 1,
      total: 1,
      exitCode,
      output: combined,
    };
  }

  // Python unittest writes runner counts to stderr
  const ranMatch = combined.match(/Ran (\d+) tests? in /);
  const total = ranMatch ? Number(ranMatch[1]) : 0;

  if (total === 0) {
    return {
      passed: 0,
      failed: 1,
      total: 1,
      exitCode: exitCode === 0 ? 1 : exitCode,
      output: combined,
    };
  }

  const failuresMatch = combined.match(/failures=(\d+)/);
  const errorsMatch = combined.match(/errors=(\d+)/);
  let failed =
    (failuresMatch ? Number(failuresMatch[1]) : 0) +
    (errorsMatch ? Number(errorsMatch[1]) : 0);

  if (failed === 0 && exitCode !== 0) {
    failed = 1;
  }
  failed = Math.min(failed, total);
  const passed = Math.max(0, total - failed);

  return { passed, failed, total, exitCode, output: combined };
}

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number = 30_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("sh", ["-c", command], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    const exitCode = typeof e.code === "number" ? e.code : 1;
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr || e.message || "",
      exitCode,
    };
  }
}

export interface GradeCheckoutResult {
  passed: boolean;
  score: number;
  maxScore: number;
  details: string;
  visibleTests: CodingTestCounts;
  hiddenTests: CodingTestCounts;
  cheatedProtectedFiles: boolean;
  changedFiles: string[];
  gitDiffStat: string;
  gitDiff: string;
  gradingOutput: string;
}

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^"|"$/g, "");
}

function parsePorcelainStatus(porcelain: string): Array<{ status: string; file: string }> {
  return porcelain
    .split(/\r?\n/)
    .filter((l) => l.length >= 4)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawFile = line.slice(3).trim();
      const arrowIdx = rawFile.indexOf(" -> ");
      const file =
        arrowIdx >= 0 ? rawFile.slice(arrowIdx + 4).trim() : rawFile;
      return { status, file: normalizeRelPath(file) };
    });
}

function matchesProtectedPath(changedFile: string, protectedPath: string): boolean {
  const normChanged = normalizeRelPath(changedFile);
  const normProt = normalizeRelPath(protectedPath).replace(/\/$/, "");
  return (
    normChanged === normProt || normChanged.startsWith(`${normProt}/`)
  );
}

/**
 * Inspect git changes against `HEAD`, restore any tampered `protectedPaths`,
 * overlay `task.hiddenTestsDir`, execute both visible and held-out suites, and
 * compute a deterministic score out of `10`.
 */
export async function gradeIsolatedCheckout(
  workspaceDir: string,
  task: CodingTaskSpec,
): Promise<GradeCheckoutResult> {
  const runGit = async (args: string[]) =>
    execFileAsync("git", args, {
      cwd: workspaceDir,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });

  const { stdout: porcelain } = await runGit(["status", "--porcelain"]);
  const statusEntries = parsePorcelainStatus(porcelain);
  const changedFiles = statusEntries.map((s) => s.file);

  const { stdout: diffStatRaw } = await runGit(["diff", "--stat"]);
  const { stdout: diffRaw } = await runGit(["diff"]);

  let cheatedProtectedFiles = false;
  const tamperedFiles: string[] = [];

  for (const entry of statusEntries) {
    if (
      task.protectedPaths.some((prot) =>
        matchesProtectedPath(entry.file, prot),
      )
    ) {
      cheatedProtectedFiles = true;
      tamperedFiles.push(entry.file);
      if (entry.status === "??") {
        await fs.rm(path.join(workspaceDir, entry.file), {
          recursive: true,
          force: true,
        });
      } else {
        await runGit(["checkout", "HEAD", "--", entry.file]);
      }
    }
  }

  // Copy held-out tests strictly AFTER agent execution finishes
  await copyDirFiltered(task.hiddenTestsDir, workspaceDir);

  const visRun = await runShellCommand(task.visibleTestCommand, workspaceDir);
  const visibleTests = parseTestCounts(
    task.language,
    visRun.stdout,
    visRun.stderr,
    visRun.exitCode,
  );

  const hidRun = await runShellCommand(task.hiddenTestCommand, workspaceDir);
  const hiddenTests = parseTestCounts(
    task.language,
    hidRun.stdout,
    hidRun.stderr,
    hidRun.exitCode,
  );

  let passed = false;
  let score = 0;
  let details: string;

  if (cheatedProtectedFiles) {
    details = `Protected file(s) modified (${tamperedFiles.join(", ")}); restored before grading — score forced to 0.`;
  } else if (
    visibleTests.exitCode === 0 &&
    hiddenTests.exitCode === 0 &&
    hiddenTests.total > 0 &&
    hiddenTests.failed === 0
  ) {
    passed = true;
    score = 10;
    details = `PASS: visible ${visibleTests.passed}/${visibleTests.total}, hidden ${hiddenTests.passed}/${hiddenTests.total}`;
  } else if (
    visibleTests.exitCode === 0 &&
    hiddenTests.total > 0 &&
    hiddenTests.passed > 0
  ) {
    passed = false;
    score = Math.min(6, Math.round((hiddenTests.passed / hiddenTests.total) * 6));
    details = `PARTIAL: visible ${visibleTests.passed}/${visibleTests.total}, hidden ${hiddenTests.passed}/${hiddenTests.total}`;
  } else {
    passed = false;
    score = 0;
    details = `FAIL: visible ${visibleTests.passed}/${visibleTests.total} (exit ${visibleTests.exitCode}), hidden ${hiddenTests.passed}/${hiddenTests.total} (exit ${hiddenTests.exitCode})`;
  }

  const combinedGradingOutput = [
    `=== VISIBLE (${task.visibleTestCommand}) [exit ${visibleTests.exitCode}] ===`,
    visibleTests.output,
    `=== HIDDEN (${task.hiddenTestCommand}) [exit ${hiddenTests.exitCode}] ===`,
    hiddenTests.output,
  ]
    .join("\n")
    .slice(0, 16 * 1024);

  return {
    passed,
    score,
    maxScore: 10,
    details,
    visibleTests,
    hiddenTests,
    cheatedProtectedFiles,
    changedFiles,
    gitDiffStat: diffStatRaw.trim(),
    gitDiff: diffRaw.slice(0, 32 * 1024),
    gradingOutput: combinedGradingOutput,
  };
}

/**
 * Inspect live modified/untracked files and unified diff inside a checkout
 * without mutating anything or overlaying held-out tests.
 */
export async function getWorkspaceDiff(workspaceDir: string): Promise<{
  changedFiles: string[];
  gitDiffStat: string;
  gitDiff: string;
}> {
  const runGit = async (args: string[]) =>
    execFileAsync("git", args, {
      cwd: workspaceDir,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });

  const { stdout: porcelain } = await runGit(["status", "--porcelain"]);
  const changedFiles = parsePorcelainStatus(porcelain).map((s) => s.file);
  const { stdout: diffStatRaw } = await runGit(["diff", "--stat"]);
  const { stdout: diffRaw } = await runGit(["diff"]);

  return {
    changedFiles,
    gitDiffStat: diffStatRaw.trim(),
    gitDiff: diffRaw.slice(0, 32 * 1024),
  };
}

/**
 * Copy the live checkout (including `.git`) into a temporary snapshot dir,
 * grade the snapshot against held-out tests, and clean up the snapshot so
 * held-out tests never leak into the interactive checkout.
 */
export async function gradeWorkspaceSnapshot(
  workspaceDir: string,
  task: CodingTaskSpec,
): Promise<GradeCheckoutResult> {
  const snapshotDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "umwelten-grade-snap-"),
  );
  try {
    await copyDirFiltered(workspaceDir, snapshotDir, SKIP_SNAPSHOT_NAMES);
    return await gradeIsolatedCheckout(snapshotDir, task);
  } finally {
    await fs.rm(snapshotDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
