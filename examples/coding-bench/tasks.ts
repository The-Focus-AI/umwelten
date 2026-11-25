import fs from "node:fs";
import path from "node:path";
import type { CodingTaskSpec } from "@umwelten/evaluation";

const DEFAULT_FIXTURES_DIR = path.resolve(
  process.cwd(),
  "benchmarks",
  "coding-fixtures",
);

interface RawTaskJson {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  language: "typescript" | "python";
  prompt: string;
  visibleTestCommand: string;
  hiddenTestCommand: string;
  protectedPaths?: string[];
  maxTurns?: number;
  timeoutMs?: number;
  tags?: string[];
}

export function loadCodingFixtures(
  fixturesRoot: string = DEFAULT_FIXTURES_DIR,
): CodingTaskSpec[] {
  if (!fs.existsSync(fixturesRoot)) {
    throw new Error(`Coding fixtures directory not found: ${fixturesRoot}`);
  }
  const entries = fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const tasks: CodingTaskSpec[] = [];
  for (const dirName of entries) {
    const taskDir = path.join(fixturesRoot, dirName);
    const jsonPath = path.join(taskDir, "task.json");
    if (!fs.existsSync(jsonPath)) continue;
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as RawTaskJson;
    tasks.push({
      id: raw.id,
      title: raw.title,
      difficulty: raw.difficulty,
      language: raw.language,
      repoDir: path.join(taskDir, "repo"),
      hiddenTestsDir: path.join(taskDir, "hidden"),
      prompt: raw.prompt,
      visibleTestCommand: raw.visibleTestCommand,
      hiddenTestCommand: raw.hiddenTestCommand,
      protectedPaths: raw.protectedPaths ?? [],
      maxTurns: raw.maxTurns,
      timeoutMs: raw.timeoutMs,
      tags: raw.tags,
    });
  }

  return tasks;
}
