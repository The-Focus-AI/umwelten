/**
 * Parses `examples/labs/0*.md` at site build time into structured `LabMeta`
 * records and crisp Warm Paper HTML so every lab walkthrough, Mermaid diagram,
 * wireframe, shell command, and copy-paste coding-agent prompt stays in sync
 * with the repository source markdown.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type LabTrack =
  | "runtime"
  | "proxy-governance"
  | "protocols-ui"
  | "mesh-production";

export interface LabAnchor {
  label: string;
  href: string;
}

export interface LabMeta {
  num: string;
  slug: string;
  file: string;
  title: string;
  shortTitle: string;
  track: LabTrack;
  trackLabel: string;
  badge: string;
  visualSurface: string;
  goal: string;
  modes: string;
  anchors: LabAnchor[];
  promptText: string;
  rawMarkdown: string;
  bodyHtml: string;
}

interface LabClassification {
  track: LabTrack;
  trackLabel: string;
  badge: string;
  visualSurface: string;
  shortTitle: string;
}

const LAB_CLASSIFICATIONS: Record<string, LabClassification> = {
  "01": {
    track: "runtime",
    trackLabel: "Durable Runtime",
    badge: "pi-durable · SQLite",
    visualSurface: "Interactive CLI / TUI Inspector",
    shortTitle: "Pi Durable Lifecycle Torture Box",
  },
  "02": {
    track: "proxy-governance",
    trackLabel: "Proxy & Governance",
    badge: "Mycel · Authless + Traces",
    visualSurface: "Live SSE Trace Waterfall UI",
    shortTitle: "Authless Mycel + Live LLM Traces",
  },
  "03": {
    track: "proxy-governance",
    trackLabel: "Proxy & Governance",
    badge: "Vault · HTTP/MCP Proxy",
    visualSurface: "Audit & Redaction Stream Console",
    shortTitle: "Centralized Bearer-Token Vault & Proxy",
  },
  "04": {
    track: "protocols-ui",
    trackLabel: "Protocols & UI",
    badge: "ui:// · Adaptive Canvas",
    visualSurface: "Warm Paper Browser Canvas",
    shortTitle: "Adaptive Dev Result UI & ui:// Canvas",
  },
  "05": {
    track: "protocols-ui",
    trackLabel: "Protocols & UI",
    badge: "MCP OAuth 2.1 · ui://",
    visualSurface: "Split Model vs. Human Inspector",
    shortTitle: "MCP OAuth 2.1 + ui:// Round-Trip Lab",
  },
  "06": {
    track: "protocols-ui",
    trackLabel: "Protocols & UI",
    badge: "MCP · 60+ Tools Scaling",
    visualSurface: "Token & Pass@1 Scorecard",
    shortTitle: "Many-Tool MCP Scaling Benchmark",
  },
  "07": {
    track: "mesh-production",
    trackLabel: "Mesh & Production",
    badge: "A2A 1.0 · Coordinator",
    visualSurface: "Concurrent A2A Task Strip",
    shortTitle: "Multi-A2A Peer Mesh & Pi Coordinator",
  },
  "08": {
    track: "protocols-ui",
    trackLabel: "Protocols & UI",
    badge: "Discovery · MCP ↔ A2A",
    visualSurface: "URL Probe & Protocol Card UI",
    shortTitle: "Universal URL Probe & Protocol Bridge",
  },
  "09": {
    track: "mesh-production",
    trackLabel: "Mesh & Production",
    badge: "Factory · Eject & Verify",
    visualSurface: "Builder + Verification Gate UI",
    shortTitle: "Dynamic Agent Builder → Spec Verify → Prod",
  },
};

const GITHUB_BLOB_BASE = "https://github.com/The-Focus-AI/umwelten/blob/main";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveLabHref(rawHref: string): { href: string; external: boolean } {
  const trimmed = rawHref.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { href: trimmed, external: true };
  }
  if (/^\.\/0\d-[^)]+\.md$/i.test(trimmed)) {
    return { href: trimmed.replace(/\.md$/i, ".html"), external: false };
  }
  if (trimmed.includes("node_modules/@leocavalcante/pi-a2a")) {
    return { href: "https://www.npmjs.com/package/@leocavalcante/pi-a2a", external: true };
  }
  const normalized = path.posix.normalize(path.posix.join("examples/labs", trimmed));
  const cleanPath = normalized.replace(/^\/+/, "");
  return { href: `${GITHUB_BLOB_BASE}/${cleanPath}`, external: true };
}

function renderInline(text: string): string {
  // Tokenize code spans first so **, *, and [] inside `...` are never touched.
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return `<code>${escHtml(part.slice(1, -1))}</code>`;
      }
      let out = escHtml(part);
      out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, rawHref: string) => {
        const cleanHref = rawHref.replace(/&amp;/g, "&");
        const resolved = resolveLabHref(cleanHref);
        const attrs = resolved.external ? ' target="_blank" rel="noopener"' : "";
        return `<a href="${escHtml(resolved.href)}"${attrs}>${label}</a>`;
      });
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
      return out;
    })
    .join("");
}

function parseAnchors(line: string): LabAnchor[] {
  const anchors: LabAnchor[] = [];
  const regex = /\[`?([^`\]]+)`?\]\(([^)]+)\)/g;
  let match = regex.exec(line);
  while (match !== null) {
    const resolved = resolveLabHref(match[2]);
    anchors.push({ label: match[1], href: resolved.href });
    match = regex.exec(line);
  }
  return anchors;
}

function splitTableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = splitTableCells(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function renderMarkdownBody(
  lines: string[],
  codeSnippets: string[],
): { bodyHtml: string; promptText: string } {
  const chunks: string[] = [];
  let promptText = "";
  let inPromptSection = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      i++;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      const heading = trimmed.slice(3).trim();
      inPromptSection = /^4\./.test(heading) || /coding-agent prompt/i.test(heading);
      const secMatch = /^(\d+\.)\s+(.*)$/.exec(heading);
      if (secMatch) {
        chunks.push(
          `<h2 class="lab-section-heading"><span class="lab-sec-num">${escHtml(secMatch[1])}</span> ${renderInline(secMatch[2])}</h2>`,
        );
      } else {
        chunks.push(`<h2 class="lab-section-heading">${renderInline(heading)}</h2>`);
      }
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      chunks.push(`<h3 class="lab-sub-heading">${renderInline(trimmed.slice(4).trim())}</h3>`);
      i++;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim().toLowerCase();
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        blockLines.push(lines[i]);
        i++;
      }
      i++; // consume closing ```
      const raw = blockLines.join("\n").trimEnd();

      if (lang === "mermaid") {
        chunks.push(
          `<div class="lab-diagram-card">
            <div class="lab-diagram-head">
              <span>Architecture &amp; Flow Diagram</span>
              <span class="lab-kind-tag">Mermaid</span>
            </div>
            <div class="lab-diagram-body">
              <pre class="mermaid">${escHtml(raw)}</pre>
            </div>
          </div>`,
        );
      } else if (lang === "text" && inPromptSection && !promptText) {
        promptText = raw;
        chunks.push(
          `<div class="prompt-sheet lab-prompt-sheet">
            <div class="prompt-sheet-head">
              <span class="prompt-sheet-kicker">Coding-Agent Prompt &middot; Ready to Paste</span>
              <button type="button" class="copy-btn" data-copy-prompt>Copy Prompt</button>
            </div>
            <pre class="lab-prompt-pre">${escHtml(raw)}</pre>
            <div class="prompt-sheet-foot">
              <span>Works in Pi, Claude Code, Codex &amp; Antigravity</span>
              <span>Offline mock first &rarr; <code>--live</code> opt-in</span>
            </div>
          </div>`,
        );
      } else if (lang === "text") {
        chunks.push(
          `<div class="lab-wireframe">
            <div class="lab-wireframe-head">
              <span>Visual Target Wireframe</span>
              <span>ASCII Layout</span>
            </div>
            <pre>${escHtml(raw)}</pre>
          </div>`,
        );
      } else {
        const snippetIndex = codeSnippets.length;
        codeSnippets.push(raw);
        chunks.push(
          `<div class="code-sheet lab-code-sheet">
            <div class="code-sheet-head">
              <span class="code-sheet-path">${escHtml(lang || "shell")}</span>
              <button type="button" class="copy-btn-sm" data-copy-snippet="${snippetIndex}">Copy</button>
            </div>
            <pre><code>${escHtml(raw)}</code></pre>
          </div>`,
        );
      }
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      chunks.push(`<blockquote class="lab-callout">${renderInline(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitTableCells(lines[i]));
        i++;
      }
      chunks.push(
        `<div class="results-table-wrap"><table class="labs-table"><thead><tr>${headers
          .map((h) => `<th>${renderInline(h)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (r) =>
              `<tr>${r.map((cell) => `<td style="white-space:normal">${renderInline(cell)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      const items: Array<{ text: string; checked?: boolean }> = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        const taskMatch = /^-\s+\[([ xX])\]\s+(.*)$/.exec(cur);
        if (taskMatch) {
          items.push({ text: taskMatch[2], checked: taskMatch[1].toLowerCase() === "x" });
          i++;
          continue;
        }
        if (/^-\s+/.test(cur)) {
          items.push({ text: cur.replace(/^-\s+/, "") });
          i++;
          continue;
        }
        if (/^\s{2,}-\s+/.test(lines[i]) && items.length > 0) {
          items[items.length - 1].text += ` &mdash; ${lines[i].trim().replace(/^-\s+/, "")}`;
          i++;
          continue;
        }
        break;
      }
      const isChecklist = items.some((it) => typeof it.checked === "boolean");
      const cls = isChecklist ? "lab-checklist" : "lab-list";
      chunks.push(
        `<ul class="${cls}">${items
          .map((it) =>
            typeof it.checked === "boolean"
              ? `<li><span class="lab-check-box" aria-hidden="true">${it.checked ? "✓" : ""}</span><span>${renderInline(it.text)}</span></li>`
              : `<li>${renderInline(it.text)}</li>`,
          )
          .join("")}</ul>`,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const steps: Array<{ head: string; subs: string[] }> = [];
      while (i < lines.length) {
        const cur = lines[i];
        const curTrimmed = cur.trim();
        const ordMatch = /^\d+\.\s+(.*)$/.exec(curTrimmed);
        if (ordMatch) {
          steps.push({ head: ordMatch[1], subs: [] });
          i++;
          continue;
        }
        if (/^\s{2,}-\s+/.test(cur) && steps.length > 0) {
          steps[steps.length - 1].subs.push(curTrimmed.replace(/^-\s+/, ""));
          i++;
          continue;
        }
        if (!curTrimmed) {
          i++;
          continue;
        }
        break;
      }
      chunks.push(
        `<ol class="lab-steps">${steps
          .map(
            (s) =>
              `<li><div class="lab-step-head">${renderInline(s.head)}</div>${
                s.subs.length > 0
                  ? `<ul class="lab-sublist">${s.subs.map((sub) => `<li>${renderInline(sub)}</li>`).join("")}</ul>`
                  : ""
              }</li>`,
          )
          .join("")}</ol>`,
      );
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (
        !cur ||
        /^---+$/.test(cur) ||
        cur.startsWith("## ") ||
        cur.startsWith("### ") ||
        cur.startsWith("```") ||
        cur.startsWith("> ") ||
        cur.startsWith("|") ||
        /^-\s+/.test(cur) ||
        /^\d+\.\s+/.test(cur)
      ) {
        break;
      }
      paraLines.push(cur);
      i++;
    }
    if (paraLines.length > 0) {
      chunks.push(`<p class="body-text">${renderInline(paraLines.join(" "))}</p>`);
    }
  }

  return { bodyHtml: chunks.join("\n"), promptText };
}

export interface LoadedLab extends LabMeta {
  codeSnippets: string[];
}

export function loadLabs(rootDir: string): LoadedLab[] {
  const labsDir = path.join(rootDir, "examples", "labs");
  if (!fs.existsSync(labsDir)) return [];

  const files = fs
    .readdirSync(labsDir)
    .filter((f) => /^\d{2}-.*\.md$/.test(f))
    .sort();

  return files.map((fileName) => {
    const rawMarkdown = fs.readFileSync(path.join(labsDir, fileName), "utf8");
    const lines = rawMarkdown.split(/\r?\n/);
    const num = fileName.slice(0, 2);
    const slug = fileName.replace(/\.md$/, "");
    const cls = LAB_CLASSIFICATIONS[num] ?? {
      track: "runtime" as const,
      trackLabel: "Lab",
      badge: `Lab ${num}`,
      visualSurface: "Interactive Prototype",
      shortTitle: slug,
    };

    let title = cls.shortTitle;
    let goal = "";
    let modes = "Offline mock (default) + --live";
    let anchors: LabAnchor[] = [];
    let bodyStartIdx = 0;

    for (let idx = 0; idx < lines.length; idx++) {
      const trimmed = lines[idx].trim();
      if (trimmed.startsWith("# ")) {
        title = trimmed.slice(2).replace(/^Lab\s+\d+\s+[—-]\s*/i, "").trim();
      } else if (trimmed.startsWith("- **Goal:**")) {
        goal = trimmed
          .replace(/^-\s+\*\*Goal:\*\*\s*/, "")
          .replace(/\[`?([^`\]]+)`?\]\(([^)]+)\)/g, "$1");
      } else if (trimmed.startsWith("- **Modes:**")) {
        modes = trimmed.replace(/^-\s+\*\*Modes:\*\*\s*/, "");
      } else if (trimmed.startsWith("- **Repo Anchors:**")) {
        anchors = parseAnchors(trimmed);
      } else if (trimmed.startsWith("## ")) {
        bodyStartIdx = idx;
        break;
      }
    }

    const codeSnippets: string[] = [];
    const { bodyHtml, promptText } = renderMarkdownBody(lines.slice(bodyStartIdx), codeSnippets);

    return {
      num,
      slug,
      file: `examples/labs/${fileName}`,
      title,
      shortTitle: cls.shortTitle,
      track: cls.track,
      trackLabel: cls.trackLabel,
      badge: cls.badge,
      visualSurface: cls.visualSurface,
      goal,
      modes,
      anchors,
      promptText,
      rawMarkdown,
      bodyHtml,
      codeSnippets,
    };
  });
}
