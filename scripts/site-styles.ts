/**
 * Shared stylesheet for `umwelten.thefocus.ai` — faithfully implementing
 * TheFocus.AI Labs ("Bell Labs Warm Paper" / Ledger v2.0.1) design system
 * from `../labs` (`global.css`, `_labs-shared.css`, `ModelPicks.astro`,
 * `QuarterItemCard.astro`, `ArticleLayout.astro`, `local-providers.css`).
 */

export const LABS_CSS = `/* ==========================================================================
   TheFocus.AI / Umwelten — Bell Labs Warm Paper & Ledger Design System
   Matches ../labs (The-Focus-AI/labs) v2.0.1
   ========================================================================== */

@import url('https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,700;1,9..144,400&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;900&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;0,8..60,900;1,8..60,400;1,8..60,700&display=swap');

:root {
  /* Bell Labs Warm Paper (../labs canonical light palette) */
  --canvas: #f3f2ea;
  --bg: #f3f2ea;
  --surface: #e8e6df;
  --bg-alt: #e8e6df;
  --surface-raised: #faf8f2;
  --paper: #ffffff;

  /* Ink hierarchy */
  --ink: #1a1a1a;
  --void: #1a1a1a;
  --text-strong: #141310;
  --text: #22201c;
  --text-2: #524f47;
  --ink-light: rgba(26, 26, 26, 0.72);
  --muted: #5c584e;
  --muted-soft: #7b7669;
  --ink-faint: rgba(26, 26, 26, 0.48);

  /* Rules & drafting textures */
  --border: rgba(26, 26, 26, 0.16);
  --border-strong: rgba(26, 26, 26, 0.30);
  --hover-fill: rgba(26, 26, 26, 0.04);
  --drafting-dot: rgba(26, 26, 26, 0.14);

  /* Brand signals */
  --signal: #0055aa;          /* Rand Blue — primary */
  --accent: #0055aa;
  --accent-soft: #e6eef7;
  --accent-red: #d93025;      /* Alert Red — secondary */
  --accent-warm: #c2492a;     /* Terracotta issue dot / rule tab */

  /* Semantic status */
  --green: #0e6b3f;
  --green-bg: #e6f1eb;
  --yellow: #b8860b;
  --yellow-bg: #fdf6e3;
  --red: #d93025;
  --red-bg: #fce8e6;
  --local: #5b2c6f;
  --local-bg: #f4ecf7;
  --gray: #6b6b6b;
  --gray-bg: #ececec;

  /* Typography */
  --serif: 'Source Serif 4', Georgia, 'Times New Roman', serif;
  --display-card: 'Fraunces', 'Source Serif 4', Georgia, serif;
  --sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --mono: 'Courier Prime', 'IBM Plex Mono', ui-monospace, monospace;

  /* Strict zero radius across the entire design system */
  --radius: 0px;
  --gutter: 32px;
  --container-max: 1200px;
  --report-max: 1120px;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  max-width: 100%;
  overflow-x: clip;
  background: var(--canvas);
  color: var(--text);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

main {
  flex: 1;
  min-width: 0;
}

::selection {
  background: var(--signal);
  color: #ffffff;
}

a {
  color: var(--signal);
  text-decoration: underline;
  text-decoration-thickness: 1.5px;
  text-underline-offset: 3px;
}

a:hover {
  color: var(--accent-red);
}

code {
  font-family: var(--font-mono);
  font-size: 0.84em;
  background: var(--bg-alt);
  padding: 0.1rem 0.35rem;
  border: 1px solid var(--border);
  color: var(--text-strong);
}

/* ── Top Scroll Progress Rule ───────────────────────────────────────────── */
.scroll-progress-rule {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--signal);
  transform-origin: 0 50%;
  transform: scaleX(0);
  z-index: 60;
  pointer-events: none;
}

@supports (animation-timeline: scroll()) {
  .scroll-progress-rule {
    animation: scroll-rule-fill linear both;
    animation-timeline: scroll(root block);
  }
}

@keyframes scroll-rule-fill {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* ── Masthead (.site-header from ../labs) ───────────────────────────────── */
.site-header {
  background: color-mix(in srgb, var(--canvas) 94%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border-strong);
  position: sticky;
  top: 0;
  z-index: 40;
}

.site-header-inner {
  max-width: var(--container-max);
  margin: 0 auto;
  padding: 0.85rem var(--gutter);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.25rem;
  flex-wrap: wrap;
}

.masthead-brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-wrap: wrap;
}

.wordmark {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  text-decoration: none;
  color: var(--void);
}

.wordmark:hover {
  color: var(--void);
}

.wordmark-glyph {
  width: 20px;
  height: 20px;
  border: 1px solid var(--signal);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.wordmark-glyph::after {
  content: '';
  width: 8px;
  height: 8px;
  background: var(--signal);
}

.wordmark-text {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--void);
}

.wordmark-divider {
  font-family: var(--mono);
  color: var(--accent-red);
  font-size: 12px;
  font-weight: 700;
}

.wordmark-sub {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--void);
  opacity: 0.78;
}

.masthead-issue-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.22rem 0.6rem;
  border: 1px solid var(--border-strong);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--text-2);
  transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
}

.masthead-issue-pill:hover {
  border-color: var(--signal);
  color: var(--text-strong);
  background: var(--hover-fill);
}

.masthead-issue-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent-warm);
}

.site-nav {
  display: flex;
  align-items: center;
  gap: 1.05rem;
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.site-nav a {
  position: relative;
  text-decoration: none;
  color: var(--text-2);
  padding: 0.35rem 0;
  transition: color 140ms ease;
}

.site-nav a:hover,
.site-nav a[aria-current="page"] {
  color: var(--text-strong);
}

.nav-active-underline {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 2px;
  background: var(--signal);
  display: block;
}

.site-nav-gh {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--surface);
  color: var(--text-strong) !important;
  border: 1px solid var(--border-strong);
  padding: 0.32rem 0.65rem !important;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.site-nav-gh:hover {
  border-color: var(--signal);
  background: var(--surface-raised);
}

/* ── Sticky Storyline Sub-Header (ArticleLayout.astro) ──────────────────── */
.issue-storyline {
  position: sticky;
  top: 53px;
  z-index: 30;
  background: color-mix(in srgb, var(--canvas) 95%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border-strong);
}

.storyline-inner {
  max-width: var(--container-max);
  margin: 0 auto;
  padding: 0.55rem var(--gutter);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.storyline-back {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--text-strong);
}

.storyline-back:hover {
  color: var(--signal);
}

.storyline-center {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: var(--text);
  font-size: 12.5px;
  min-width: 0;
}

.storyline-pill {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.16rem 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  color: var(--text-strong);
  white-space: nowrap;
}

.storyline-title {
  font-family: var(--display-card);
  font-weight: 500;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 44ch;
}

.storyline-actions {
  display: flex;
  gap: 0.45rem;
  align-items: center;
}

.storyline-btn {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.34rem 0.7rem;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--text-strong);
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
}

.storyline-btn:hover {
  border-color: var(--signal);
  color: var(--signal);
}

.storyline-btn--primary {
  background: var(--text-strong);
  color: var(--canvas);
  border-color: var(--text-strong);
}

.storyline-btn--primary:hover {
  background: var(--signal);
  border-color: var(--signal);
  color: #ffffff;
}

/* ── Main Container & Hero (_labs-shared.css) ───────────────────────────── */
.container {
  max-width: var(--report-max);
  margin: 0 auto;
  padding: 0 var(--gutter);
}

.hero {
  padding: 4.5rem 0 3.25rem;
  border-bottom: 2px solid var(--ink);
  position: relative;
  overflow: hidden;
}

.hero::before {
  content: '';
  position: absolute;
  top: -120px;
  right: -80px;
  width: 420px;
  height: 420px;
  background: radial-gradient(circle, rgba(0, 85, 170, 0.07) 0%, transparent 70%);
  pointer-events: none;
}

.hero-label {
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent-red);
  margin-bottom: 1.25rem;
  font-weight: 700;
}

.hero h1 {
  font-family: var(--serif);
  font-size: clamp(2.45rem, 5.4vw, 4.05rem);
  font-weight: 900;
  line-height: 1.03;
  letter-spacing: -0.02em;
  margin-bottom: 1.35rem;
  color: var(--ink);
}

.hero h1 em {
  font-style: italic;
  color: var(--accent);
}

.hero-subtitle {
  font-size: 1.12rem;
  color: var(--ink-light);
  max-width: 66ch;
  line-height: 1.6;
  border-left: 4px solid var(--accent-red);
  padding: 4px 0 4px 1.25rem;
}

.hero-meta {
  margin-top: 1.75rem;
  display: flex;
  gap: 1.5rem 2rem;
  flex-wrap: wrap;
  font-size: 0.76rem;
  color: var(--ink-faint);
  font-family: var(--mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  align-items: center;
}

.hero-meta strong {
  color: var(--ink);
}

/* ── Stats Row (_labs-shared.css) ───────────────────────────────────────── */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: var(--ink);
  border: 1px solid var(--ink);
  margin: 2.5rem 0;
}

.stat-card {
  background: var(--paper);
  padding: 1.4rem 1.15rem;
  text-align: center;
}

.stat-num {
  font-family: var(--serif);
  font-size: 2.45rem;
  font-weight: 900;
  line-height: 1;
  margin-bottom: 0.45rem;
  color: var(--accent);
}

.stat-label {
  font-family: var(--mono);
  font-size: 0.69rem;
  color: var(--accent-red);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 700;
}

.stat-sub {
  margin-top: 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--ink-faint);
}

.stat-card.s-green .stat-num  { color: var(--green); }
.stat-card.s-accent .stat-num { color: var(--accent); }
.stat-card.s-yellow .stat-num { color: var(--yellow); }
.stat-card.s-local .stat-num  { color: var(--local); }
.stat-card.s-ink .stat-num    { color: var(--ink); }

/* ── Model Picks Callout (ModelPicks.astro) ─────────────────────────────── */
.model-picks {
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--signal);
  padding: 1.15rem 1.35rem 1.3rem;
  margin: 0 0 2.5rem;
}

.model-picks-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 0.9rem;
  padding-bottom: 0.55rem;
  border-bottom: 1px solid var(--border);
}

.model-picks-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--signal);
}

.model-picks-date {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--muted-soft);
}

.model-picks ul {
  list-style: none;
  display: grid;
  gap: 0.62rem;
}

.model-picks li {
  display: grid;
  grid-template-columns: 98px minmax(215px, auto) 1fr;
  gap: 0.35rem 1rem;
  align-items: baseline;
}

.pick-role {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-red);
}

.pick-name {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-strong);
  white-space: nowrap;
}

.pick-note {
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--muted);
}

/* ── Sections & Headings (_labs-shared.css) ─────────────────────────────── */
section.report-section {
  padding: 3rem 0;
  border-bottom: 1px solid var(--border-strong);
  scroll-margin-top: 68px;
}

section.report-section:last-of-type {
  border-bottom: none;
}

.section-num {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent-red);
  margin-bottom: 0.65rem;
  font-weight: 700;
}

h2.section-title {
  font-family: var(--sans);
  font-size: 1.65rem;
  font-weight: 900;
  letter-spacing: -0.015em;
  margin-bottom: 1rem;
  line-height: 1.15;
  color: var(--ink);
}

h3.sub-title {
  font-family: var(--sans);
  font-size: 1.06rem;
  font-weight: 700;
  margin: 2rem 0 0.75rem;
  color: var(--ink);
}

p.body-text {
  max-width: 65ch;
  margin-bottom: 1rem;
  color: var(--ink-light);
}

/* ── Pareto Drafting Frame & Inspector ──────────────────────────────────── */
.pareto-frame {
  background: var(--paper);
  border: 1px solid var(--ink);
  box-shadow: 8px 8px 0px 0px rgba(26, 26, 26, 0.08);
  padding: 1.5rem 1.5rem 1.25rem;
  margin: 1.5rem 0 2rem;
}

.pareto-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

.pareto-toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.pareto-toolbar-label {
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
  margin-right: 0.35rem;
}

.pareto-legend {
  display: flex;
  gap: 1.1rem;
  flex-wrap: wrap;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-2);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.legend-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
}

.pareto-svg-wrap {
  width: 100%;
  overflow-x: auto;
}

.pareto-svg-wrap svg {
  width: 100%;
  height: auto;
  display: block;
  min-width: 680px;
}

.pareto-inspector {
  margin-top: 1rem;
  padding: 1rem 1.2rem;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--signal);
  display: grid;
  grid-template-columns: minmax(220px, 1.1fr) minmax(240px, 1.4fr) 1.5fr;
  gap: 1.25rem;
  align-items: center;
}

.inspector-name {
  font-family: var(--font-mono);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-strong);
}

.inspector-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  margin-top: 0.25rem;
}

.inspector-bars {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.55rem;
}

.inspector-dim {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}

.inspector-dim strong {
  display: block;
  font-size: 13px;
  color: var(--text-strong);
  margin-top: 1px;
}

.inspector-note {
  font-size: 13px;
  line-height: 1.48;
  color: var(--text-2);
}

.pareto-inspector-tasks {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--border);
}

.task-chip {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 0.16rem 0.45rem;
  border: 1px solid var(--border-strong);
  background: var(--paper);
  color: var(--text);
}

.task-chip.is-pass {
  background: var(--green-bg);
  border-color: rgba(14, 107, 63, 0.35);
  color: var(--green);
}

.task-chip.is-partial {
  background: var(--yellow-bg);
  border-color: rgba(184, 134, 11, 0.4);
  color: var(--yellow);
}

.task-chip.is-fail {
  background: var(--red-bg);
  border-color: rgba(217, 48, 37, 0.4);
  color: var(--red);
}

/* ── Controls, Filters & Sortable Tables (_labs-shared.css) ─────────────── */
.table-controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
  flex-wrap: wrap;
  align-items: center;
}

.table-controls input[type="text"] {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--ink);
  background: var(--paper);
  color: var(--ink);
  outline: none;
  min-width: 210px;
}

.table-controls input[type="text"]:focus {
  border-color: var(--signal);
}

.filter-btn {
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 0.42rem 0.82rem;
  border: 1px solid var(--ink);
  background: var(--paper);
  color: var(--ink-light);
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.filter-btn:hover {
  color: var(--ink);
  background: var(--surface-raised);
}

.filter-btn.active {
  background: var(--ink);
  color: var(--bg);
  border-color: var(--ink);
}

.filter-sep {
  color: var(--border-strong);
  margin: 0 0.2rem;
}

.range-filters {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}

.range-filter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.range-filter label {
  font-family: var(--mono);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
  font-weight: 700;
}

.range-filter input[type="range"] {
  width: 115px;
  accent-color: var(--signal);
  cursor: pointer;
}

.range-filter .range-val {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--ink);
  min-width: 52px;
}

.filter-summary {
  font-family: var(--mono);
  font-size: 0.74rem;
  color: var(--ink-faint);
  margin-bottom: 0.6rem;
}

.results-table-wrap {
  overflow-x: auto;
  margin: 1rem 0 1.5rem;
  border: 1px solid var(--ink);
}

table.labs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

table.labs-table th {
  background: var(--ink);
  color: var(--bg);
  padding: 0.68rem 0.85rem;
  text-align: left;
  font-family: var(--mono);
  font-size: 0.69rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  user-select: none;
}

table.labs-table th[data-sort] {
  cursor: pointer;
}

table.labs-table th[data-sort]:hover {
  background: #2d2c28;
}

table.labs-table td {
  padding: 0.56rem 0.85rem;
  border-bottom: 1px solid var(--bg-alt);
  background: var(--paper);
  white-space: nowrap;
}

table.labs-table tr:hover td {
  background: var(--surface-raised);
}

table.labs-table tr.tier-1 td:first-child { border-left: 3px solid var(--green); }
table.labs-table tr.tier-2 td:first-child { border-left: 3px solid var(--signal); }
table.labs-table tr.tier-3 td:first-child { border-left: 3px solid var(--yellow); }
table.labs-table tr.tier-4 td:first-child { border-left: 3px solid var(--red); }
table.labs-table tr.tier-local td:first-child { border-left: 3px solid var(--local); }

.model-cell   { font-family: var(--font-mono); font-size: 0.78rem; font-weight: 500; color: var(--text-strong); }
.score-cell   { font-family: var(--font-mono); font-size: 0.8rem; }
.combined-cell { font-family: var(--font-mono); font-weight: 600; font-size: 0.83rem; }
.cost-cell    { font-family: var(--font-mono); font-size: 0.77rem; color: var(--muted); }
.time-cell    { font-family: var(--font-mono); font-size: 0.77rem; color: var(--muted); }

.score-perfect { color: var(--green); font-weight: 600; }
.score-good    { color: var(--text-strong); }
.score-mid     { color: var(--yellow); }
.score-low     { color: var(--red); }

/* ── Badges (_labs-shared.css) ──────────────────────────────────────────── */
.badge {
  display: inline-block;
  padding: 0.13rem 0.46rem;
  font-family: var(--mono);
  font-size: 0.63rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid currentColor;
  white-space: nowrap;
}

.badge-pareto { background: var(--accent-soft); color: var(--signal); border-color: var(--signal); }
.badge-open   { background: var(--accent-soft); color: var(--signal); border-color: var(--signal); }
.badge-closed { background: var(--red-bg); color: var(--red); border-color: var(--red); }
.badge-local  { background: var(--local-bg); color: var(--local); border-color: var(--local); }
.badge-green  { background: var(--green-bg); color: var(--green); border-color: var(--green); }
.badge-mycel  { background: var(--yellow-bg); color: #8a5a00; border-color: #b8860b; }
.badge-cluster { background: var(--yellow-bg); color: #7a5200; border-color: #b8860b; }
.badge-neutral { background: var(--surface); color: var(--text-2); border-color: var(--border-strong); }
.badge-pending { background: transparent; color: var(--muted); border-color: var(--border-strong); border-style: dashed; }

/* ── Front-Door Model Explorer ──────────────────────────────────────────── */
.explorer-buckets {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 1.15rem;
}

.explorer-bucket {
  background: var(--paper);
  border: 1px solid var(--ink);
  border-top-width: 3px;
  padding: 0.9rem 1rem;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
}

.explorer-bucket:hover {
  background: var(--surface-raised);
  transform: translateY(-1px);
  box-shadow: 4px 4px 0 rgba(26, 26, 26, 0.08);
}

.explorer-bucket.is-active {
  background: var(--surface-raised);
  box-shadow: 5px 5px 0 rgba(0, 85, 170, 0.14);
  outline: 2px solid var(--signal);
  outline-offset: -2px;
}

.explorer-bucket.bucket-laptop { border-top-color: var(--local); }
.explorer-bucket.bucket-cluster { border-top-color: var(--green); }
.explorer-bucket.bucket-fable { border-top-color: var(--signal); }
.explorer-bucket.bucket-workhorse { border-top-color: var(--ink); }

.bucket-kicker {
  font-family: var(--mono);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}

.bucket-count {
  font-family: var(--serif);
  font-size: 1.75rem;
  font-weight: 900;
  line-height: 1.1;
  color: var(--text-strong);
}

.bucket-desc {
  font-size: 0.78rem;
  line-height: 1.38;
  color: var(--text-2);
}

.explorer-detail {
  background: var(--surface-raised);
  border: 1px solid var(--ink);
  border-left: 3px solid var(--signal);
  padding: 1.15rem 1.25rem;
  margin-bottom: 1.25rem;
}

.explorer-detail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--border);
}

.explorer-detail-title {
  font-family: var(--sans);
  font-size: 1.18rem;
  font-weight: 800;
  color: var(--ink);
  letter-spacing: -0.01em;
}

.explorer-detail-sub {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--muted);
  margin-top: 0.25rem;
}

.explorer-detail-specs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border);
}

.explorer-spec-cell span {
  display: block;
  font-family: var(--mono);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.explorer-spec-cell strong {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  color: var(--text-strong);
}

.explorer-detail-body {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.2fr);
  gap: 1.15rem;
  padding-top: 0.85rem;
}

.explorer-targets-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.explorer-target-row {
  background: var(--paper);
  border: 1px solid var(--border-strong);
  padding: 0.5rem 0.65rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.explorer-target-spec {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-strong);
}

.explorer-target-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
}

.cmd-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cmd-row {
  background: var(--paper);
  border: 1px solid var(--border-strong);
  padding: 0.45rem 0.6rem;
}

.cmd-row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.cmd-row-label {
  font-family: var(--mono);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.cmd-row code {
  display: block;
  font-size: 0.74rem;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--surface);
  padding: 0.3rem 0.45rem;
}

.explorer-lane {
  margin-top: 1.35rem;
}

.explorer-lane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding-bottom: 0.5rem;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--ink);
}

.explorer-lane-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-family: var(--sans);
  font-size: 1rem;
  font-weight: 800;
  color: var(--ink);
}

.explorer-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
}

.explorer-card {
  background: var(--paper);
  border: 1px solid var(--border-strong);
  border-left-width: 3px;
  padding: 0.9rem 1rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  text-align: left;
  transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}

.explorer-card.lane-laptop { border-left-color: var(--local); }
.explorer-card.lane-cluster { border-left-color: var(--green); }
.explorer-card.lane-fable { border-left-color: var(--signal); }
.explorer-card.lane-workhorse { border-left-color: var(--ink); }

.explorer-card:hover {
  border-color: var(--ink);
  background: var(--surface-raised);
  transform: translateY(-1px);
  box-shadow: 4px 4px 0 rgba(26, 26, 26, 0.08);
}

.explorer-card.is-selected {
  border-color: var(--signal);
  background: var(--surface-raised);
  outline: 1.5px solid var(--signal);
  box-shadow: 5px 5px 0 rgba(0, 85, 170, 0.14);
}

.explorer-card-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}

.explorer-card-lab {
  font-family: var(--mono);
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--muted);
}

.explorer-card-name {
  font-family: var(--font-mono);
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text-strong);
  line-height: 1.25;
}

.explorer-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.explorer-card-specs {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-2);
}

.explorer-card-runtimes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.runtime-chip {
  font-family: var(--font-mono);
  font-size: 0.66rem;
  padding: 0.12rem 0.38rem;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  color: var(--text-strong);
}

.explorer-card-tagline {
  font-size: 0.79rem;
  line-height: 1.42;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── Findings / Dispatches Grid (_labs-shared.css) ──────────────────────── */
.finding-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.25rem;
  margin: 1.75rem 0 0.5rem;
}

.finding-card {
  background: var(--paper);
  border: 1px solid var(--ink);
  padding: 1.4rem 1.45rem;
  display: flex;
  flex-direction: column;
}

.finding-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.55rem;
}

.finding-card .f-num {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-red);
  font-weight: 700;
}

.finding-card .f-date {
  font-family: var(--font-mono);
  font-size: 0.67rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-soft);
}

.finding-card h4 {
  font-family: var(--sans);
  font-size: 0.98rem;
  font-weight: 700;
  line-height: 1.3;
  margin: 0 0 0.55rem;
  color: var(--ink);
}

.finding-card p {
  font-size: 0.86rem;
  line-height: 1.58;
  color: var(--ink-light);
  margin: 0;
}

/* ── Drafting Bento & QuarterItemCard (QuarterItemCard.astro) ───────────── */
.drafting-bento {
  background-image: radial-gradient(circle, var(--drafting-dot) 1px, transparent 1px);
  background-size: 16px 16px;
  padding: 1.5rem;
  border: 1px solid var(--border-strong);
  margin-top: 1.5rem;
}

.example-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.25rem;
}

.item-card {
  background: var(--surface-raised);
  border: 1px solid var(--ink);
  padding: 1.4rem 1.45rem 1.35rem;
  text-decoration: none;
  color: inherit;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: background 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.item-card:hover {
  background: var(--paper);
  color: inherit;
  box-shadow: 6px 6px 0px 0px rgba(26, 26, 26, 0.10);
  transform: translate(-1px, -1px);
}

.item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 0.75rem;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 0.65rem;
}

.item-kind {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--signal);
  font-weight: 600;
}

.telemetry-bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 10px;
}

.telemetry-bars i {
  display: block;
  width: 2px;
  background: var(--signal);
  transition: height 180ms ease;
}

.telemetry-bars i:nth-child(1) { height: 5px; }
.telemetry-bars i:nth-child(2) { height: 9px; }
.telemetry-bars i:nth-child(3) { height: 6px; }
.item-card:hover .telemetry-bars i:nth-child(1) { height: 9px; }
.item-card:hover .telemetry-bars i:nth-child(3) { height: 10px; }

.item-card h3 {
  font-family: var(--display-card);
  font-size: 19.5px;
  font-weight: 500;
  line-height: 1.24;
  color: var(--text-strong);
  margin: 0 0 0.65rem;
}

.item-prompt-preview {
  font-family: var(--serif);
  font-style: italic;
  font-size: 13.5px;
  line-height: 1.48;
  color: var(--text-2);
  background: var(--canvas);
  border-left: 2px solid var(--signal);
  padding: 0.45rem 0.65rem;
  margin-bottom: 0.85rem;
}

.item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--muted);
}

.item-footer > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.item-cta {
  color: var(--signal);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Prompt-First Example Page Components ───────────────────────────────── */
.prompt-sheet {
  margin: 2.25rem 0 2rem;
  background: var(--surface-raised);
  border: 1px solid var(--ink);
  border-left: 4px solid var(--signal);
  box-shadow: 8px 8px 0px 0px rgba(26, 26, 26, 0.08);
  padding: 1.65rem 2rem 1.75rem;
}

.prompt-sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid var(--border);
}

.prompt-sheet-kicker {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-red);
  font-weight: 700;
}

.prompt-sheet blockquote {
  font-family: var(--serif);
  font-size: 1.24rem;
  line-height: 1.52;
  color: var(--text-strong);
  margin: 0;
}

.prompt-sheet-foot {
  margin-top: 1.15rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--muted);
}

/* Warm raised-paper code sheet (ArticleLayout.astro pre) */
.code-sheet {
  margin: 1.25rem 0 2rem;
  border: 1px solid var(--ink);
  background: var(--surface-raised);
}

.code-sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.55rem 1rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border-strong);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-strong);
}

.code-sheet-path {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 600;
}

.code-sheet pre {
  margin: 0;
  padding: 1.15rem 1.25rem;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12.8px;
  line-height: 1.58;
  color: var(--text-strong);
  background: var(--surface-raised);
}

.code-sheet pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: inherit;
}

.code-ln {
  display: inline-block;
  width: 2.3rem;
  user-select: none;
  color: var(--muted-soft);
  opacity: 0.65;
  text-align: right;
  padding-right: 0.9rem;
}

.tok-kw  { color: #0055aa; font-weight: 600; }
.tok-str { color: #0e6b3f; }
.tok-cmt { color: #7b7669; font-style: italic; }
.tok-num { color: #c2492a; }

.output-sheet {
  margin: 1.25rem 0 2rem;
  border: 1px solid var(--ink);
  border-left: 3px solid var(--green);
  background: var(--paper);
}

.output-sheet-head {
  padding: 0.5rem 1rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 0.69rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--green);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.output-sheet pre {
  margin: 0;
  padding: 1.1rem 1.25rem;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-strong);
}

/* Prev / Next pagination row */
.prev-next-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
  margin-top: 2.5rem;
  padding-top: 2rem;
  border-top: 2px solid var(--ink);
}

/* ── Department Switcher (DepartmentSeriesPage.astro) ───────────────────── */
.dept-switcher {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 1.5rem 0 1.25rem;
  border-bottom: 1px solid var(--border-strong);
  margin-bottom: 1.5rem;
}

.dept-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.38rem 0.76rem;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--text-2);
  text-decoration: none;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.dept-pill:hover {
  border-color: var(--signal);
  color: var(--text-strong);
}

.dept-pill.is-active {
  background: var(--text-strong);
  color: var(--canvas);
  border-color: var(--text-strong);
}

.dept-pill-count {
  opacity: 0.72;
  font-size: 10px;
}

/* ── Local Concurrency Bars ─────────────────────────────────────────────── */
.scale-bars {
  display: grid;
  gap: 0.9rem;
  margin: 1.5rem 0 2rem;
}

.scale-row {
  background: var(--paper);
  border: 1px solid var(--ink);
  padding: 1rem 1.25rem;
  display: grid;
  grid-template-columns: 240px 1fr 110px;
  gap: 1.25rem;
  align-items: center;
}

.scale-track-group {
  display: grid;
  gap: 0.35rem;
}

.scale-track-line {
  display: grid;
  grid-template-columns: 44px 1fr 86px;
  gap: 0.5rem;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 11px;
}

.scale-bar-bg {
  height: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  position: relative;
}

.scale-bar-fill {
  height: 100%;
  background: var(--signal);
}

.scale-bar-fill.is-queue {
  background: var(--accent-red);
}

/* ── Coding Benchmark Matrix & Fixture Strip ────────────────────────────── */
.badge-mock {
  background: var(--yellow-bg);
  color: var(--yellow);
  border: 1px solid rgba(184, 134, 11, 0.35);
}

.badge-live {
  background: var(--green-bg);
  color: var(--green);
  border: 1px solid rgba(14, 107, 63, 0.35);
}

.coding-task-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.55rem;
  margin: 0.9rem 0 1.1rem;
}

.coding-task-pill {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  padding: 0.55rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.coding-task-pill-id {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--ink);
}

.coding-task-pill-title {
  font-size: 11.5px;
  color: var(--text-2);
  line-height: 1.3;
}

.coding-task-pill-meta {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 0.2rem;
}

.diff-pill {
  font-family: var(--mono);
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.08rem 0.32rem;
  border: 1px solid var(--border);
  background: var(--paper);
}

.diff-pill.diff-easy { color: var(--green); border-color: rgba(14, 107, 63, 0.35); }
.diff-pill.diff-medium { color: var(--yellow); border-color: rgba(184, 134, 11, 0.35); }
.diff-pill.diff-hard { color: var(--red); border-color: rgba(217, 48, 37, 0.35); }

.coding-cell-chip {
  display: inline-block;
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 0.14rem 0.38rem;
  border: 1px solid var(--border);
  min-width: 2.3rem;
  text-align: center;
}

.coding-cell-chip.is-pass {
  background: var(--green-bg);
  border-color: rgba(14, 107, 63, 0.35);
  color: var(--green);
}

.coding-cell-chip.is-partial {
  background: var(--yellow-bg);
  border-color: rgba(184, 134, 11, 0.35);
  color: var(--yellow);
}

.coding-cell-chip.is-fail {
  background: var(--red-bg);
  border-color: rgba(217, 48, 37, 0.35);
  color: var(--red);
}

/* ── Footer (.site-footer from ../labs) ─────────────────────────────────── */
.site-footer {
  border-top: 1px solid var(--border-strong);
  background: var(--canvas);
  margin-top: 4.5rem;
}

.site-footer-inner {
  max-width: var(--container-max);
  margin: 0 auto;
  padding: 2rem var(--gutter);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 2rem;
  flex-wrap: wrap;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(26, 26, 26, 0.65);
}

.site-footer-inner a {
  color: inherit;
  text-decoration: none;
}

.site-footer-inner a:hover {
  color: var(--signal);
}

/* ── Responsive ─────────────────────────────────────────────────────────── */
@media (max-width: 960px) {
  .stats-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .explorer-buckets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .explorer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .explorer-detail-specs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .explorer-detail-body { grid-template-columns: 1fr; }
  .coding-task-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .finding-grid, .example-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pareto-inspector { grid-template-columns: 1fr; }
  .scale-row { grid-template-columns: 1fr; }
}

@media (max-width: 680px) {
  :root { --gutter: 18px; }
  .explorer-buckets, .explorer-grid { grid-template-columns: 1fr; }
  .coding-task-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .explorer-detail-specs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .finding-grid, .example-grid, .prev-next-grid { grid-template-columns: 1fr; }
  .inspector-bars { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .model-picks li { grid-template-columns: 1fr; gap: 0.15rem; }
  .pick-name { white-space: normal; }
  .storyline-title { display: none; }
}

/* ── Navigation Deck Highlight ─────────────────────────────────────────── */
.site-nav-deck {
  border: 1px solid var(--signal);
  background: var(--accent-soft);
  color: var(--signal) !important;
  padding: 0.28rem 0.62rem !important;
  letter-spacing: 0.1em;
}

.site-nav-deck:hover {
  background: var(--signal);
  color: #ffffff !important;
}

/* ── Front-Door Ecosystem Strip & Presentation Banner ──────────────────── */
.portal-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.9rem;
  margin: 0 0 2.5rem;
}

.portal-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 0.65rem;
  background: var(--surface-raised);
  border: 1px solid var(--ink);
  border-top: 3px solid var(--signal);
  padding: 1.15rem 1.25rem;
  text-decoration: none;
  color: inherit;
  transition: background 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.portal-card:hover {
  background: var(--paper);
  color: inherit;
  transform: translate(-1px, -1px);
  box-shadow: 5px 5px 0 rgba(26, 26, 26, 0.09);
}

.portal-card.is-void {
  background: var(--void);
  color: var(--canvas);
  border-color: var(--void);
  border-top-color: var(--accent-warm);
}

.portal-card.is-void:hover {
  background: #24231e;
  color: var(--canvas);
}

.portal-kicker {
  font-family: var(--mono);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--signal);
}

.portal-card.is-void .portal-kicker {
  color: #f3c677;
}

.portal-card h3 {
  font-family: var(--display-card);
  font-size: 1.18rem;
  font-weight: 500;
  line-height: 1.22;
}

.portal-card p {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-2);
}

.portal-card.is-void p {
  color: rgba(243, 242, 234, 0.78);
}

.portal-cta {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--signal);
  margin-top: auto;
  padding-top: 0.35rem;
}

.portal-card.is-void .portal-cta {
  color: #8cc4ff;
}

.deck-feature-banner {
  display: grid;
  grid-template-columns: 320px 1fr;
  border: 1px solid var(--ink);
  background: var(--surface-raised);
  box-shadow: 7px 7px 0 rgba(26, 26, 26, 0.08);
  margin: 1.75rem 0 2.5rem;
}

.deck-preview-pane {
  background: var(--void);
  color: var(--canvas);
  padding: 1.4rem 1.5rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border-right: 1px solid var(--ink);
}

.deck-preview-kicker {
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #f3c677;
}

.deck-preview-title {
  font-family: var(--serif);
  font-size: 1.45rem;
  font-weight: 700;
  line-height: 1.18;
  margin: 0.75rem 0;
}

.deck-preview-slides {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.deck-preview-slides span {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 0.15rem 0.4rem;
  border: 1px solid rgba(243, 242, 234, 0.25);
  color: rgba(243, 242, 234, 0.85);
}

.deck-feature-body {
  padding: 1.45rem 1.65rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1rem;
}

.deck-feature-body h3 {
  font-family: var(--sans);
  font-size: 1.25rem;
  font-weight: 900;
  letter-spacing: -0.015em;
  color: var(--ink);
}

.deck-feature-body p {
  font-size: 0.92rem;
  line-height: 1.58;
  color: var(--ink-light);
  max-width: 62ch;
}

.deck-feature-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* ── Prompt-First Labs Pages ───────────────────────────────────────────── */
.lab-anchors {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 1rem;
}

.lab-anchor-chip {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 0.22rem 0.55rem;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  color: var(--signal);
  text-decoration: none;
}

.lab-anchor-chip:hover {
  border-color: var(--signal);
  background: var(--paper);
}

.lab-article {
  max-width: 920px;
  padding: 1.25rem 0 2rem;
}

.lab-section-heading {
  font-family: var(--sans);
  font-size: 1.42rem;
  font-weight: 900;
  letter-spacing: -0.015em;
  color: var(--ink);
  margin: 2.5rem 0 0.85rem;
  padding-top: 1.75rem;
  border-top: 1px solid var(--border-strong);
}

.lab-section-heading:first-child {
  margin-top: 0.5rem;
  padding-top: 0.75rem;
}

.lab-sec-num {
  font-family: var(--mono);
  color: var(--accent-red);
  margin-right: 0.25rem;
}

.lab-sub-heading {
  font-family: var(--sans);
  font-size: 1.04rem;
  font-weight: 700;
  color: var(--ink);
  margin: 1.5rem 0 0.5rem;
}

.lab-list,
.lab-checklist {
  margin: 0.5rem 0 1.25rem 1.25rem;
  display: grid;
  gap: 0.5rem;
  color: var(--ink-light);
}

.lab-checklist {
  list-style: none;
  margin-left: 0;
}

.lab-checklist li {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  padding: 0.55rem 0.8rem;
}

.lab-check-box {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-top: 3px;
  border: 1px solid var(--ink);
  background: var(--paper);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--green);
  flex-shrink: 0;
}

.lab-steps {
  margin: 0.75rem 0 1.35rem 1.35rem;
  display: grid;
  gap: 0.85rem;
  color: var(--ink-light);
}

.lab-step-head {
  color: var(--text-strong);
}

.lab-sublist {
  margin: 0.35rem 0 0 1.15rem;
  display: grid;
  gap: 0.3rem;
  font-size: 0.94rem;
}

.lab-callout {
  margin: 0.75rem 0 1.1rem;
  padding: 0.75rem 1rem;
  background: var(--accent-soft);
  border-left: 3px solid var(--signal);
  font-size: 0.92rem;
  color: var(--text-strong);
}

.lab-diagram-card {
  margin: 1.25rem 0 1.5rem;
  border: 1px solid var(--ink);
  background: var(--paper);
}

.lab-diagram-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-2);
}

.lab-kind-tag {
  color: var(--signal);
}

.lab-diagram-body {
  padding: 1.25rem;
  overflow-x: auto;
  text-align: center;
}

.lab-diagram-body pre.mermaid {
  margin: 0;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 12px;
}

.lab-wireframe {
  margin: 1.25rem 0 1.5rem;
  border: 1px solid var(--ink);
  background: #141310;
  color: #f3f2ea;
}

.lab-wireframe-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.48rem 1rem;
  background: #22201c;
  border-bottom: 1px solid rgba(243, 242, 234, 0.18);
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #f3c677;
}

.lab-wireframe pre {
  margin: 0;
  padding: 1.05rem 1.2rem;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12.2px;
  line-height: 1.48;
  color: #f3f2ea;
}

.lab-prompt-sheet {
  margin: 1.1rem 0 1.6rem;
}

.lab-prompt-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-strong);
}

.copy-btn-sm {
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.22rem 0.55rem;
  border: 1px solid var(--ink);
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}

.copy-btn-sm:hover {
  background: var(--signal);
  border-color: var(--signal);
  color: #ffffff;
}

@media (max-width: 960px) {
  .portal-strip { grid-template-columns: 1fr; }
  .deck-feature-banner { grid-template-columns: 1fr; }
  .deck-preview-pane { border-right: none; border-bottom: 1px solid var(--ink); }
}
`;
