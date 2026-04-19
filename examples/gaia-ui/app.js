/* ═══════════════════════════════════════════════════════════
   Gaia v2 — app.js
   Preserves API contracts from v1: /api/habitat, /api/sessions,
   /api/sessions/:id/messages, /api/sessions/:id/beats, /api/chat (SSE)
   ═══════════════════════════════════════════════════════════ */

// ── API layer ────────────────────────────────────────────
const IS_SERVED = window.location.protocol === 'http:' || window.location.protocol === 'https:';
const API_BASE = IS_SERVED ? '' : null;

async function apiFetch(path) {
  if (API_BASE === null) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Mock data (same shape as v1) ─────────────────────────
const MOCK_HABITAT = {
  name: 'Jeeves',
  provider: 'google',
  model: 'gemini-2.5-flash-preview',
  agents: [
    { id: 'twitter-feed', name: 'twitter-feed', path: '../twitter-feed', status: 'online', gitRemote: 'git@github.com:user/twitter-feed.git', commands: ['start', 'stop', 'restart'], logPatterns: ['logs/*.log'], statusFile: '.status.json' },
    { id: 'newsletter-feed', name: 'newsletter-feed', path: '../newsletter-feed', status: 'idle', gitRemote: 'git@github.com:user/newsletter-feed.git', commands: ['start', 'stop'], logPatterns: ['logs/*.log'] },
    { id: 'trmnl-image', name: 'trmnl-image', path: '../trmnl-image', status: 'offline', gitRemote: null, commands: ['generate'], logPatterns: [] }
  ],
  tools: [
    'read', 'write', 'list', 'ripgrep', 'current_time', 'wget', 'markify',
    'parse_feed', 'agent_list', 'agent_add', 'agent_update', 'agent_remove',
    'session_list', 'session_show', 'session_messages', 'session_stats',
    'agent_clone', 'agent_logs', 'agent_status', 'agent_ask',
    'interaction_list', 'interaction_show'
  ],
  skills: [
    { name: '/summarize', description: 'Summarize recent agent activity' },
    { name: '/digest', description: 'Generate a daily digest from all feeds' },
    { name: '/health', description: 'Check system health and agent status' }
  ],
  stimulus: `You are Jeeves, a personal digital butler managing a constellation of specialized agents.

Your primary responsibilities:
— Monitor and coordinate sub-agents (twitter-feed, newsletter-feed, trmnl-image)
— Respond to user queries about agent status and collected data
— Generate daily digests combining information from all feeds
— Maintain a calm, competent demeanor befitting a proper butler`,
  memoryFiles: ['memories.md', 'facts.md', 'daily-log.md']
};

const MOCK_SESSIONS = {
  'twitter-feed': [
    { sessionId: 'ses-tf-001', type: 'cli', created: '2025-01-15T09:23:00Z', lastUsed: '2025-01-15T10:45:00Z', preview: 'Show me the status of all agents', messageCount: 14 },
    { sessionId: 'ses-tf-002', type: 'telegram', created: '2025-01-15T14:10:00Z', lastUsed: '2025-01-15T14:32:00Z', preview: 'What did the twitter feed find today?', messageCount: 8 },
  ],
  'newsletter-feed': [
    { sessionId: 'ses-nf-001', type: 'cli', created: '2025-01-15T11:00:00Z', lastUsed: '2025-01-15T11:30:00Z', preview: 'Find recent papers on mixture of experts', messageCount: 10 },
    { sessionId: 'ses-nf-002', type: 'web', created: '2025-01-14T16:00:00Z', lastUsed: '2025-01-14T16:20:00Z', preview: 'Summarize the attention mechanism paper', messageCount: 6 }
  ],
  'trmnl-image': [
    { sessionId: 'ses-ti-001', type: 'cli', created: '2025-01-15T07:00:00Z', lastUsed: '2025-01-15T07:45:00Z', preview: 'Generate dashboard image', messageCount: 12 },
    { sessionId: 'ses-ti-002', type: 'api', created: '2025-01-15T06:00:00Z', lastUsed: '2025-01-15T06:02:00Z', preview: '{"action":"generate_image"}', messageCount: 4 }
  ]
};

const MOCK_SESSION_MESSAGES = {
  'ses-tf-001': [
    { role: 'system', content: 'Habitat session started. Type: cli. Agent: Jeeves.' },
    { role: 'user', content: 'Show me the status of all agents' },
    {
      role: 'assistant',
      content: 'Let me check on all your agents right away.',
      toolCalls: [
        { name: 'agent_status', input: '{\n  "agent_id": "twitter-feed"\n}', output: '{\n  "id": "twitter-feed",\n  "status": "running",\n  "uptime": "4h 23m",\n  "stats": {\n    "tweetsProcessed": 142,\n    "matchesFound": 7\n  }\n}' },
        { name: 'agent_status', input: '{\n  "agent_id": "newsletter-feed"\n}', output: '{\n  "id": "newsletter-feed",\n  "status": "idle",\n  "uptime": "12h 05m"\n}' },
        { name: 'agent_status', input: '{\n  "agent_id": "trmnl-image"\n}', output: '{\n  "id": "trmnl-image",\n  "status": "stopped",\n  "error": "API rate limit exceeded"\n}' }
      ]
    },
    {
      role: 'assistant',
      content: 'Here is the current status of your agents, sir:\n\n**twitter-feed** — **Running**\n- Uptime: 4h 23m\n- Processed **142 tweets** today, found **7 matches**\n- No errors in the last 24 hours\n\n**newsletter-feed** — **Idle**\n- Uptime: 12h 05m\n- Next scheduled run: 6:00 PM\n\n**trmnl-image** — **Stopped**\n- Error: `API rate limit exceeded`\n\n> I recommend restarting the trmnl-image agent after the rate limit resets.'
    },
    { role: 'user', content: 'Can you get the latest logs from twitter-feed?' },
    {
      role: 'assistant',
      content: 'Of course. Let me fetch the recent logs.',
      toolCalls: [
        { name: 'agent_logs', input: '{\n  "agent_id": "twitter-feed",\n  "lines": 20\n}', output: '{"ts":"09:18:42","level":"info","msg":"Processing batch 47"}\n{"ts":"09:18:43","level":"info","msg":"Match found","query":"AI agents"}\n{"ts":"09:20:12","level":"info","msg":"Batch complete","total":142,"matches":7}' }
      ]
    },
    {
      role: 'assistant',
      content: 'The agent is running smoothly. In the most recent batches:\n\n- **09:18:42** — Processed batch 47 (5 tweets)\n- **09:18:43** — Match found for `AI agents`\n- **09:20:12** — Batch complete: **142 total**, **7 matches**\n\nAll nominal. No warnings or errors.'
    }
  ]
};

const SESSION_BEATS = {
  'ses-tf-001': [
    { title: 'Checked status of all 3 agents', topic: 'status', msgIndex: 1, tools: ['agent_status'], tags: ['monitoring'], time: '09:23' },
    { title: 'Reported: 1 running, 1 idle, 1 stopped with rate-limit error', topic: 'status', msgIndex: 3, tags: ['issue'], time: '09:24' },
    { title: 'Fetched twitter-feed logs — batch processing nominal', topic: 'logs', msgIndex: 4, tools: ['agent_logs'], tags: ['logs'], time: '09:31' },
    { title: 'Summarized recent batch activity and match results', topic: 'summary', msgIndex: 6, tags: ['digest'], time: '09:42' }
  ],
  'ses-tf-002': [
    { title: 'Asked about twitter feed findings today', topic: 'delegation', msgIndex: 1, tags: ['twitter'], time: '14:10' },
    { title: 'Reviewed AI-agent architecture tweets', topic: 'digest', msgIndex: 2, tags: ['AI agents'], time: '14:15' }
  ],
  'ses-nf-001': [
    { title: 'Searched for MoE papers', topic: 'research', msgIndex: 1, tools: ['parse_feed'], tags: ['papers'], time: '11:00' },
    { title: 'Returned 3 papers + summaries', topic: 'summary', msgIndex: 3, tags: ['research'], time: '11:28' }
  ]
};

const SESSION_GLYPHS = {
  cli: '$',
  telegram: '✈',
  discord: '⌬',
  web: '⦿',
  api: '⌘',
  file: '⊡'
};

// ── State ────────────────────────────────────────────────
const state = {
  habitat: null,
  agents: [],
  selectedAgent: null,
  selectedSession: null,
  gaiaMessages: [],
  sessionChatMessages: {},
  isLive: false,
  tweaks: {
    palette: localStorage.getItem('gaia.palette') || 'ink',
    layout: localStorage.getItem('gaia.layout') || 'columns',
    sidebar: localStorage.getItem('gaia.sidebar') || 'nested',
    accent: localStorage.getItem('gaia.accent') || 'default'
  },
  tweaksOpen: false
};

// ── Utilities ────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff/60)}m`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d`;
  return d.toISOString().slice(0, 10);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function simpleMarkdown(text) {
  if (!text) return '';
  let t = escapeHtml(text);
  // code spans
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // blockquotes
  t = t.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // bullets
  t = t.replace(/^[\-•] (.+)$/gm, '<li>$1</li>');
  t = t.replace(/(<li>[\s\S]+?<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
  // paragraphs — double newlines → split
  const blocks = t.split(/\n{2,}/);
  return blocks.map(b => {
    if (b.match(/^<(ul|ol|blockquote|pre|h\d)/)) return b;
    return `<p>${b.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function getAgent(id) { return state.agents.find(a => a.id === id); }
function getAgentSessions(id) { const a = getAgent(id); return a ? (a.sessions || []) : []; }

// ── Sidebar ──────────────────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('sidebar-list');
  const count = document.getElementById('sidebar-count');
  count.textContent = String(state.agents.length).padStart(2, '0');

  let html = '';
  for (const agent of state.agents) {
    const isActive = state.selectedAgent === agent.id;
    const sessions = agent.sessions || [];
    html += `
      <div class="agent-row ${isActive ? 'active' : ''}" data-action="select-agent" data-agent-id="${agent.id}">
        <span class="status ${agent.status || 'online'}"></span>
        <span class="name">${escapeHtml(agent.name)}</span>
        <span class="num">${String(sessions.length).padStart(2, '0')}</span>
      </div>
      <div class="agent-path">${escapeHtml(agent.path || '')}</div>
      <div class="session-list ${isActive ? 'open' : ''}">
        ${sessions.map((s, i) => `
          <div class="session-row ${isActive && state.selectedSession === i ? 'active' : ''}"
               data-action="select-session" data-agent-id="${agent.id}" data-index="${i}">
            <div>
              <span class="glyph">${SESSION_GLYPHS[s.type] || '·'}</span>
              <span class="preview">${escapeHtml(s.preview || s.sessionId)}</span>
            </div>
            <div class="meta">
              <span>${formatTime(s.lastUsed)}</span>
              <span>${s.messageCount || 0} msgs</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
  list.innerHTML = html;
}

// ── Topbar ───────────────────────────────────────────────
function renderTopbar() {
  const crumbs = document.getElementById('crumbs');
  const hName = state.habitat?.name || 'Habitat';
  let html = `<span class="crumb" data-action="go-home">${escapeHtml(hName)}</span>`;
  if (state.selectedAgent) {
    const agent = getAgent(state.selectedAgent);
    const sep = `<span class="sep">/</span>`;
    html += `${sep}<span class="crumb ${state.selectedSession == null ? 'current' : ''}" data-action="select-agent" data-agent-id="${state.selectedAgent}">${escapeHtml(agent?.name || '')}</span>`;
    if (state.selectedSession != null) {
      const session = getAgentSessions(state.selectedAgent)[state.selectedSession];
      html += `${sep}<span class="crumb current">${session?.sessionId || ''}</span>`;
    }
  }
  crumbs.innerHTML = html;
}

// ── Dashboard (habitat overview) ─────────────────────────
function renderDashboard() {
  const view = document.getElementById('dashboard');
  const h = state.habitat;
  const totalSessions = state.agents.reduce((s, a) => s + (a.sessions?.length || 0), 0);
  const totalMsgs = state.agents.reduce((s, a) => s + (a.sessions || []).reduce((ss, x) => ss + (x.messageCount || 0), 0), 0);

  // Agent table
  const agentsHtml = state.agents.map((agent, i) => `
    <div class="trow" data-action="select-agent" data-agent-id="${agent.id}">
      <div class="tcell c-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="tcell c-status"><span class="dot ${agent.status || 'online'}"></span></div>
      <div class="tcell c-name">${escapeHtml(agent.name)}</div>
      <div class="tcell c-path">${escapeHtml(agent.path || '')}</div>
      <div class="tcell c-sessions"><span class="n">${(agent.sessions || []).length}</span> sessions</div>
      <div class="tcell c-arrow">→</div>
    </div>
  `).join('');

  // Right column: habitat metadata
  const toolsChips = (h?.tools || []).map(t =>
    `<span class="chip">${escapeHtml(typeof t === 'string' ? t : t.name || '')}</span>`
  ).join('');

  const skillsHtml = (h?.skills || []).map(s => `
    <div class="skill-item">
      <div class="skill-name">${escapeHtml(s.name)}</div>
      <div class="skill-desc">${escapeHtml(s.description || '')}</div>
    </div>
  `).join('');

  const filesHtml = (h?.memoryFiles || []).map(f => `
    <div class="file-item">
      <span class="glyph">◈</span>
      <span>${escapeHtml(typeof f === 'string' ? f : f.name || '')}</span>
    </div>
  `).join('');

  view.innerHTML = `
    <div class="hero">
      <div class="tag-row">
        <div class="left">
          <span>HABITAT · <strong>${escapeHtml(h?.name || '')}</strong></span>
        </div>
        <div class="right">
          <span>PROVIDER <strong>${escapeHtml(h?.provider || '—')}</strong></span>
          <span>MODEL <strong>${escapeHtml(h?.model || '—')}</strong></span>
        </div>
      </div>
      <h1>${escapeHtml(h?.name || 'Habitat')}</h1>
      <div class="hero-sub">
        <div class="stat"><span class="val">${state.agents.length}</span><span class="lbl">Agents</span></div>
        <div class="stat"><span class="val">${totalSessions}</span><span class="lbl">Sessions</span></div>
        <div class="stat"><span class="val">${totalMsgs}</span><span class="lbl">Messages</span></div>
        <div class="stat"><span class="val">${(h?.tools || []).length}</span><span class="lbl">Tools</span></div>
        <div class="stat"><span class="val">${(h?.skills || []).length}</span><span class="lbl">Skills</span></div>
      </div>
    </div>

    <div class="dash-body">
      <div class="dash-col">
        <div class="section">
          <div class="section-head">
            <span class="label">Agents</span>
            <span class="count">${state.agents.length} total</span>
          </div>
          <div class="agent-table">${agentsHtml}</div>
        </div>

        <div class="section">
          <div class="section-head">
            <span class="label">Stimulus</span>
            <span class="count">${(h?.stimulus || '').length} chars</span>
          </div>
          <pre class="stimulus">${escapeHtml(h?.stimulus || '')}</pre>
        </div>
      </div>

      <div class="dash-col">
        <div class="section">
          <div class="section-head">
            <span class="label">Tools</span>
            <span class="count">${(h?.tools || []).length}</span>
          </div>
          <div class="chips">${toolsChips}</div>
        </div>

        ${skillsHtml ? `
        <div class="section">
          <div class="section-head">
            <span class="label">Skills</span>
            <span class="count">${(h?.skills || []).length}</span>
          </div>
          <div class="skill-list">${skillsHtml}</div>
        </div>` : ''}

        ${filesHtml ? `
        <div class="section">
          <div class="section-head">
            <span class="label">Memory</span>
            <span class="count">${(h?.memoryFiles || []).length} files</span>
          </div>
          <div class="file-list">${filesHtml}</div>
        </div>` : ''}
      </div>
    </div>
  `;
}

// ── Agent detail (tabs: artifact / sessions / beats / info) ──
async function renderAgentDetail() {
  const view = document.getElementById('dashboard');
  const agent = getAgent(state.selectedAgent);
  if (!agent) return;
  const sessions = agent.sessions || [];
  const totalMsgs = sessions.reduce((s, x) => s + (x.messageCount || 0), 0);

  const artifacts = await loadAgentArtifacts(agent.id);
  const activeTab = state.activeAgentTab || 'artifact';

  // Tab: Artifact canvas
  let artifactPanel = '';
  if (artifacts.length === 0) {
    artifactPanel = `<div class="artifact-stack"><div class="artifact"><div class="artifact-head"><div><div class="artifact-kicker">empty</div><h2 class="artifact-title">No artifact yet</h2><div class="artifact-sub">This agent hasn't published a surface. Open a session to interact.</div></div></div></div></div>`;
  } else {
    // Hero artifact large, secondaries in right column (stats fit well there)
    const hero = artifacts[0];
    const rest = artifacts.slice(1);
    const statSecondaries = rest.filter(a => a.type === 'stats');
    const bodySecondaries = rest.filter(a => a.type !== 'stats');
    const twoCol = statSecondaries.length > 0;
    artifactPanel = `
      <div class="artifact-stack ${twoCol ? 'two-col' : ''}">
        <div class="artifact-main">
          ${renderArtifact(hero)}
          ${bodySecondaries.map(renderArtifact).join('')}
        </div>
        ${twoCol ? `<aside class="artifact-side">${statSecondaries.map(renderArtifact).join('')}</aside>` : ''}
      </div>
    `;
  }

  // Tab: Sessions
  const sessionsPanel = `
    <div style="padding:28px 32px">
      <div class="section">
        <div class="section-head">
          <span class="label">Sessions</span>
          <span class="count">${sessions.length}</span>
        </div>
        <div class="agent-table">
          ${sessions.map((s, i) => `
            <div class="trow" data-action="select-session" data-agent-id="${agent.id}" data-index="${i}">
              <div class="tcell c-num">${String(i + 1).padStart(2, '0')}</div>
              <div class="tcell c-status"><span class="dot"></span></div>
              <div class="tcell c-name" style="font-size:var(--fs-md);font-family:var(--font-mono);letter-spacing:0">${SESSION_GLYPHS[s.type] || '·'} ${escapeHtml((s.preview || s.sessionId).slice(0, 48))}</div>
              <div class="tcell c-path">${s.sessionId}</div>
              <div class="tcell c-sessions"><span class="n">${s.messageCount || 0}</span> msgs</div>
              <div class="tcell c-arrow">→</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Tab: Beats
  let beatsGroups = '';
  if (!state.isLive) {
    beatsGroups = sessions.map((s, sIdx) => {
      const beats = SESSION_BEATS[s.sessionId];
      if (!beats || beats.length === 0) return '';
      return `
        <div class="beat-session-head">
          <span class="glyph">${SESSION_GLYPHS[s.type] || '·'}</span>
          <span>${s.sessionId}</span>
          <span style="color:var(--ink-3)">·</span>
          <span>${formatTime(s.lastUsed)}</span>
        </div>
        ${beats.map(b => `
          <div class="beat-item" data-action="jump-to-beat"
               data-agent-id="${agent.id}" data-session="${sIdx}" data-msg="${b.msgIndex}">
            <div class="beat-time">${b.time || ''}</div>
            <div class="beat-body">
              <div class="beat-title">${escapeHtml(b.title)}</div>
              <div class="beat-meta">
                ${(b.tools || []).map(t => `<span class="beat-tag tool">${escapeHtml(t)}</span>`).join('')}
                ${(b.tags || []).map(t => `<span class="beat-tag">${escapeHtml(t)}</span>`).join('')}
              </div>
            </div>
            <div class="beat-arrow">→</div>
          </div>
        `).join('')}
      `;
    }).filter(Boolean).join('');
  }
  const beatsPanel = `
    <div class="beats-wrap" id="beats-container">
      ${beatsGroups ? `
        <div class="section-head" style="margin-bottom:0;border-bottom:none;padding-bottom:0">
          <span class="label">Conversation Beats</span>
          <span class="count">timeline</span>
        </div>
        <div class="beats-timeline">${beatsGroups}</div>
      ` : '<div style="color:var(--ink-3);padding:16px 0">No beats yet.</div>'}
    </div>
  `;

  // Tab: Info
  const infoPanel = `
    <div style="padding:28px 32px">
      <div class="section">
        <div class="section-head"><span class="label">Info</span></div>
        <div class="kv-block">
          <div class="kv-item"><div class="k">Path</div><div class="v mono">${escapeHtml(agent.path || '—')}</div></div>
          ${agent.gitRemote ? `<div class="kv-item"><div class="k">Git</div><div class="v mono"><a href="#">${escapeHtml(agent.gitRemote)}</a></div></div>` : ''}
          ${agent.statusFile ? `<div class="kv-item"><div class="k">Status File</div><div class="v mono">${escapeHtml(agent.statusFile)}</div></div>` : ''}
          ${(agent.logPatterns || []).length ? `<div class="kv-item"><div class="k">Logs</div><div class="v mono">${agent.logPatterns.map(escapeHtml).join('<br>')}</div></div>` : ''}
          ${(agent.commands || []).length ? `<div class="kv-item"><div class="k">Commands</div><div class="v"><div class="chips">${agent.commands.map(c => `<span class="chip accent">${escapeHtml(c)}</span>`).join('')}</div></div></div>` : ''}
        </div>
      </div>
    </div>
  `;

  view.innerHTML = `
    <div class="agent-hero">
      <div>
        <div class="meta-top">
          <span class="dot ${agent.status || 'online'}"></span>
          <span>${escapeHtml(agent.status || 'online')}</span>
          <span>·</span>
          <span>${sessions.length} sessions</span>
          <span>·</span>
          <span>${totalMsgs} messages</span>
          ${artifacts.length ? `<span>·</span><span>${artifacts.length} artifact${artifacts.length > 1 ? 's' : ''}</span>` : ''}
        </div>
        <h1>${escapeHtml(agent.name)}</h1>
        <div class="path">${escapeHtml(agent.path || '')}</div>
      </div>
      <div class="right-stats">
        <span class="n">${artifacts[0]?.updatedAt ? formatTime(artifacts[0].updatedAt) : '—'}</span>
        <span>Last update</span>
      </div>
    </div>

    <div class="agent-tabs">
      <div class="agent-tab ${activeTab === 'artifact' ? 'active' : ''}" data-action="agent-tab" data-tab="artifact">
        <span>Artifact</span><span class="tab-count">${artifacts.length}</span>
      </div>
      <div class="agent-tab ${activeTab === 'sessions' ? 'active' : ''}" data-action="agent-tab" data-tab="sessions">
        <span>Sessions</span><span class="tab-count">${sessions.length}</span>
      </div>
      <div class="agent-tab ${activeTab === 'beats' ? 'active' : ''}" data-action="agent-tab" data-tab="beats">
        <span>Beats</span>
      </div>
      <div class="agent-tab ${activeTab === 'info' ? 'active' : ''}" data-action="agent-tab" data-tab="info">
        <span>Info</span>
      </div>
    </div>

    <div class="tab-panel ${activeTab === 'artifact' ? 'active' : ''}" data-panel="artifact">${artifactPanel}</div>
    <div class="tab-panel ${activeTab === 'sessions' ? 'active' : ''}" data-panel="sessions">${sessionsPanel}</div>
    <div class="tab-panel ${activeTab === 'beats' ? 'active' : ''}" data-panel="beats">${beatsPanel}</div>
    <div class="tab-panel ${activeTab === 'info' ? 'active' : ''}" data-panel="info">${infoPanel}</div>
  `;

  if (state.isLive && activeTab === 'beats') renderLiveBeatsForAgent(agent);
}

// ── Artifact loading ─────────────────────────────────────
const artifactCache = {};
async function loadAgentArtifacts(agentId) {
  if (artifactCache[agentId]) return artifactCache[agentId];
  if (IS_SERVED) {
    const data = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/artifacts`);
    if (data?.artifacts) {
      artifactCache[agentId] = data.artifacts;
      return data.artifacts;
    }
  }
  const mock = MOCK_ARTIFACTS[agentId] || [];
  artifactCache[agentId] = mock;
  return mock;
}

// ── Session transcript ───────────────────────────────────
function renderToolCall(tc) {
  return `
    <div class="tool-call" data-action="toggle-tool">
      <div class="tool-call-header">
        <span class="chevron">▶</span>
        <span class="tool-name">${escapeHtml(tc.name)}</span>
        <span class="tool-status">${tc.is_error ? 'error' : 'completed'}</span>
      </div>
      <div class="tool-call-body">
        <div class="tool-call-section">
          <div class="lbl">Input</div>
          <pre>${escapeHtml(typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2))}</pre>
        </div>
        <div class="tool-call-section">
          <div class="lbl">Output</div>
          <pre>${escapeHtml(tc.output || '(no output)')}</pre>
        </div>
      </div>
    </div>
  `;
}

function renderMessage(msg) {
  const tools = (msg.toolCalls || []).map(renderToolCall).join('');
  const ts = msg.timestamp ? formatTime(msg.timestamp) : '';
  return `
    <div class="msg role-${msg.role}">
      <div class="msg-role">
        <span>${msg.role}</span>
        ${ts ? `<span class="role-meta">${ts}</span>` : ''}
        ${msg.model ? `<span class="role-meta">· ${escapeHtml(msg.model)}</span>` : ''}
      </div>
      ${msg.content ? `<div class="msg-content">${simpleMarkdown(msg.content)}</div>` : ''}
      ${tools}
    </div>
  `;
}

function getSessionMessages(agentId, sessionIndex) {
  const sessions = getAgentSessions(agentId);
  if (!sessions[sessionIndex]) return [];
  return MOCK_SESSION_MESSAGES[sessions[sessionIndex].sessionId] || [];
}

function renderSessionView() {
  const sessions = getAgentSessions(state.selectedAgent);
  const session = sessions[state.selectedSession];
  const agent = getAgent(state.selectedAgent);
  const messages = getSessionMessages(state.selectedAgent, state.selectedSession);
  const extraKey = `${state.selectedAgent}-${state.selectedSession}`;
  const extras = state.sessionChatMessages[extraKey] || [];

  document.getElementById('session-head-content').innerHTML = `
    <button class="back-btn" data-action="back-to-agent">← ${escapeHtml(agent?.name || '')}</button>
    <span class="type-badge"><span class="glyph">${SESSION_GLYPHS[session.type] || '·'}</span> ${escapeHtml(session.type)}</span>
    <span class="session-id">${session.sessionId}</span>
    <span class="session-info">${formatTime(session.created)} · ${messages.length + extras.length} messages</span>
  `;

  const all = [...messages, ...extras];
  const inner = document.getElementById('transcript-inner');
  inner.innerHTML = all.map(renderMessage).join('') +
    `<div class="typing" id="typing-indicator"><span></span><span></span><span></span></div>`;

  const transcript = document.getElementById('transcript');
  transcript.scrollTop = transcript.scrollHeight;
}

// ── View switching ───────────────────────────────────────
function showDashboard() {
  state.selectedAgent = null;
  state.selectedSession = null;
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('session-view').classList.add('hidden');
  document.getElementById('composer').style.display = '';
  renderDashboard();
  renderSidebar();
  renderTopbar();
  updateComposer();
}

async function showAgent(agentId, tab) {
  state.selectedAgent = agentId;
  state.selectedSession = null;
  if (tab) state.activeAgentTab = tab;
  else if (!state.activeAgentTab) state.activeAgentTab = 'artifact';
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('session-view').classList.add('hidden');
  document.getElementById('composer').style.display = '';
  await renderAgentDetail();
  renderSidebar();
  renderTopbar();
  updateComposer();
}

async function showSession(agentId, sessionIndex) {
  state.selectedAgent = agentId;
  state.selectedSession = sessionIndex;
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('session-view').classList.remove('hidden');
  document.getElementById('composer').style.display = 'none';

  if (state.isLive) await renderSessionViewLive();
  else renderSessionView();

  renderSidebar();
  renderTopbar();
}

async function jumpToBeat(agentId, sessionIndex, msgIndex) {
  state.activeAgentTab = 'artifact';
  await showSession(agentId, sessionIndex);
  setTimeout(() => {
    const el = document.querySelector(`.msg[data-msg-index="${msgIndex}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }, 60);
}

// ── Composer panel update ────────────────────────────────
function updateComposer() {
  const title = document.getElementById('composer-title');
  const input = document.getElementById('gaia-input');
  const prompt = document.getElementById('gaia-prompt');
  if (state.selectedAgent) {
    const a = getAgent(state.selectedAgent);
    const name = a ? a.name : state.selectedAgent;
    title.textContent = `Ask ${name}`;
    input.placeholder = `Chat with ${name}...`;
    prompt.textContent = `${(name || '').split(/[-_]/).pop()}>`;
  } else {
    title.textContent = 'Ask Gaia';
    input.placeholder = 'Ask about this habitat...';
    prompt.textContent = 'gaia>';
  }
}

// ── Live data ────────────────────────────────────────────
async function loadLiveData() {
  if (!IS_SERVED) return false;
  const h = await apiFetch('/api/habitat');
  if (!h) return false;
  const s = await apiFetch('/api/sessions');
  if (!s) return false;

  state.habitat = {
    name: h.name || 'Habitat',
    provider: h.provider || 'unknown',
    model: h.model || 'unknown',
    tools: h.tools || [],
    skills: (h.skills || []).map(x => ({ name: x.name, description: x.description })),
    stimulus: h.stimulus || '',
    memoryFiles: h.memoryFiles?.files || h.memoryFiles || []
  };

  const agents = (h.agents || []).map(a => ({
    id: a.id, name: a.name, path: a.projectPath, status: 'online',
    gitRemote: a.gitRemote, commands: a.commands || [],
    logPatterns: a.logPatterns || [], statusFile: a.statusFile,
    sessions: []
  }));

  const allSessions = (s.sessions || []).map(x => ({
    sessionId: x.sessionId, type: x.type || 'cli',
    created: x.created, lastUsed: x.lastUsed,
    preview: x.firstPrompt || x.sessionId,
    messageCount: x.messageCount || 0
  }));

  if (agents.length === 0) {
    agents.push({ id: 'habitat', name: state.habitat.name, path: h.workDir || '', status: 'online', sessions: allSessions });
  } else {
    agents[0].sessions = allSessions;
  }

  state.agents = agents;
  state.isLive = true;
  return true;
}

function loadMockData() {
  state.habitat = MOCK_HABITAT;
  state.agents = MOCK_HABITAT.agents.map(a => ({ ...a, sessions: MOCK_SESSIONS[a.id] || [] }));
  state.isLive = false;
}

const liveCache = {};
async function loadLiveSessionMessages(id) {
  if (!IS_SERVED) return null;
  if (liveCache[`m-${id}`]) return liveCache[`m-${id}`];
  const data = await apiFetch(`/api/sessions/${encodeURIComponent(id)}/messages`);
  if (!data?.messages) return null;
  const msgs = data.messages.map(m => {
    const o = { role: m.role, content: m.content || '', timestamp: m.timestamp, model: m.model };
    if (m.toolCalls?.length) {
      o.toolCalls = m.toolCalls.map(tc => ({
        name: tc.name,
        input: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input, null, 2),
        output: tc.output || '(no output)',
        is_error: tc.is_error
      }));
    }
    return o;
  });
  liveCache[`m-${id}`] = msgs;
  return msgs;
}

async function loadLiveSessionBeats(id) {
  if (!IS_SERVED) return null;
  if (liveCache[`b-${id}`]) return liveCache[`b-${id}`];
  const data = await apiFetch(`/api/sessions/${encodeURIComponent(id)}/beats`);
  if (!data?.beats) return null;
  liveCache[`b-${id}`] = data.beats;
  return data.beats;
}

async function renderSessionViewLive() {
  const sessions = getAgentSessions(state.selectedAgent);
  const session = sessions[state.selectedSession];
  const agent = getAgent(state.selectedAgent);
  const liveMsgs = await loadLiveSessionMessages(session.sessionId);
  const extraKey = `${state.selectedAgent}-${state.selectedSession}`;
  const extras = state.sessionChatMessages[extraKey] || [];
  const messages = liveMsgs || [];

  document.getElementById('session-head-content').innerHTML = `
    <button class="back-btn" data-action="back-to-agent">← ${escapeHtml(agent?.name || '')}</button>
    <span class="type-badge"><span class="glyph">${SESSION_GLYPHS[session.type] || '·'}</span> ${escapeHtml(session.type)}</span>
    <span class="session-id">${session.sessionId}</span>
    <span class="session-info">${formatTime(session.created)} · ${messages.length + extras.length} messages</span>
  `;

  const all = [...messages, ...extras];
  document.getElementById('transcript-inner').innerHTML =
    all.map(renderMessage).join('') +
    `<div class="typing" id="typing-indicator"><span></span><span></span><span></span></div>`;
  document.getElementById('transcript').scrollTop = 99999;
}

async function renderLiveBeatsForAgent(agent) {
  const sessions = agent.sessions || [];
  if (!sessions.length) return;
  let groups = '';
  for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
    const s = sessions[sIdx];
    const beats = await loadLiveSessionBeats(s.sessionId);
    if (!beats?.length) continue;
    groups += `
      <div class="beat-session-head">
        <span class="glyph">${SESSION_GLYPHS[s.type] || '·'}</span>
        <span>${s.sessionId.slice(0, 22)}${s.sessionId.length > 22 ? '...' : ''}</span>
        <span style="color:var(--ink-3)">·</span>
        <span>${formatTime(s.lastUsed)}</span>
      </div>
      ${beats.map(b => `
        <div class="beat-item" data-action="jump-to-beat"
             data-agent-id="${agent.id}" data-session="${sIdx}" data-msg="${b.index}">
          <div class="beat-time">#${b.index}</div>
          <div class="beat-body">
            <div class="beat-title">${escapeHtml(b.userPreview || b.topic || 'Beat')}</div>
            <div class="beat-meta">
              ${b.toolCount ? `<span class="beat-tag tool">${b.toolCount} tool${b.toolCount > 1 ? 's' : ''}</span>` : ''}
              ${b.topic ? `<span class="beat-tag">${escapeHtml(b.topic)}</span>` : ''}
            </div>
          </div>
          <div class="beat-arrow">→</div>
        </div>
      `).join('')}
    `;
  }
  const container = document.getElementById('beats-container');
  if (container && groups) {
    container.innerHTML = `
      <div class="beats-wrap">
        <div class="section-head" style="margin-bottom:0;border-bottom:none;padding-bottom:0">
          <span class="label">Conversation Beats</span>
          <span class="count">timeline</span>
        </div>
        <div class="beats-timeline">${groups}</div>
      </div>
    `;
  }
}

// ── SSE parsing ──────────────────────────────────────────
function parseSSE(text) {
  const events = [];
  const lines = text.split('\n');
  let e = null, d = null;
  for (const line of lines) {
    if (line.startsWith('event: ')) e = line.slice(7);
    else if (line.startsWith('data: ')) d = line.slice(6);
    else if (line === '' && e && d) {
      try { events.push({ event: e, data: JSON.parse(d) }); } catch {}
      e = d = null;
    }
  }
  return events;
}

// ── Chat (Ask Gaia — composer) ───────────────────────────
let gaiaSessionId = null;
const agentSessionIds = {};

async function handleGaiaChat(text) {
  const messages = document.getElementById('gaia-messages');
  messages.innerHTML += `<div class="cmsg user">&gt; ${escapeHtml(text)}</div>`;
  state.gaiaMessages.push({ role: 'user', text });

  const streamEl = document.createElement('div');
  streamEl.className = 'cmsg assistant';
  messages.appendChild(streamEl);
  messages.scrollTop = messages.scrollHeight;

  let streamedText = '';
  try {
    const agentId = state.selectedAgent || null;
    const sessionKey = agentId || '__habitat__';
    const payload = { message: text };
    if (agentSessionIds[sessionKey]) payload.sessionId = agentSessionIds[sessionKey];
    if (agentId) payload.agentId = agentId;

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        for (const { event, data } of parseSSE(part + '\n\n')) {
          switch (event) {
            case 'session':
              agentSessionIds[sessionKey] = data.sessionId;
              gaiaSessionId = data.sessionId;
              break;
            case 'text':
              streamedText += data.text;
              streamEl.innerHTML = simpleMarkdown(streamedText);
              messages.scrollTop = messages.scrollHeight;
              break;
            case 'tool-call': {
              const el = document.createElement('div');
              el.className = 'cmsg tool';
              el.textContent = `→ ${data.name}(${JSON.stringify(data.input || '').slice(0, 80)})`;
              streamEl.before(el);
              messages.scrollTop = messages.scrollHeight;
              break;
            }
            case 'tool-result': {
              const el = document.createElement('div');
              el.className = 'cmsg tool-result';
              el.textContent = `← ${data.name}: ${(data.output || '').slice(0, 160)}`;
              streamEl.before(el);
              messages.scrollTop = messages.scrollHeight;
              break;
            }
            case 'done':
              streamEl.innerHTML = simpleMarkdown(data.content || streamedText);
              state.gaiaMessages.push({ role: 'assistant', text: data.content || streamedText });
              break;
            case 'error':
              streamEl.style.color = 'var(--err)';
              streamEl.textContent = 'Error: ' + data.error;
              break;
          }
        }
      }
    }
    if (!streamedText && !streamEl.textContent) streamEl.remove();
  } catch (err) {
    streamEl.style.color = 'var(--err)';
    streamEl.textContent = 'Network error: ' + err.message;
  }
}

// ── Tweaks ───────────────────────────────────────────────
const ACCENT_PRESETS = {
  ink: {
    default: { a: 'oklch(0.76 0.14 42)',  dim: 'oklch(0.52 0.09 42)',  bg: 'oklch(0.26 0.06 42 / 0.5)' },  // coral
    green:   { a: 'oklch(0.76 0.14 142)', dim: 'oklch(0.52 0.09 142)', bg: 'oklch(0.26 0.06 142 / 0.5)' },
    cyan:    { a: 'oklch(0.76 0.14 220)', dim: 'oklch(0.52 0.09 220)', bg: 'oklch(0.26 0.06 220 / 0.5)' }
  },
  paper: {
    default: { a: 'oklch(0.55 0.14 22)',  dim: 'oklch(0.72 0.08 22)',  bg: 'oklch(0.92 0.04 22)' },
    green:   { a: 'oklch(0.48 0.12 142)', dim: 'oklch(0.68 0.08 142)', bg: 'oklch(0.92 0.04 142)' },
    cyan:    { a: 'oklch(0.52 0.12 220)', dim: 'oklch(0.70 0.08 220)', bg: 'oklch(0.92 0.04 220)' }
  },
  terminal: {
    default: { a: 'oklch(0.82 0.18 145)', dim: 'oklch(0.56 0.12 145)', bg: 'oklch(0.25 0.07 145 / 0.4)' },
    green:   { a: 'oklch(0.82 0.18 145)', dim: 'oklch(0.56 0.12 145)', bg: 'oklch(0.25 0.07 145 / 0.4)' },
    cyan:    { a: 'oklch(0.82 0.18 220)', dim: 'oklch(0.56 0.12 220)', bg: 'oklch(0.25 0.07 220 / 0.4)' }
  }
};

function applyTweaks() {
  const app = document.querySelector('.app');
  app.dataset.palette = state.tweaks.palette;
  app.dataset.layout = state.tweaks.layout;
  app.dataset.sidebar = state.tweaks.sidebar;
  document.documentElement.dataset.palette = state.tweaks.palette;

  // Accent override
  const accentGroup = ACCENT_PRESETS[state.tweaks.palette] || ACCENT_PRESETS.ink;
  const accent = accentGroup[state.tweaks.accent] || accentGroup.default;
  const root = document.documentElement;
  root.style.setProperty('--accent', accent.a);
  root.style.setProperty('--accent-dim', accent.dim);
  root.style.setProperty('--accent-bg', accent.bg);

  // Persist
  localStorage.setItem('gaia.palette', state.tweaks.palette);
  localStorage.setItem('gaia.layout', state.tweaks.layout);
  localStorage.setItem('gaia.sidebar', state.tweaks.sidebar);
  localStorage.setItem('gaia.accent', state.tweaks.accent);

  // Update tweak UI "on" state
  document.querySelectorAll('.tweak-opt').forEach(el => {
    const kind = el.dataset.tweak;
    const val = el.dataset.value;
    el.classList.toggle('on', state.tweaks[kind] === val);
  });
  document.querySelectorAll('.tweak-swatch').forEach(el => {
    el.classList.toggle('on', state.tweaks.accent === el.dataset.value);
  });
}

function renderTweaksPanel() {
  const panel = document.getElementById('tweaks');
  panel.innerHTML = `
    <div class="tweaks-title">
      <span>Tweaks</span>
      <span class="close" data-action="close-tweaks">×</span>
    </div>
    <div class="tweak">
      <div class="tweak-label">Palette</div>
      <div class="tweak-opts">
        <div class="tweak-opt" data-tweak="palette" data-value="ink">Ink</div>
        <div class="tweak-opt" data-tweak="palette" data-value="paper">Paper</div>
        <div class="tweak-opt" data-tweak="palette" data-value="terminal">Term</div>
      </div>
    </div>
    <div class="tweak">
      <div class="tweak-label">Dashboard Layout</div>
      <div class="tweak-opts">
        <div class="tweak-opt" data-tweak="layout" data-value="columns">Cols</div>
        <div class="tweak-opt" data-tweak="layout" data-value="stream">Stream</div>
        <div class="tweak-opt" data-tweak="layout" data-value="grid">Grid</div>
      </div>
    </div>
    <div class="tweak">
      <div class="tweak-label">Sidebar</div>
      <div class="tweak-opts">
        <div class="tweak-opt" data-tweak="sidebar" data-value="nested">Nested</div>
        <div class="tweak-opt" data-tweak="sidebar" data-value="flat">Flat</div>
        <div class="tweak-opt" data-tweak="sidebar" data-value="index">Index</div>
      </div>
    </div>
    <div class="tweak">
      <div class="tweak-label">Accent</div>
      <div class="tweak-accent-opts">
        <div class="tweak-swatch" data-value="default" style="background:var(--accent)"></div>
        <div class="tweak-swatch" data-value="green" style="background:oklch(0.76 0.14 142)"></div>
        <div class="tweak-swatch" data-value="cyan" style="background:oklch(0.76 0.14 220)"></div>
      </div>
    </div>
  `;
  applyTweaks();
}

// ── Event delegation ─────────────────────────────────────
document.addEventListener('click', async (e) => {
  // Home / brand
  if (e.target.closest('[data-action="go-home"]')) { showDashboard(); return; }

  // Agent row
  const agentRow = e.target.closest('[data-action="select-agent"]');
  if (agentRow) {
    const id = agentRow.dataset.agentId;
    if (state.selectedAgent === id && state.selectedSession == null) showDashboard();
    else await showAgent(id);
    return;
  }

  // Session row
  const sessionRow = e.target.closest('[data-action="select-session"]');
  if (sessionRow) {
    await showSession(sessionRow.dataset.agentId, parseInt(sessionRow.dataset.index, 10));
    return;
  }

  // Agent tab switch
  const tabEl = e.target.closest('[data-action="agent-tab"]');
  if (tabEl) {
    state.activeAgentTab = tabEl.dataset.tab;
    await renderAgentDetail();
    return;
  }

  // Beat jump
  const beatRow = e.target.closest('[data-action="jump-to-beat"]');
  if (beatRow) {
    await jumpToBeat(
      beatRow.dataset.agentId,
      parseInt(beatRow.dataset.session, 10),
      parseInt(beatRow.dataset.msg, 10)
    );
    return;
  }

  // Back to agent
  if (e.target.closest('[data-action="back-to-agent"]')) {
    if (state.selectedAgent) await showAgent(state.selectedAgent);
    else showDashboard();
    return;
  }

  // Toggle tool call
  const toolHeader = e.target.closest('.tool-call-header');
  if (toolHeader) {
    toolHeader.closest('.tool-call').classList.toggle('expanded');
    return;
  }

  // Tweaks toggle
  if (e.target.closest('[data-action="toggle-tweaks"]')) {
    state.tweaksOpen = !state.tweaksOpen;
    document.getElementById('tweaks').classList.toggle('visible', state.tweaksOpen);
    document.querySelector('[data-action="toggle-tweaks"]').classList.toggle('on', state.tweaksOpen);
    return;
  }
  if (e.target.closest('[data-action="close-tweaks"]')) {
    state.tweaksOpen = false;
    document.getElementById('tweaks').classList.remove('visible');
    document.querySelector('[data-action="toggle-tweaks"]').classList.remove('on');
    return;
  }

  // Tweak option
  const tweakOpt = e.target.closest('.tweak-opt');
  if (tweakOpt) {
    state.tweaks[tweakOpt.dataset.tweak] = tweakOpt.dataset.value;
    applyTweaks();
    return;
  }
  const swatch = e.target.closest('.tweak-swatch');
  if (swatch) {
    state.tweaks.accent = swatch.dataset.value;
    applyTweaks();
    return;
  }

  // Composer collapse toggle
  if (e.target.closest('[data-action="toggle-composer"]')) {
    const comp = document.getElementById('composer');
    comp.classList.toggle('collapsed');
    return;
  }
});

// ── Composer input ───────────────────────────────────────
document.getElementById('gaia-input').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const input = e.target;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.disabled = true;
  await handleGaiaChat(text);
  input.disabled = false;
  input.focus();
});

// Composer resize handle
(function wireComposerResize() {
  const panel = document.getElementById('composer');
  const handle = document.getElementById('composer-handle');
  let dragging = false, startY = 0, startH = 0;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = panel.offsetHeight;
    panel.style.transition = 'none';
    panel.classList.remove('expanded', 'collapsed');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY;
    const newH = Math.max(48, Math.min(window.innerHeight * 0.85, startH + delta));
    panel.style.height = newH + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// ── Init ─────────────────────────────────────────────────
async function init() {
  renderTweaksPanel();
  applyTweaks();

  const isLive = await loadLiveData();
  if (!isLive) {
    console.log('[gaia] Using mock data');
    loadMockData();
  } else {
    console.log('[gaia] Connected to live habitat API');
  }
  renderSidebar();
  renderDashboard();
  renderTopbar();
  updateComposer();
}

init();
