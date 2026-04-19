/* ═══════════════════════════════════════════════════════════
   Gaia v2 — artifacts.js
   Agent-defined UI surfaces. Each artifact = { type, title,
   updatedAt, data }. Renderers return HTML strings.
   ═══════════════════════════════════════════════════════════ */

const MOCK_ARTIFACTS = {
  'twitter-feed': [
    {
      id: 'tf-topics',
      type: 'topics',
      title: 'What people are talking about',
      subtitle: 'Last 6 hours · 142 tweets analyzed',
      updatedAt: '2026-04-18T09:42:00Z',
      data: {
        topics: [
          { name: 'Mixture-of-experts routing', volume: 38, trend: '+24%', sentiment: 'curious', sample: '"The sparse router finally made sense once I thought of it as a learned k-way switchboard."', sources: 14 },
          { name: 'Claude 4 release rumors', volume: 27, trend: '+310%', sentiment: 'hype', sample: '"Nothing official, but three different leaks point at a June announcement."', sources: 9 },
          { name: 'Small models on device', volume: 19, trend: '+8%', sentiment: 'builder', sample: '"Shipped my 1.7B distillation to iPad — 34 tok/s on M2, wild."', sources: 11 },
          { name: 'Agent memory patterns', volume: 16, trend: '-4%', sentiment: 'skeptical', sample: '"Vector-only memory is a dead end for agents; episodic + structured wins."', sources: 7 },
          { name: 'Rust async story', volume: 12, trend: '+2%', sentiment: 'tired', sample: '"Send + Sync + \'static is a rite of passage, not a language flaw."', sources: 5 }
        ]
      }
    },
    {
      id: 'tf-threads',
      type: 'feed',
      title: 'Threads worth reading',
      subtitle: 'Curated by /summarize · signal ≥ 0.7',
      updatedAt: '2026-04-18T09:40:00Z',
      data: {
        items: [
          { author: '@karpathy', handle: 'karpathy', time: '3h', text: 'The interesting part of mixture-of-experts isn\'t the experts — it\'s the router. Everything we learned about attention heads now applies to expert selection, and I don\'t think the field has internalized that yet.', replies: 412, likes: 8400, threadLen: 7 },
          { author: 'Simon Willison', handle: 'simonw', time: '5h', text: 'Built a tiny tool that takes a RSS feed and runs each item through a small local model for tagging and deduplication. 200 lines of Python. This is the era we\'re in now.', replies: 88, likes: 2100, threadLen: 4 },
          { author: 'Swyx', handle: 'swyx', time: '7h', text: 'Three reasons why agent benchmarks still feel fake: (1) reset semantics, (2) tool surface area, (3) human-in-the-loop leakage. Long post coming this weekend.', replies: 156, likes: 1890, threadLen: 1 },
          { author: 'Jason Wei', handle: 'jasonwei', time: '9h', text: 'Scaling laws for in-context learning look different when you condition on task familiarity. Paper dropping Monday.', replies: 62, likes: 1450, threadLen: 1 }
        ]
      }
    },
    {
      id: 'tf-stats',
      type: 'stats',
      title: 'Feed health',
      data: {
        tiles: [
          { label: 'Processed today', value: '142', unit: 'tweets' },
          { label: 'Match rate', value: '4.9', unit: '%' },
          { label: 'Avg signal', value: '0.62', unit: '' },
          { label: 'Dedupe ratio', value: '18', unit: '%' }
        ]
      }
    }
  ],

  'newsletter-feed': [
    {
      id: 'nf-digest',
      type: 'list',
      title: 'In today\'s newsletters',
      subtitle: '11 newsletters · 34 items · sorted by novelty',
      updatedAt: '2026-04-18T07:05:00Z',
      data: {
        items: [
          { source: 'Import AI', tag: 'research', title: 'Sparse MoE routing via sinkhorn normalization', summary: 'New paper claims stable routing without auxiliary load-balance loss. Benchmarks on 1.4T param model show 12% throughput gain.', novelty: 0.91 },
          { source: 'The Batch', tag: 'policy', title: 'EU AI Act — first enforcement actions filed', summary: 'Two providers cited for transparency violations. Neither named publicly yet. Fines capped at 3% global revenue.', novelty: 0.84 },
          { source: 'Stratechery', tag: 'markets', title: 'The vertical agent thesis', summary: 'Argument that horizontal foundation models plus vertical agent wrappers is the stable equilibrium. Counter to the "one model to rule them all" narrative.', novelty: 0.78 },
          { source: 'Ben\'s Bites', tag: 'tools', title: 'New browser-native agent sandbox', summary: 'Open-source. Runs in Chromium. Tool calls hit a WASM-sandboxed filesystem. Interesting security model.', novelty: 0.73 },
          { source: 'TLDR AI', tag: 'research', title: 'Small-model distillation — quality plateau at ~3B', summary: 'Meta-analysis across 14 recent papers suggests diminishing returns past ~3B parameters for a given teacher.', novelty: 0.69 },
          { source: 'Latent Space', tag: 'ecosystem', title: 'Agent framework shakeout continues', summary: 'Three frameworks consolidating. Two deprecated. Full breakdown + decision tree included.', novelty: 0.64 }
        ]
      }
    },
    {
      id: 'nf-topics',
      type: 'topics',
      title: 'Recurring themes this week',
      data: {
        topics: [
          { name: 'MoE / sparse models', volume: 11, trend: '+1 vs last wk', sentiment: 'research', sources: 8 },
          { name: 'Agent reliability', volume: 9, trend: '+2', sentiment: 'builder', sources: 6 },
          { name: 'Regulation', volume: 7, trend: '+5', sentiment: 'cautious', sources: 5 },
          { name: 'Compute pricing', volume: 5, trend: '-2', sentiment: 'neutral', sources: 4 }
        ]
      }
    }
  ],

  'trmnl-image': [
    {
      id: 'ti-latest',
      type: 'image',
      title: 'Latest render',
      subtitle: 'Generated 07:02 · prompt v14 · 1600×900',
      updatedAt: '2026-04-18T07:02:00Z',
      data: {
        latest: {
          prompt: 'low-light kitchen, morning, a single coffee cup on wooden counter, soft warm window light, analog film grain, shallow DoF',
          seed: '0x3A7E9C',
          model: 'flux-dev',
          steps: 28,
          aspect: '16:9'
        },
        history: [
          { time: '07:02', prompt: 'low-light kitchen, morning, coffee cup...', tone: '#d9b48a' },
          { time: '06:58', prompt: 'low-light kitchen, morning, coffee cup, softer light...', tone: '#c7a077' },
          { time: '06:45', prompt: 'kitchen counter, cup, sunrise, grain...', tone: '#e0c9a0' },
          { time: '06:30', prompt: 'coffee, ceramic, blue hour...', tone: '#7a8ea3' },
          { time: '06:12', prompt: 'mug, window seat, cold morning...', tone: '#95a6b5' },
          { time: '05:55', prompt: 'teapot, steam, predawn...', tone: '#b0856a' }
        ]
      }
    },
    {
      id: 'ti-stats',
      type: 'stats',
      title: 'Renders',
      data: {
        tiles: [
          { label: 'Today', value: '14', unit: 'renders' },
          { label: 'Queue', value: '0', unit: 'pending' },
          { label: 'Avg latency', value: '8.2', unit: 'sec' },
          { label: 'Rate limit', value: '87', unit: '% headroom' }
        ]
      }
    }
  ]
};

