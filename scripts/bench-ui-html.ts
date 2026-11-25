/**
 * HTML/JS renderer for the local Interactive Coding-Session Workbench
 * (`pnpm run bench:ui`, served at `http://127.0.0.1:7440`).
 *
 * Uses Bell Labs Warm Paper tokens from `/styles/labs.css` (`LABS_CSS`) with
 * zero runtime frontend build step and pure EventSource SSE streaming.
 */

export function renderBenchUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Umwelten · Interactive Coding-Session Workbench</title>
  <link rel="stylesheet" href="/styles/labs.css">
  <style>
    :root {
      --wb-shell-max: 1480px;
    }

    body {
      background: var(--canvas);
      color: var(--ink);
      font-family: var(--sans);
      min-height: 100vh;
    }

    .wb-header {
      background: var(--paper);
      border-bottom: 2px solid var(--ink);
      padding: 16px 24px;
    }

    .wb-header-inner {
      max-width: var(--wb-shell-max);
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .wb-kicker {
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent-warm);
      font-weight: 600;
      margin-bottom: 4px;
    }

    .wb-title {
      font-family: var(--serif);
      font-size: 24px;
      font-weight: 700;
      line-height: 1.15;
      color: var(--ink);
    }

    .wb-subtitle {
      font-size: 13px;
      color: var(--muted);
      margin-top: 3px;
    }

    .wb-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .wb-main {
      max-width: var(--wb-shell-max);
      margin: 0 auto;
      padding: 20px 24px 48px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .wb-panel {
      background: var(--paper);
      border: 1px solid var(--border-strong);
      padding: 16px 18px;
    }

    .wb-panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 10px;
      margin-bottom: 14px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }

    .wb-panel-title {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink);
    }

    .wb-launcher-grid {
      display: grid;
      grid-template-columns: minmax(280px, 1.6fr) minmax(140px, 0.7fr) minmax(240px, 1.2fr) minmax(240px, 1.1fr);
      gap: 16px;
    }

    @media (max-width: 1100px) {
      .wb-launcher-grid {
        grid-template-columns: repeat(2, minmax(240px, 1fr));
      }
    }

    @media (max-width: 700px) {
      .wb-launcher-grid {
        grid-template-columns: 1fr;
      }
    }

    .wb-col {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .wb-col-label {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
    }

    .wb-filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .wb-chip-btn {
      font-family: var(--font-mono);
      font-size: 11px;
      padding: 3px 8px;
      border: 1px solid var(--border-strong);
      background: var(--surface-raised);
      color: var(--text);
      cursor: pointer;
    }

    .wb-chip-btn:hover {
      background: var(--hover-fill);
    }

    .wb-chip-btn.active {
      background: var(--ink);
      color: var(--paper);
      border-color: var(--ink);
    }

    .wb-input {
      width: 100%;
      font-family: var(--font-mono);
      font-size: 12px;
      padding: 6px 9px;
      border: 1px solid var(--border-strong);
      background: var(--paper);
      color: var(--ink);
    }

    .wb-checklist {
      border: 1px solid var(--border);
      background: var(--surface-raised);
      max-height: 230px;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .wb-check-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 5px 6px;
      background: var(--paper);
      border: 1px solid var(--border);
      font-size: 12px;
      cursor: pointer;
    }

    .wb-check-item:hover {
      border-color: var(--signal);
    }

    .wb-check-item input {
      margin-top: 2px;
      cursor: pointer;
    }

    .wb-check-main {
      flex: 1;
      min-width: 0;
    }

    .wb-check-title {
      font-family: var(--font-mono);
      font-size: 11.5px;
      font-weight: 600;
      color: var(--ink);
      word-break: break-word;
    }

    .wb-check-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 3px;
      font-size: 10.5px;
      color: var(--muted);
      align-items: center;
    }

    .wb-pill {
      display: inline-block;
      font-family: var(--font-mono);
      font-size: 10px;
      padding: 1px 5px;
      border: 1px solid var(--border-strong);
      background: var(--surface);
      color: var(--text);
      line-height: 1.4;
      white-space: nowrap;
    }

    .wb-pill.open { background: var(--green-bg); color: var(--green); border-color: var(--green); }
    .wb-pill.closed { background: var(--surface); color: var(--muted); }
    .wb-pill.local { background: var(--local-bg); color: var(--local); border-color: var(--local); }
    .wb-pill.pass { background: var(--green-bg); color: var(--green); border-color: var(--green); }
    .wb-pill.fail { background: var(--red-bg); color: var(--red); border-color: var(--red); }
    .wb-pill.running, .wb-pill.grading, .wb-pill.chatting {
      background: var(--accent-soft);
      color: var(--signal);
      border-color: var(--signal);
    }
    .wb-pill.aborted { background: var(--yellow-bg); color: var(--yellow); border-color: var(--yellow); }

    .wb-btn {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      padding: 7px 14px;
      border: 1px solid var(--ink);
      background: var(--paper);
      color: var(--ink);
      cursor: pointer;
    }

    .wb-btn:hover:not(:disabled) {
      background: var(--surface);
    }

    .wb-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .wb-btn.primary {
      background: var(--signal);
      color: var(--paper);
      border-color: var(--signal);
    }

    .wb-btn.primary:hover:not(:disabled) {
      background: #004182;
    }

    .wb-btn.danger {
      background: var(--red-bg);
      color: var(--red);
      border-color: var(--red);
    }

    .wb-btn.good {
      background: var(--green-bg);
      color: var(--green);
      border-color: var(--green);
    }

    .wb-launch-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }

    .wb-error-banner {
      display: none;
      margin-top: 10px;
      padding: 8px 12px;
      border: 1px solid var(--red);
      background: var(--red-bg);
      color: var(--red);
      font-family: var(--font-mono);
      font-size: 12px;
    }

    .wb-error-banner.visible {
      display: block;
    }

    .wb-session-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
    }

    .wb-session-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border: 1px solid var(--border-strong);
      background: var(--surface-raised);
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 11.5px;
    }

    .wb-session-tab.active {
      background: var(--paper);
      border-color: var(--signal);
      box-shadow: inset 0 -2px 0 var(--signal);
    }

    .wb-console-grid {
      display: grid;
      grid-template-columns: minmax(360px, 1.25fr) minmax(340px, 1fr);
      gap: 16px;
      align-items: start;
    }

    @media (max-width: 1024px) {
      .wb-console-grid {
        grid-template-columns: 1fr;
      }
    }

    .wb-session-toolbar {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 12px;
      background: var(--surface-raised);
      border: 1px solid var(--border);
      margin-bottom: 12px;
    }

    .wb-toolbar-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: wrap;
    }

    .wb-toolbar-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .wb-metrics-row {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--muted);
    }

    .wb-metrics-row strong {
      color: var(--ink);
    }

    .wb-trace-feed {
      border: 1px solid var(--border);
      background: var(--surface-raised);
      height: 540px;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .wb-turn-sep {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      padding-bottom: 3px;
      margin-top: 4px;
    }

    .wb-ev-card {
      background: var(--paper);
      border: 1px solid var(--border);
      padding: 9px 11px;
      font-size: 13px;
      line-height: 1.45;
    }

    .wb-ev-card.graded-pass {
      border-color: var(--green);
      background: var(--green-bg);
    }

    .wb-ev-card.graded-fail {
      border-color: var(--red);
      background: var(--red-bg);
    }

    .wb-ev-card.user-msg {
      border-left: 3px solid var(--signal);
    }

    .wb-think-details {
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--muted);
      margin-bottom: 6px;
      background: var(--surface-raised);
      border: 1px solid var(--border);
      padding: 5px 8px;
    }

    .wb-think-details summary {
      cursor: pointer;
      font-weight: 600;
    }

    .wb-think-pre {
      white-space: pre-wrap;
      margin-top: 6px;
      max-height: 220px;
      overflow-y: auto;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text);
    }

    .wb-tool-card {
      border: 1px solid var(--border);
      background: var(--paper);
      padding: 7px 10px;
      font-family: var(--font-mono);
      font-size: 11.5px;
    }

    .wb-tool-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }

    .wb-tool-args, .wb-tool-out {
      margin-top: 5px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 11px;
      color: var(--muted);
      max-height: 160px;
      overflow-y: auto;
      background: var(--surface-raised);
      padding: 5px 7px;
      border: 1px solid var(--border);
    }

    .wb-partial-box {
      border: 1px dashed var(--signal);
      background: var(--accent-soft);
      padding: 8px 10px;
      font-family: var(--font-mono);
      font-size: 11.5px;
      display: none;
    }

    .wb-partial-box.visible {
      display: block;
    }

    .wb-tabs {
      display: flex;
      border-bottom: 1px solid var(--border-strong);
      margin-bottom: 12px;
      gap: 4px;
    }

    .wb-tab-btn {
      font-family: var(--font-mono);
      font-size: 11.5px;
      font-weight: 600;
      padding: 7px 12px;
      border: 1px solid transparent;
      border-bottom: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }

    .wb-tab-btn.active {
      background: var(--paper);
      color: var(--ink);
      border-color: var(--border-strong);
      border-bottom: 2px solid var(--paper);
      margin-bottom: -1px;
    }

    .wb-tab-pane {
      display: none;
    }

    .wb-tab-pane.active {
      display: block;
    }

    .wb-pre {
      font-family: var(--font-mono);
      font-size: 11.5px;
      line-height: 1.45;
      background: var(--surface-raised);
      border: 1px solid var(--border);
      padding: 10px;
      overflow: auto;
      max-height: 460px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .diff-line-add { background: #e6f4ea; color: #0e6b3f; display: block; }
    .diff-line-del { background: #fce8e6; color: #b3261e; display: block; }
    .diff-line-hunk { color: var(--signal); font-weight: 600; display: block; }
    .diff-line-hdr { color: var(--ink); font-weight: 600; display: block; }
    .diff-line-ctx { color: var(--muted); display: block; }

    .wb-chat-composer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }

    .wb-textarea {
      width: 100%;
      min-height: 82px;
      font-family: var(--sans);
      font-size: 13px;
      padding: 8px 10px;
      border: 1px solid var(--border-strong);
      background: var(--paper);
      color: var(--ink);
      resize: vertical;
    }

    .wb-pareto-wrap {
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(420px, 1.35fr);
      gap: 16px;
      align-items: start;
    }

    @media (max-width: 1100px) {
      .wb-pareto-wrap {
        grid-template-columns: 1fr;
      }
    }

    .wb-empty {
      padding: 28px 16px;
      text-align: center;
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 12px;
      border: 1px dashed var(--border-strong);
      background: var(--surface-raised);
    }

    .wb-table-wrap {
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <header class="wb-header">
    <div class="wb-header-inner">
      <div>
        <div class="wb-kicker">TheFocus.AI · Umwelten</div>
        <h1 class="wb-title">Pi Durable Coding-Session Eval Workbench</h1>
        <p class="wb-subtitle">Isolated git checkouts · live EventSource trace · held-out snapshot grading · interactive follow-up REPL</p>
      </div>
      <div class="wb-header-actions">
        <span id="wb-global-status" class="wb-pill">Ready</span>
        <button type="button" class="wb-btn" id="wb-refresh-catalog">Refresh Catalog</button>
      </div>
    </div>
  </header>

  <main class="wb-main">
    <section class="wb-panel" aria-label="Launcher">
      <div class="wb-panel-head">
        <span class="wb-panel-title">1 · Launch Coding Session Matrix</span>
        <span id="wb-launch-count" class="wb-pill">0 session(s) queued</span>
      </div>

      <div class="wb-launcher-grid">
        <div class="wb-col">
          <div class="wb-col-label">Models</div>
          <div class="wb-filter-row" id="wb-model-filters">
            <button type="button" class="wb-chip-btn active" data-filter="all">All</button>
            <button type="button" class="wb-chip-btn" data-filter="open">Open</button>
            <button type="button" class="wb-chip-btn" data-filter="closed">Closed</button>
            <button type="button" class="wb-chip-btn" data-filter="local">Local</button>
            <button type="button" class="wb-chip-btn" data-filter="laptop">Laptop Fit</button>
          </div>
          <input type="text" id="wb-model-search" class="wb-input" placeholder="Search catalog (e.g. fable, deepseek, qwen4, inkling)...">
          <div id="wb-model-list" class="wb-checklist">
            <div class="wb-empty">Loading models...</div>
          </div>
          <input type="text" id="wb-custom-model" class="wb-input" placeholder="Custom spec(s): ollama:qwen4:32b, google:gemini-4-hydrogen">
        </div>

        <div class="wb-col">
          <div class="wb-col-label">Thinking Efforts</div>
          <div id="wb-effort-list" class="wb-checklist">
            <label class="wb-check-item"><input type="checkbox" name="wb-effort" value="default"><span class="wb-check-main"><span class="wb-check-title">default</span></span></label>
            <label class="wb-check-item"><input type="checkbox" name="wb-effort" value="off"><span class="wb-check-main"><span class="wb-check-title">off</span></span></label>
            <label class="wb-check-item"><input type="checkbox" name="wb-effort" value="low"><span class="wb-check-main"><span class="wb-check-title">low</span></span></label>
            <label class="wb-check-item"><input type="checkbox" name="wb-effort" value="medium"><span class="wb-check-main"><span class="wb-check-title">medium</span></span></label>
            <label class="wb-check-item"><input type="checkbox" name="wb-effort" value="high" checked><span class="wb-check-main"><span class="wb-check-title">high</span></span></label>
          </div>
        </div>

        <div class="wb-col">
          <div class="wb-col-label">Coding Fixtures</div>
          <div class="wb-filter-row" id="wb-task-presets">
            <button type="button" class="wb-chip-btn" data-preset="all">All 6</button>
            <button type="button" class="wb-chip-btn" data-preset="01">01 only</button>
            <button type="button" class="wb-chip-btn" data-preset="easy">Easy</button>
            <button type="button" class="wb-chip-btn" data-preset="hard">Hard</button>
            <button type="button" class="wb-chip-btn" data-preset="ts">TS</button>
            <button type="button" class="wb-chip-btn" data-preset="py">Py</button>
            <button type="button" class="wb-chip-btn" data-preset="clear">Clear</button>
          </div>
          <div id="wb-task-list" class="wb-checklist">
            <div class="wb-empty">Loading fixtures...</div>
          </div>
        </div>

        <div class="wb-col">
          <div class="wb-col-label">Extensions &amp; Execution Mode</div>
          <div id="wb-ext-list" class="wb-checklist">
            <label class="wb-check-item"><input type="checkbox" name="wb-ext" value="pi-default" checked disabled><span class="wb-check-main"><span class="wb-check-title">pi-default</span><span class="wb-check-meta">Built-in read/write/edit/bash/grep/find/ls</span></span></label>
            <label class="wb-check-item"><input type="checkbox" name="wb-ext" value="search-tools"><span class="wb-check-main"><span class="wb-check-title">search-tools</span><span class="wb-check-meta">Extra workspace search helpers</span></span></label>
            <label class="wb-check-item"><input type="checkbox" name="wb-ext" value="verify-on-yield"><span class="wb-check-main"><span class="wb-check-title">verify-on-yield</span><span class="wb-check-meta">Prompts model to run public tests before finishing</span></span></label>
            <label class="wb-check-item"><input type="checkbox" name="wb-ext" value="tool-search"><span class="wb-check-main"><span class="wb-check-title">tool-search</span><span class="wb-check-meta">BM25 lazy tool discovery</span></span></label>
            <label class="wb-check-item"><input type="checkbox" name="wb-ext" value="codemode"><span class="wb-check-main"><span class="wb-check-title">codemode</span><span class="wb-check-meta">Single JS harness script tool</span></span></label>
          </div>
          <input type="text" id="wb-custom-ext" class="wb-input" placeholder="Custom .ts/.mjs path(s), comma-separated">
          <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px; font-size:12px;">
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="radio" name="wb-mode" value="live" checked>
              <span><strong>Live API / Local GPU</strong> <span style="color:var(--muted);">(real model calls)</span></span>
            </label>
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="radio" name="wb-mode" value="mock">
              <span><strong>Mock Preview</strong> <span style="color:var(--muted);">(deterministic fauxProvider)</span></span>
            </label>
          </div>
        </div>
      </div>

      <div class="wb-launch-bar">
        <div style="font-size:12px; color:var(--muted);">
          Cloud models run up to 2 concurrently; local Ollama/MLX models run sequentially to avoid GPU contention.
        </div>
        <button type="button" class="wb-btn primary" id="wb-launch-btn">Launch Coding Session(s)</button>
      </div>
      <div id="wb-launch-error" class="wb-error-banner"></div>
    </section>

    <section class="wb-panel" aria-label="Live Session Console">
      <div class="wb-panel-head">
        <span class="wb-panel-title">2 · Live Session Console &amp; Checkout Inspector</span>
        <span id="wb-console-hint" style="font-size:12px; color:var(--muted);">Select or launch a coding session above</span>
      </div>

      <div id="wb-session-strip" class="wb-session-strip"></div>

      <div id="wb-console-empty" class="wb-empty">
        No active interactive coding sessions yet. Choose at least one model, effort, and fixture above and click Launch.
      </div>

      <div id="wb-console-body" class="wb-console-grid" style="display:none;">
        <div>
          <div class="wb-session-toolbar">
            <div class="wb-toolbar-top">
              <div>
                <div id="wb-active-title" style="font-family:var(--font-mono); font-size:13px; font-weight:600;"></div>
                <div id="wb-active-sub" style="font-size:11.5px; color:var(--muted); margin-top:2px;"></div>
              </div>
              <div class="wb-toolbar-actions">
                <button type="button" class="wb-btn danger" id="wb-abort-btn">Stop / Abort</button>
                <button type="button" class="wb-btn" id="wb-regrade-btn">Re-Grade</button>
                <button type="button" class="wb-btn good" id="wb-save-btn">Save to Dataset</button>
                <button type="button" class="wb-btn" id="wb-close-btn">Close Checkout</button>
              </div>
            </div>
            <div id="wb-active-metrics" class="wb-metrics-row"></div>
          </div>

          <div id="wb-trace-feed" class="wb-trace-feed"></div>
        </div>

        <div>
          <div class="wb-tabs" role="tablist">
            <button type="button" class="wb-tab-btn active" data-tab="grading">Grading</button>
            <button type="button" class="wb-tab-btn" data-tab="diff">Git Diff</button>
            <button type="button" class="wb-tab-btn" data-tab="chat">Follow-Up Chat</button>
          </div>

          <div id="wb-tab-grading" class="wb-tab-pane active">
            <div id="wb-grade-summary" class="wb-empty">Waiting for grading snapshot...</div>
            <pre id="wb-grade-details" class="wb-pre" style="margin-top:10px; display:none;"></pre>
          </div>

          <div id="wb-tab-diff" class="wb-tab-pane">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span id="wb-diff-files" style="font-family:var(--font-mono); font-size:11.5px; color:var(--muted);">No changes yet</span>
              <button type="button" class="wb-chip-btn" id="wb-refresh-diff">Refresh Diff</button>
            </div>
            <pre id="wb-diff-stat" class="wb-pre" style="margin-bottom:8px; max-height:140px; display:none;"></pre>
            <pre id="wb-diff-patch" class="wb-pre" style="max-height:380px;"></pre>
          </div>

          <div id="wb-tab-chat" class="wb-tab-pane">
            <p style="font-size:12px; color:var(--muted); margin-bottom:10px;">
              Continue conversing with the model inside this isolated checkout. Run Re-Grade to inspect updated hidden test scores.
              Saving to the dataset always records the initial autonomous score.
            </p>
            <div id="wb-chat-history" class="wb-pre" style="max-height:280px; font-family:var(--sans); white-space:normal;"></div>
            <form id="wb-chat-form" class="wb-chat-composer">
              <textarea id="wb-chat-input" class="wb-textarea" placeholder="Ask what changed, or ask the model to fix remaining edge cases..."></textarea>
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <button type="button" class="wb-btn" id="wb-chat-regrade">Re-Grade Snapshot</button>
                <button type="submit" class="wb-btn primary" id="wb-chat-send">Send Follow-Up</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>

    <section class="wb-panel" aria-label="Coding Benchmark Matrix">
      <div class="wb-panel-head">
        <span class="wb-panel-title">3 · Coding Benchmark Pareto &amp; Score Matrix</span>
        <div class="wb-filter-row" id="wb-report-mode-tabs">
          <button type="button" class="wb-chip-btn active" data-rmode="auto">Auto (Live then Mock)</button>
          <button type="button" class="wb-chip-btn" data-rmode="live">Live Dataset</button>
          <button type="button" class="wb-chip-btn" data-rmode="mock">Mock Dataset</button>
        </div>
      </div>

      <div id="wb-report-meta" style="font-family:var(--font-mono); font-size:11.5px; color:var(--muted); margin-bottom:12px;"></div>
      <div id="wb-pareto-area" class="wb-pareto-wrap">
        <div id="wb-pareto-svg" class="wb-empty">No dataset loaded yet</div>
        <div class="wb-table-wrap" id="wb-matrix-table"></div>
      </div>
    </section>
  </main>

  <script>
    (function () {
      var state = {
        catalog: null,
        modelFilter: "all",
        modelQuery: "",
        reportMode: "auto",
        sessions: new Map(),
        activeSessionId: null,
        activeTab: "grading",
        sources: new Map()
      };

      function esc(val) {
        return String(val == null ? "" : val)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function el(id) {
        return document.getElementById(id);
      }

      function modelSpecKey(m) {
        return m.provider + ":" + m.name;
      }

      function checkedValues(selector) {
        var nodes = document.querySelectorAll(selector);
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].checked) out.push(nodes[i].value);
        }
        return out;
      }

      function updateLaunchCount() {
        var models = checkedValues('input[name="wb-model"]');
        var customRaw = (el("wb-custom-model").value || "").trim();
        var customCount = customRaw
          ? customRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean).length
          : 0;
        var efforts = checkedValues('input[name="wb-effort"]');
        var tasks = checkedValues('input[name="wb-task"]');
        var total = (models.length + customCount) * Math.max(efforts.length, 0) * tasks.length;
        el("wb-launch-count").textContent = total + " session(s) queued";
      }

      function showLaunchError(msg) {
        var box = el("wb-launch-error");
        if (!msg) {
          box.textContent = "";
          box.classList.remove("visible");
        } else {
          box.textContent = msg;
          box.classList.add("visible");
        }
      }

      function renderModelList() {
        var container = el("wb-model-list");
        if (!state.catalog || !state.catalog.models) return;

        var checkedSet = new Set(checkedValues('input[name="wb-model"]'));
        var q = state.modelQuery.toLowerCase();
        var f = state.modelFilter;

        var rows = state.catalog.models.filter(function (m) {
          if (f === "open" && m.weights !== "open") return false;
          if (f === "closed" && m.weights !== "closed") return false;
          if (f === "local" && m.tier !== "local") return false;
          if (f === "laptop" && m.laptopFit !== "yes") return false;
          if (q) {
            var hay = (m.provider + ":" + m.name + " " + (m.tagline || "") + " " + (m.group || "")).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        });

        if (rows.length === 0) {
          container.innerHTML = '<div class="wb-empty">No models match current filter</div>';
          return;
        }

        container.innerHTML = rows.map(function (m) {
          var key = modelSpecKey(m);
          var isChecked = checkedSet.has(key);
          var wCls = m.weights === "open" ? "open" : "closed";
          var badges = [
            '<span class="wb-pill ' + wCls + '">' + esc(m.weights) + "</span>",
            '<span class="wb-pill ' + (m.tier === "local" ? "local" : "") + '">' + esc(m.tier) + "</span>"
          ];
          if (m.laptopFit === "yes") badges.push('<span class="wb-pill pass">laptop fit</span>');
          if (m.params) badges.push('<span class="wb-pill">' + esc(m.params) + "</span>");
          if (m.footprint) badges.push('<span class="wb-pill">' + esc(m.footprint) + "</span>");
          return '<label class="wb-check-item">' +
            '<input type="checkbox" name="wb-model" value="' + esc(key) + '"' + (isChecked ? " checked" : "") + ">" +
            '<span class="wb-check-main">' +
              '<span class="wb-check-title">' + esc(key) + "</span>" +
              '<span class="wb-check-meta">' + badges.join("") + (m.tagline ? "<span>" + esc(m.tagline) + "</span>" : "") + "</span>" +
            "</span>" +
          "</label>";
        }).join("");

        updateLaunchCount();
      }

      function renderTaskList() {
        var container = el("wb-task-list");
        if (!state.catalog || !state.catalog.tasks) return;
        var existing = checkedValues('input[name="wb-task"]');
        var checkedSet = new Set(existing.length > 0 ? existing : ["01-ledger-rounding"]);

        container.innerHTML = state.catalog.tasks.map(function (t) {
          var isChecked = checkedSet.has(t.id);
          return '<label class="wb-check-item">' +
            '<input type="checkbox" name="wb-task" value="' + esc(t.id) + '"' + (isChecked ? " checked" : "") + ">" +
            '<span class="wb-check-main">' +
              '<span class="wb-check-title">' + esc(t.id) + "</span>" +
              '<span class="wb-check-meta">' +
                '<span class="wb-pill">' + esc(t.difficulty) + "</span>" +
                '<span class="wb-pill">' + esc(t.language) + "</span>" +
                "<span>" + esc(t.title) + "</span>" +
              "</span>" +
            "</span>" +
          "</label>";
        }).join("");

        updateLaunchCount();
      }

      function renderReportSection() {
        var reports = state.catalog && state.catalog.reports ? state.catalog.reports : {};
        var chosen = null;
        if (state.reportMode === "live") chosen = reports.live || null;
        else if (state.reportMode === "mock") chosen = reports.mock || null;
        else chosen = reports.live || reports.mock || null;

        var metaEl = el("wb-report-meta");
        var svgEl = el("wb-pareto-svg");
        var tableEl = el("wb-matrix-table");

        if (!chosen || !chosen.models || chosen.models.length === 0) {
          metaEl.textContent = "No saved coding benchmark dataset for this view yet.";
          svgEl.innerHTML = '<div class="wb-empty">Run coding-bench or click Save to Dataset on a completed session.</div>';
          tableEl.innerHTML = "";
          return;
        }

        metaEl.textContent = "Dataset: " + chosen.mode.toUpperCase() +
          " · Generated: " + chosen.generatedAt +
          " · Models: " + chosen.models.length +
          " · Total Cost: $" + Number(chosen.totalRunCostUsd || 0).toFixed(4);

        var w = 460;
        var h = 250;
        var pad = { t: 18, r: 22, b: 36, l: 44 };
        var plotW = w - pad.l - pad.r;
        var plotH = h - pad.t - pad.b;
        var maxCost = Math.max(0.05, Math.max.apply(null, chosen.models.map(function (m) {
          return Number(m.totalCostUsd || 0);
        })));

        var dots = chosen.models.map(function (m) {
          var cost = Number(m.totalCostUsd || 0);
          var pass = Number(m.passRate || 0);
          var x = pad.l + (cost / maxCost) * plotW;
          var y = pad.t + plotH - (pass / 100) * plotH;
          var color = m.tier === "local" ? "#5b2c6f" : (pass >= 80 ? "#0e6b3f" : "#0055aa");
          var label = m.id + " (" + pass + "%, $" + cost.toFixed(3) + ")";
          return '<g><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6" fill="' + color + '" fill-opacity="0.82" stroke="#1a1a1a" stroke-width="1"><title>' + esc(label) + '</title></circle>' +
            '<text x="' + (x + 8).toFixed(1) + '" y="' + (y + 3).toFixed(1) + '" font-family="IBM Plex Mono, monospace" font-size="9.5" fill="#1a1a1a">' + esc(m.id.slice(0, 18)) + "</text></g>";
        }).join("");

        svgEl.innerHTML = '<div style="border:1px solid var(--border); background:var(--surface-raised); padding:8px;">' +
          '<svg viewBox="0 0 ' + w + " " + h + '" style="width:100%; height:auto; display:block;">' +
            '<line x1="' + pad.l + '" y1="' + pad.t + '" x2="' + pad.l + '" y2="' + (pad.t + plotH) + '" stroke="#1a1a1a" stroke-width="1"/>' +
            '<line x1="' + pad.l + '" y1="' + (pad.t + plotH) + '" x2="' + (pad.l + plotW) + '" y2="' + (pad.t + plotH) + '" stroke="#1a1a1a" stroke-width="1"/>' +
            '<text x="8" y="' + (pad.t + 8) + '" font-family="IBM Plex Mono, monospace" font-size="10" fill="#5c584e">100%</text>' +
            '<text x="14" y="' + (pad.t + plotH) + '" font-family="IBM Plex Mono, monospace" font-size="10" fill="#5c584e">0%</text>' +
            '<text x="' + (pad.l + plotW / 2 - 42) + '" y="' + (h - 8) + '" font-family="IBM Plex Mono, monospace" font-size="10" fill="#5c584e">Total Cost ($' + maxCost.toFixed(2) + ' max)</text>' +
            dots +
          "</svg>" +
        "</div>";

        var taskIds = (chosen.tasks || []).map(function (t) { return t.id; });
        tableEl.innerHTML = '<table class="labs-table"><thead><tr>' +
          "<th>Model</th><th>Effort</th><th>Pass@1</th><th>Score</th><th>Cost</th><th>Time</th>" +
          taskIds.map(function (tid) { return "<th>" + esc(tid.slice(0, 2)) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          chosen.models.map(function (m) {
            var byTask = new Map((m.taskResults || []).map(function (r) { return [r.taskId, r]; }));
            var cells = taskIds.map(function (tid) {
              var tr = byTask.get(tid);
              if (!tr) return '<td><span class="wb-pill">-</span></td>';
              return '<td><span class="wb-pill ' + (tr.passed ? "pass" : "fail") + '">' + tr.score + "/" + tr.maxScore + "</span></td>";
            }).join("");
            return "<tr>" +
              "<td><strong>" + esc(m.provider + ":" + m.id) + '</strong><br><span style="font-size:10.5px; color:var(--muted);">' + esc(m.extensionProfile) + "</span></td>" +
              "<td><code>" + esc(m.reasoningEffort || m.effectiveThinkingLevel || "-") + "</code></td>" +
              "<td><strong>" + esc(m.passRate) + "%</strong> (" + esc(m.passedTasks) + "/" + esc(m.totalTasks) + ")</td>" +
              "<td>" + esc(m.avgScore) + "/10</td>" +
              "<td>$" + Number(m.totalCostUsd || 0).toFixed(4) + "</td>" +
              "<td>" + esc(m.totalTimeSec) + "s</td>" +
              cells +
            "</tr>";
          }).join("") +
          "</tbody></table>";
      }

      async function loadCatalog() {
        var res = await fetch("/api/catalog");
        if (!res.ok) throw new Error("Failed to load /api/catalog");
        state.catalog = await res.json();
        renderModelList();
        renderTaskList();
        renderReportSection();
      }

      function updateGlobalStatus() {
        var list = Array.from(state.sessions.values());
        var active = list.filter(function (s) {
          return s.status === "idle" || s.status === "running" || s.status === "grading" || s.status === "chatting";
        }).length;
        var pill = el("wb-global-status");
        if (list.length === 0) {
          pill.textContent = "Ready";
          pill.className = "wb-pill";
        } else if (active > 0) {
          pill.textContent = active + " active / " + list.length + " session(s)";
          pill.className = "wb-pill running";
        } else {
          pill.textContent = list.length + " session(s) ready";
          pill.className = "wb-pill pass";
        }
      }

      function formatDiffHtml(raw) {
        if (!raw || !raw.trim()) return '<span class="diff-line-ctx">No uncommitted changes in checkout.</span>';
        return raw.split("\\n").map(function (line) {
          var cls = "diff-line-ctx";
          if (line.indexOf("diff --git") === 0 || line.indexOf("--- ") === 0 || line.indexOf("+++ ") === 0) cls = "diff-line-hdr";
          else if (line.indexOf("@@") === 0) cls = "diff-line-hunk";
          else if (line.indexOf("+") === 0) cls = "diff-line-add";
          else if (line.indexOf("-") === 0) cls = "diff-line-del";
          return '<span class="' + cls + '">' + esc(line) + "</span>";
        }).join("");
      }

      function renderSessionStrip() {
        var strip = el("wb-session-strip");
        var list = Array.from(state.sessions.values());
        updateGlobalStatus();

        if (list.length === 0) {
          strip.innerHTML = "";
          el("wb-console-empty").style.display = "block";
          el("wb-console-body").style.display = "none";
          return;
        }

        el("wb-console-empty").style.display = "none";
        el("wb-console-body").style.display = "grid";

        if (!state.activeSessionId || !state.sessions.has(state.activeSessionId)) {
          state.activeSessionId = list[0].id;
        }

        strip.innerHTML = list.map(function (s) {
          var isAct = s.id === state.activeSessionId;
          var scoreBadge = s.latestRecord
            ? '<span class="wb-pill ' + (s.latestRecord.passed ? "pass" : "fail") + '">' + s.latestRecord.score + "/" + s.latestRecord.maxScore + "</span>"
            : "";
          return '<div class="wb-session-tab' + (isAct ? " active" : "") + '" data-sid="' + esc(s.id) + '">' +
            "<span>" + esc(s.model) + "[" + esc(s.effort) + "] · " + esc(s.taskId.slice(0, 2)) + "</span>" +
            '<span class="wb-pill ' + esc(s.status) + '">' + esc(s.status) + "</span>" +
            scoreBadge +
          "</div>";
        }).join("");
      }

      function renderActiveSession() {
        renderSessionStrip();
        var s = state.sessions.get(state.activeSessionId);
        if (!s) return;

        el("wb-active-title").textContent = s.provider + ":" + s.model + "[" + s.effort + "] · " + s.taskId;
        el("wb-active-sub").textContent = "Session " + s.id + " · Extensions: " + s.extensionProfile + " · Mode: " + s.mode + (s.workspaceDir ? " · Checkout: " + s.workspaceDir : "");

        var isRunning = s.status === "running" || s.status === "chatting" || s.status === "grading";
        var isClosed = s.status === "closed";
        el("wb-abort-btn").disabled = !(s.status === "running" || s.status === "chatting");
        el("wb-regrade-btn").disabled = isRunning || isClosed;
        el("wb-save-btn").disabled = isRunning || !s.initialRecord;
        el("wb-close-btn").disabled = isClosed;
        el("wb-chat-send").disabled = isRunning || isClosed;
        el("wb-chat-regrade").disabled = isRunning || isClosed;

        var rec = s.latestRecord;
        var turns = s.turnCount || (rec ? rec.turns : 0);
        var cost = s.costUsd != null ? s.costUsd : (rec ? rec.costUsd : 0);
        el("wb-active-metrics").innerHTML =
          '<span>Status: <span class="wb-pill ' + esc(s.status) + '">' + esc(s.status) + "</span></span>" +
          "<span>Turns: <strong>" + esc(turns) + "</strong></span>" +
          "<span>Tools: <strong>" + esc(s.toolCount || (rec ? rec.toolCallsTotal : 0)) + "</strong></span>" +
          "<span>Cost: <strong>$" + Number(cost || 0).toFixed(4) + "</strong></span>";

        // Build trace HTML from session events
        var traceFeed = el("wb-trace-feed");
        var wasNearBottom = traceFeed.scrollHeight - traceFeed.scrollTop - traceFeed.clientHeight < 60;
        var parts = [];
        var toolElements = new Map();
        var partialEv = null;
        var chatMessages = [];

        for (var i = 0; i < (s.events || []).length; i++) {
          var ev = s.events[i];
          if (ev.type === "session_started") {
            parts.push('<div class="wb-ev-card"><strong>Started</strong> in <code>' + esc(ev.workspaceDir) + "</code> · Extensions: <code>" + esc(ev.extensionProfile) + "</code></div>");
          } else if (ev.type === "turn_start") {
            parts.push('<div class="wb-turn-sep">Turn ' + esc(ev.turn) + "</div>");
          } else if (ev.type === "partial") {
            partialEv = ev;
          } else if (ev.type === "assistant_turn") {
            partialEv = null;
            var thinkHtml = ev.thinking && ev.thinking.trim()
              ? '<details class="wb-think-details"><summary>Thinking (' + ev.thinking.length + ' chars)</summary><div class="wb-think-pre">' + esc(ev.thinking) + "</div></details>"
              : "";
            var bodyHtml = ev.text && ev.text.trim() ? '<div style="white-space:pre-wrap;">' + esc(ev.text) + "</div>" : "";
            var foot = '<div style="font-family:var(--font-mono); font-size:10.5px; color:var(--muted); margin-top:4px;">$' + Number(ev.costUsd || 0).toFixed(4) + " · " + esc(ev.tokens ? ev.tokens.total : 0) + " tok</div>";
            parts.push('<div class="wb-ev-card">' + thinkHtml + bodyHtml + foot + "</div>");
            if (ev.text && ev.text.trim()) {
              chatMessages.push({ role: "assistant", text: ev.text, meta: "$" + Number(ev.costUsd || 0).toFixed(4) });
            }
          } else if (ev.type === "tool_start") {
            var tc = { callId: ev.callId, name: ev.name, args: JSON.stringify(ev.arguments || {}, null, 2), done: false, isError: false, out: "" };
            toolElements.set(ev.callId, parts.length);
            parts.push(tc);
          } else if (ev.type === "tool_end") {
            var idx = toolElements.get(ev.callId);
            if (idx != null && typeof parts[idx] === "object") {
              parts[idx].done = true;
              parts[idx].isError = Boolean(ev.isError);
              parts[idx].out = ev.outputPreview || "";
            }
          } else if (ev.type === "graded") {
            partialEv = null;
            var gr = ev.record;
            var cls = gr.passed ? "graded-pass" : "graded-fail";
            var label = ev.isInitialEval ? "Initial Autonomous Grade" : "Re-Graded Snapshot";
            parts.push('<div class="wb-ev-card ' + cls + '"><strong>' + label + ": " + (gr.passed ? "PASS" : "FAIL") + " (" + gr.score + "/" + gr.maxScore + ")</strong> · Visible " + gr.visibleTests.passed + "/" + gr.visibleTests.total + " · Hidden " + gr.hiddenTests.passed + "/" + gr.hiddenTests.total + "</div>");
          } else if (ev.type === "followup_user") {
            parts.push('<div class="wb-ev-card user-msg"><strong>You:</strong> ' + esc(ev.message) + "</div>");
            chatMessages.push({ role: "user", text: ev.message });
          } else if (ev.type === "followup_done") {
            partialEv = null;
            parts.push('<div class="wb-ev-card" style="font-family:var(--font-mono); font-size:11px; color:var(--muted);">Follow-up done · +' + ev.turns + " turn(s) · +$" + Number(ev.costUsd || 0).toFixed(4) + "</div>");
          } else if (ev.type === "status" && ev.error) {
            parts.push('<div class="wb-ev-card graded-fail"><strong>Error:</strong> ' + esc(ev.error) + "</div>");
          }
        }

        var html = parts.map(function (item) {
          if (typeof item === "string") return item;
          var badge = item.done
            ? (item.isError ? '<span class="wb-pill fail">err</span>' : '<span class="wb-pill pass">ok</span>')
            : '<span class="wb-pill running">running</span>';
          var outBlock = item.done && item.out ? '<div class="wb-tool-out">' + esc(item.out) + "</div>" : "";
          return '<div class="wb-tool-card">' +
            '<div class="wb-tool-head"><span>→ ' + esc(item.name) + "</span>" + badge + "</div>" +
            '<div class="wb-tool-args">' + esc(item.args) + "</div>" +
            outBlock +
          "</div>";
        }).join("");

        if (partialEv && (partialEv.thinking || partialEv.text || (partialEv.activeTools && partialEv.activeTools.length > 0))) {
          var pTools = (partialEv.activeTools || []).map(function (t) {
            return '<span class="wb-pill running">' + esc(t.name + ":" + t.status) + "</span>";
          }).join(" ");
          html += '<div class="wb-partial-box visible">' +
            "<div><strong>Streaming...</strong> " + pTools + "</div>" +
            (partialEv.thinking ? '<div style="margin-top:4px; color:var(--muted);">[think] ' + esc(partialEv.thinking.slice(-260)) + "</div>" : "") +
            (partialEv.text ? '<div style="margin-top:4px;">' + esc(partialEv.text.slice(-300)) + "</div>" : "") +
          "</div>";
        }

        traceFeed.innerHTML = html || '<div class="wb-empty">Connecting to EventSource stream...</div>';
        if (wasNearBottom) traceFeed.scrollTop = traceFeed.scrollHeight;

        // Grading tab
        var gSummary = el("wb-grade-summary");
        var gDetails = el("wb-grade-details");
        if (rec) {
          gSummary.className = "wb-ev-card " + (rec.passed ? "graded-pass" : "graded-fail");
          var initNote = s.initialRecord && s.latestRecord && s.initialRecord !== s.latestRecord
            ? '<div style="margin-top:6px; font-size:11.5px;">Initial autonomous score: <strong>' + s.initialRecord.score + "/" + s.initialRecord.maxScore + "</strong></div>"
            : "";
          gSummary.innerHTML =
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
              "<strong>" + (rec.passed ? "PASS" : "FAIL") + " · " + rec.score + "/" + rec.maxScore + "</strong>" +
              '<span class="wb-pill">' + esc(rec.stopReason) + "</span>" +
            "</div>" +
            '<div style="font-family:var(--font-mono); font-size:11.5px; margin-top:6px;">' +
              "Visible: " + rec.visibleTests.passed + "/" + rec.visibleTests.total +
              " · Hidden: " + rec.hiddenTests.passed + "/" + rec.hiddenTests.total +
              (rec.cheatedProtectedFiles ? " · CHEATED PROTECTED FILES" : "") +
            "</div>" + initNote;
          gDetails.style.display = "block";
          gDetails.textContent = rec.details || "";
        } else {
          gSummary.className = "wb-empty";
          gSummary.textContent = "Waiting for grading snapshot...";
          gDetails.style.display = "none";
        }

        // Diff tab
        var dFiles = el("wb-diff-files");
        var dStat = el("wb-diff-stat");
        var dPatch = el("wb-diff-patch");
        if (s.diff) {
          dFiles.textContent = (s.diff.changedFiles && s.diff.changedFiles.length > 0)
            ? s.diff.changedFiles.length + " changed file(s): " + s.diff.changedFiles.join(", ")
            : "No modified files in checkout";
          if (s.diff.gitDiffStat) {
            dStat.style.display = "block";
            dStat.textContent = s.diff.gitDiffStat;
          } else {
            dStat.style.display = "none";
          }
          dPatch.innerHTML = formatDiffHtml(s.diff.gitDiff || "");
        } else {
          dFiles.textContent = "No diff snapshot yet";
          dStat.style.display = "none";
          dPatch.innerHTML = '<span class="diff-line-ctx">Waiting for session activity...</span>';
        }

        // Chat tab
        var chatEl = el("wb-chat-history");
        if (chatMessages.length === 0) {
          chatEl.innerHTML = '<div class="wb-empty">No messages yet.</div>';
        } else {
          chatEl.innerHTML = chatMessages.map(function (m) {
            return '<div class="wb-ev-card ' + (m.role === "user" ? "user-msg" : "") + '" style="margin-bottom:6px;">' +
              "<strong>" + (m.role === "user" ? "You" : "Assistant") + ":</strong> " +
              '<div style="white-space:pre-wrap; margin-top:2px;">' + esc(m.text) + "</div>" +
            "</div>";
          }).join("");
          chatEl.scrollTop = chatEl.scrollHeight;
        }
      }

      async function refreshSessionSnapshot(id) {
        var res = await fetch("/api/sessions/" + encodeURIComponent(id));
        if (!res.ok) return;
        var snap = await res.json();
        var existing = state.sessions.get(id) || { id: id, events: [] };
        existing.status = snap.status;
        existing.provider = snap.provider;
        existing.model = snap.model;
        existing.effort = snap.effort;
        existing.taskId = snap.taskId;
        existing.extensionProfile = snap.extensionProfile;
        existing.workspaceDir = snap.workspaceDir;
        existing.mode = snap.mode;
        existing.initialRecord = snap.initialRecord || existing.initialRecord;
        existing.latestRecord = snap.latestRecord || existing.latestRecord;
        existing.diff = snap.diff || existing.diff;
        state.sessions.set(id, existing);
        if (state.activeSessionId === id) renderActiveSession();
        else renderSessionStrip();
      }

      function attachEventSource(id) {
        if (state.sources.has(id)) return;
        var src = new EventSource("/api/sessions/" + encodeURIComponent(id) + "/events");
        state.sources.set(id, src);

        src.onopen = function () {
          var s = state.sessions.get(id);
          if (s) {
            s.events = [];
            s.turnCount = 0;
            s.toolCount = 0;
            s.costUsd = 0;
          }
        };

        src.onmessage = function (msg) {
          if (!msg.data) return;
          var ev = JSON.parse(msg.data);
          var s = state.sessions.get(id);
          if (!s) return;

          s.events.push(ev);
          if (ev.type === "session_started") {
            s.workspaceDir = ev.workspaceDir;
            s.extensionProfile = ev.extensionProfile;
          } else if (ev.type === "status") {
            s.status = ev.status;
            if (ev.status === "ready" || ev.status === "aborted" || ev.status === "error") {
              refreshSessionSnapshot(id);
            }
          } else if (ev.type === "turn_start") {
            s.turnCount = Math.max(s.turnCount || 0, ev.turn);
          } else if (ev.type === "tool_start") {
            s.toolCount = (s.toolCount || 0) + 1;
          } else if (ev.type === "assistant_turn") {
            s.costUsd = (s.costUsd || 0) + Number(ev.costUsd || 0);
          } else if (ev.type === "graded") {
            if (ev.isInitialEval && !s.initialRecord) s.initialRecord = ev.record;
            s.latestRecord = ev.record;
            refreshSessionSnapshot(id);
          } else if (ev.type === "followup_done") {
            refreshSessionSnapshot(id);
          }

          if (state.activeSessionId === id) renderActiveSession();
          else if (ev.type === "status" || ev.type === "graded") renderSessionStrip();
        };
      }

      async function hydrateExistingSessions() {
        var res = await fetch("/api/sessions");
        if (!res.ok) return;
        var data = await res.json();
        var list = data.sessions || [];
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          var cur = state.sessions.get(item.id) || Object.assign({ events: [] }, item);
          Object.assign(cur, item);
          state.sessions.set(item.id, cur);
          if (item.status !== "closed") attachEventSource(item.id);
        }
        if (!state.activeSessionId && list.length > 0) state.activeSessionId = list[0].id;
        renderActiveSession();
      }

      async function launchSessions() {
        showLaunchError("");
        var models = checkedValues('input[name="wb-model"]');
        var customRaw = (el("wb-custom-model").value || "").trim();
        if (customRaw) {
          customRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (spec) {
            models.push(spec);
          });
        }
        var efforts = checkedValues('input[name="wb-effort"]');
        var tasks = checkedValues('input[name="wb-task"]');
        var extNames = checkedValues('input[name="wb-ext"]');
        var customExtRaw = (el("wb-custom-ext").value || "").trim();
        var customExtPaths = customExtRaw
          ? customExtRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean)
          : [];
        var modeNode = document.querySelector('input[name="wb-mode"]:checked');
        var mode = modeNode ? modeNode.value : "live";

        if (models.length === 0) return showLaunchError("Select or enter at least one model.");
        if (efforts.length === 0) return showLaunchError("Select at least one thinking effort.");
        if (tasks.length === 0) return showLaunchError("Select at least one coding fixture.");

        var btn = el("wb-launch-btn");
        btn.disabled = true;
        try {
          var res = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              models: models,
              efforts: efforts,
              tasks: tasks,
              extensions: extNames,
              customExtensions: customExtPaths,
              mode: mode
            })
          });
          var body = await res.json();
          if (!res.ok) {
            showLaunchError(body.error || "Failed to launch coding sessions");
            return;
          }
          var created = body.sessions || [];
          for (var i = 0; i < created.length; i++) {
            var item = created[i];
            state.sessions.set(item.id, Object.assign({ events: [], turnCount: 0, toolCount: 0, costUsd: 0 }, item));
            attachEventSource(item.id);
          }
          if (created.length > 0) state.activeSessionId = created[0].id;
          renderActiveSession();
        } catch (err) {
          showLaunchError(err && err.message ? err.message : String(err));
        } finally {
          btn.disabled = false;
        }
      }

      async function sessionAction(pathSuffix, method, payload) {
        var id = state.activeSessionId;
        if (!id) return;
        var res = await fetch("/api/sessions/" + encodeURIComponent(id) + pathSuffix, {
          method: method || "POST",
          headers: payload ? { "Content-Type": "application/json" } : undefined,
          body: payload ? JSON.stringify(payload) : undefined
        });
        var body = await res.json();
        if (!res.ok) {
          showLaunchError(body.error || "Action failed");
          return;
        }
        return body;
      }

      // Wire events
      el("wb-refresh-catalog").addEventListener("click", loadCatalog);
      el("wb-model-filters").addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-filter]");
        if (!btn) return;
        var btns = el("wb-model-filters").querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
        btn.classList.add("active");
        state.modelFilter = btn.getAttribute("data-filter");
        renderModelList();
      });
      el("wb-model-search").addEventListener("input", function (e) {
        state.modelQuery = e.target.value || "";
        renderModelList();
      });
      el("wb-task-presets").addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-preset]");
        if (!btn || !state.catalog) return;
        var preset = btn.getAttribute("data-preset");
        var boxes = document.querySelectorAll('input[name="wb-task"]');
        var taskMap = new Map(state.catalog.tasks.map(function (t) { return [t.id, t]; }));
        for (var i = 0; i < boxes.length; i++) {
          var t = taskMap.get(boxes[i].value);
          if (!t) continue;
          if (preset === "all") boxes[i].checked = true;
          else if (preset === "clear") boxes[i].checked = false;
          else if (preset === "01") boxes[i].checked = t.id.indexOf("01-") === 0;
          else if (preset === "easy") boxes[i].checked = t.difficulty === "easy";
          else if (preset === "hard") boxes[i].checked = t.difficulty === "hard";
          else if (preset === "ts") boxes[i].checked = t.language === "typescript";
          else if (preset === "py") boxes[i].checked = t.language === "python";
        }
        updateLaunchCount();
      });

      document.body.addEventListener("change", function (e) {
        if (e.target.name === "wb-model" || e.target.name === "wb-effort" || e.target.name === "wb-task") {
          updateLaunchCount();
        }
      });
      el("wb-custom-model").addEventListener("input", updateLaunchCount);
      el("wb-launch-btn").addEventListener("click", launchSessions);

      el("wb-session-strip").addEventListener("click", function (e) {
        var tab = e.target.closest(".wb-session-tab");
        if (!tab) return;
        state.activeSessionId = tab.getAttribute("data-sid");
        renderActiveSession();
        refreshSessionSnapshot(state.activeSessionId);
      });

      document.querySelector(".wb-tabs").addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-tab]");
        if (!btn) return;
        state.activeTab = btn.getAttribute("data-tab");
        var btns = document.querySelectorAll(".wb-tab-btn");
        var panes = document.querySelectorAll(".wb-tab-pane");
        for (var i = 0; i < btns.length; i++) {
          btns[i].classList.toggle("active", btns[i].getAttribute("data-tab") === state.activeTab);
        }
        for (var j = 0; j < panes.length; j++) {
          panes[j].classList.toggle("active", panes[j].id === "wb-tab-" + state.activeTab);
        }
      });

      el("wb-abort-btn").addEventListener("click", function () {
        sessionAction("/abort", "POST");
      });
      el("wb-regrade-btn").addEventListener("click", function () {
        sessionAction("/grade", "POST");
      });
      el("wb-chat-regrade").addEventListener("click", function () {
        sessionAction("/grade", "POST");
      });
      el("wb-save-btn").addEventListener("click", async function () {
        var res = await sessionAction("/save", "POST");
        if (res && res.savedTo) {
          await loadCatalog();
          el("wb-console-hint").textContent = "Saved initial autonomous score to " + res.savedTo;
        }
      });
      el("wb-refresh-diff").addEventListener("click", function () {
        if (state.activeSessionId) refreshSessionSnapshot(state.activeSessionId);
      });
      el("wb-close-btn").addEventListener("click", async function () {
        var id = state.activeSessionId;
        if (!id) return;
        await sessionAction("", "DELETE");
        var src = state.sources.get(id);
        if (src) {
          src.close();
          state.sources.delete(id);
        }
        state.sessions.delete(id);
        state.activeSessionId = null;
        renderActiveSession();
      });
      el("wb-chat-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        var input = el("wb-chat-input");
        var msg = (input.value || "").trim();
        if (!msg) return;
        input.value = "";
        await sessionAction("/chat", "POST", { message: msg });
      });

      el("wb-report-mode-tabs").addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-rmode]");
        if (!btn) return;
        var btns = el("wb-report-mode-tabs").querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
        btn.classList.add("active");
        state.reportMode = btn.getAttribute("data-rmode");
        renderReportSection();
      });

      loadCatalog().then(hydrateExistingSessions);
    })();
  </script>
</body>
</html>`;
}
