import fs from "node:fs/promises";
import path from "node:path";
import type {
  Report,
  ReporterOptions,
  ConsoleRenderOptions,
  MarkdownRenderOptions,
} from "./types.js";
import { ConsoleRenderer } from "./renderers/console-renderer.js";
import { MarkdownRenderer } from "./renderers/markdown-renderer.js";

const DEFAULT_OPTIONS: Required<ReporterOptions> = {
  colors: true,
  verbose: false,
  outputDir: "./output",
};

export class Reporter {
  private readonly options: Required<ReporterOptions>;
  private readonly consoleRenderer: ConsoleRenderer;
  private readonly markdownRenderer: MarkdownRenderer;

  constructor(options: ReporterOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.consoleRenderer = new ConsoleRenderer({ colors: this.options.colors });
    this.markdownRenderer = new MarkdownRenderer({ frontmatter: true });
  }

  toConsole(report: Report, options?: ConsoleRenderOptions): void {
    const renderer = options
      ? new ConsoleRenderer(options)
      : this.consoleRenderer;
    renderer.render(report);
  }

  toMarkdown(report: Report, options?: MarkdownRenderOptions): string {
    const renderer = options
      ? new MarkdownRenderer(options)
      : this.markdownRenderer;
    return renderer.render(report);
  }

  toJson(report: Report, pretty = true): string {
    return JSON.stringify(report, null, pretty ? 2 : 0);
  }

  async toFile(
    report: Report,
    filename?: string,
    format: "md" | "json" = "md",
  ): Promise<string> {
    const resolvedName =
      filename ??
      `${report.timestamp.toISOString().split("T")[0]}-${report.type}-report.${format}`;
    await fs.mkdir(this.options.outputDir, { recursive: true });
    const filepath = path.join(this.options.outputDir, resolvedName);
    const content =
      format === "md" ? this.toMarkdown(report) : this.toJson(report);
    await fs.writeFile(filepath, content, "utf8");
    return filepath;
  }
}