// ── Renderers ────────────────────────────────────────────
function renderArtifact(artifact) {
  const fn = ARTIFACT_RENDERERS[artifact.type];
  if (!fn) return `<div class="artifact-empty">Unknown artifact type: ${escapeHtml(artifact.type)}</div>`;
  const head = `
    <div class="artifact-head">
      <div>
        <div class="artifact-kicker">${escapeHtml(artifact.type)}</div>
        <h2 class="artifact-title">${escapeHtml(artifact.title)}</h2>
        ${artifact.subtitle ? `<div class="artifact-sub">${escapeHtml(artifact.subtitle)}</div>` : ''}
      </div>
      ${artifact.updatedAt ? `<div class="artifact-updated">Updated ${formatTime(artifact.updatedAt)} ago</div>` : ''}
    </div>
  `;
  return `<div class="artifact artifact-${artifact.type}">${head}<div class="artifact-body">${fn(artifact.data)}</div></div>`;
}

const ARTIFACT_RENDERERS = {
  topics(data) {
    const max = Math.max(...data.topics.map(t => t.volume));
    return `
      <div class="topics-grid">
        ${data.topics.map((t, i) => `
          <div class="topic-card">
            <div class="topic-rank">${String(i + 1).padStart(2, '0')}</div>
            <div class="topic-body">
              <div class="topic-name">${escapeHtml(t.name)}</div>
              ${t.sample ? `<div class="topic-sample">${escapeHtml(t.sample)}</div>` : ''}
              <div class="topic-meta">
                <span>${t.sources || 0} sources</span>
                ${t.sentiment ? `<span>· ${escapeHtml(t.sentiment)}</span>` : ''}
              </div>
            </div>
            <div class="topic-vol">
              <div class="topic-vol-n">${t.volume}</div>
              <div class="topic-vol-trend ${t.trend?.startsWith('-') ? 'down' : 'up'}">${escapeHtml(t.trend || '')}</div>
              <div class="topic-vol-bar"><div style="width:${(t.volume / max * 100).toFixed(0)}%"></div></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  feed(data) {
    return `
      <div class="feed-list">
        ${data.items.map(item => `
          <article class="feed-item">
            <header class="feed-head">
              <span class="feed-author">${escapeHtml(item.author)}</span>
              <span class="feed-handle">@${escapeHtml(item.handle)}</span>
              <span class="feed-time">${escapeHtml(item.time)}</span>
              ${item.threadLen > 1 ? `<span class="feed-thread">Thread · ${item.threadLen}</span>` : ''}
            </header>
            <p class="feed-text">${escapeHtml(item.text)}</p>
            <footer class="feed-foot">
              <span>${item.replies} replies</span>
              <span>${item.likes.toLocaleString()} likes</span>
            </footer>
          </article>
        `).join('')}
      </div>
    `;
  },

  list(data) {
    return `
      <div class="list-items">
        ${data.items.map(item => `
          <div class="list-item">
            <div class="list-item-meta">
              <span class="list-item-source">${escapeHtml(item.source)}</span>
              ${item.tag ? `<span class="list-item-tag">${escapeHtml(item.tag)}</span>` : ''}
              ${item.novelty != null ? `<span class="list-item-novelty">novelty ${item.novelty.toFixed(2)}</span>` : ''}
            </div>
            <h3 class="list-item-title">${escapeHtml(item.title)}</h3>
            <p class="list-item-summary">${escapeHtml(item.summary)}</p>
          </div>
        `).join('')}
      </div>
    `;
  },

  image(data) {
    const l = data.latest;
    // Placeholder image using gradient from history tones
    const heroGradient = `linear-gradient(135deg, ${data.history[0].tone} 0%, ${data.history[1]?.tone || '#2a2520'} 70%, #141210 100%)`;
    return `
      <div class="image-artifact">
        <div class="image-hero" style="background:${heroGradient}">
          <div class="image-hero-inner">
            <div class="image-hero-label">Latest · ${escapeHtml(l.model)}</div>
            <div class="image-hero-dims">${escapeHtml(l.aspect)}</div>
          </div>
        </div>
        <div class="image-meta">
          <div class="kv-item"><div class="k">Prompt</div><div class="v">${escapeHtml(l.prompt)}</div></div>
          <div class="kv-item"><div class="k">Model</div><div class="v mono">${escapeHtml(l.model)}</div></div>
          <div class="kv-item"><div class="k">Seed</div><div class="v mono">${escapeHtml(l.seed)}</div></div>
          <div class="kv-item"><div class="k">Steps</div><div class="v mono">${l.steps}</div></div>
        </div>
        <div class="image-history">
          <div class="section-head"><span class="label">Recent renders</span><span class="count">${data.history.length}</span></div>
          <div class="image-strip">
            ${data.history.map(h => `
              <div class="image-chip" title="${escapeHtml(h.prompt)}">
                <div class="image-chip-swatch" style="background:${h.tone}"></div>
                <div class="image-chip-time">${h.time}</div>
                <div class="image-chip-prompt">${escapeHtml(h.prompt.slice(0, 40))}${h.prompt.length > 40 ? '…' : ''}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  stats(data) {
    return `
      <div class="stats-tiles">
        ${data.tiles.map(t => `
          <div class="stat-tile">
            <div class="stat-tile-val">${escapeHtml(String(t.value))}</div>
            <div class="stat-tile-unit">${escapeHtml(t.unit || '')}</div>
            <div class="stat-tile-label">${escapeHtml(t.label)}</div>
          </div>
        `).join('')}
      </div>
    `;
  },

  markdown(data) {
    return `<div class="md-artifact">${simpleMarkdown(data.text || '')}</div>`;
  }
};

// Expose
window.MOCK_ARTIFACTS = MOCK_ARTIFACTS;
window.renderArtifact = renderArtifact;
