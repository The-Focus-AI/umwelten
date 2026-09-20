/**
 * A deliberately small Markdown projection for streamed chat text. Substrate is
 * served as unbundled browser ESM and has no dependencies. Only the constructs
 * below become DOM elements; HTML, images and unsupported syntax stay text.
 * Never pass model output to innerHTML, including code and link labels.
 */

function inline(parent: HTMLElement, source: string, links = true): void {
  const tokens =
    /\\([\\`*_{}[\]()#+.!>-])|(`+)([\s\S]*?[^`])\2(?!`)|(?<!!)\[([^\]\n]+)\]\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)|(\*\*|__)(?=\S)([^\n]*?\S)\6|(\*|_)(?=\S)([^\n]*?\S)\8/g;
  let end = 0;
  for (const match of source.matchAll(tokens)) {
    parent.append(source.slice(end, match.index));
    end = match.index + match[0].length;
    if (match[1]) {
      parent.append(match[1]);
    } else if (match[2]) {
      const code = document.createElement("code");
      code.textContent = match[3].replace(/\n/g, " ");
      code.style.background = "var(--bg)";
      code.style.padding = "0.1em 0.25em";
      parent.append(code);
    } else if (match[4]) {
      // Absolute web/mail links only. No relative, protocol-relative, data:, or
      // javascript: destinations, even if the browser would normalize them.
      const href = match[5];
      let safe = false;
      if (
        links &&
        /^(https?:\/\/|mailto:)/i.test(href) &&
        !Array.from(href).some(
          (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
        )
      ) {
        try {
          safe = ["https:", "http:", "mailto:"].includes(
            new URL(href).protocol,
          );
        } catch {
          /* An unfinished streamed destination remains text. */
        }
      }
      if (safe) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.style.color = "var(--accent)";
        inline(anchor, match[4], false);
        parent.append(anchor);
      } else {
        parent.append(match[0]);
      }
    } else {
      const emphasis = document.createElement(match[6] ? "strong" : "em");
      inline(emphasis, match[7] ?? match[9], links);
      parent.append(emphasis);
    }
  }
  parent.append(source.slice(end));
}

const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const item = /^( *)([-+*]|\d+[.)])\s+(.*)$/;

/** Reparse the full accumulated text; incomplete delimiters stay readable. */
export function renderMarkdown(source: string): HTMLElement {
  const root = document.createElement("div");
  root.style.overflowWrap = "anywhere";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const opening = line.match(fence);
    const title = line.match(heading);
    const firstItem = line.match(item);
    let block: HTMLElement;
    if (opening) {
      block = document.createElement("pre");
      const code = document.createElement("code");
      const content: string[] = [];
      const closing = new RegExp(
        `^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`,
      );
      index++;
      while (index < lines.length && !closing.test(lines[index]))
        content.push(lines[index++]);
      if (index < lines.length) index++;
      code.textContent = content.join("\n");
      block.append(code);
      Object.assign(block.style, {
        whiteSpace: "pre-wrap",
        overflowX: "auto",
        maxWidth: "100%",
        background: "var(--bg)",
        padding: "0.5rem",
        borderRadius: "4px",
      });
    } else if (title) {
      block = document.createElement(`h${title[1].length}`);
      block.style.fontSize = title[1].length <= 2 ? "1.15em" : "1em";
      inline(block, title[2]);
      index++;
    } else if (firstItem) {
      const ordered = /^\d/.test(firstItem[2]);
      block = document.createElement(ordered ? "ol" : "ul");
      block.style.paddingLeft = "1.5em";
      if (ordered)
        block.setAttribute("start", String(parseInt(firstItem[2], 10)));
      const indent = firstItem[1].length;
      while (index < lines.length) {
        const entry = lines[index].match(item);
        if (
          !entry ||
          entry[1].length !== indent ||
          /^\d/.test(entry[2]) !== ordered
        )
          break;
        const content = [entry[3]];
        const continuationIndent = entry[1].length + entry[2].length + 1;
        index++;
        while (
          index < lines.length &&
          lines[index].startsWith(" ".repeat(continuationIndent))
        ) {
          content.push(lines[index++].slice(continuationIndent));
        }
        const li = document.createElement("li");
        li.append(...renderMarkdown(content.join("\n")).childNodes);
        block.append(li);
      }
    } else {
      block = document.createElement("p");
      block.style.whiteSpace = "pre-wrap";
      const content = [line];
      index++;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !fence.test(lines[index]) &&
        !heading.test(lines[index]) &&
        !item.test(lines[index])
      ) {
        content.push(lines[index++]);
      }
      inline(block, content.join("\n"));
    }
    block.style.margin = root.childElementCount ? "0.5rem 0 0" : "0";
    root.append(block);
  }
  return root;
}
