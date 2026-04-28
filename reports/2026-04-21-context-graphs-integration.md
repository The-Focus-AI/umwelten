---
title: "Context Graphs in umwelten: Kuzu-backed GraphRAG with incremental extraction"
date: 2026-04-21
topic: context-graphs
recommendation: Kuzu (embedded) + LightRAG-style dual-level retrieval
version_researched: kuzu 0.11.3, LightRAG EMNLP2025, Microsoft GraphRAG v2.x
use_when:
  - Cross-session recall: "what have we decided / learned / observed about X over the last N sessions?"
  - Research/scraping agents that ingest many sources and need multi-hop reasoning (e.g., "which of these papers cite the same author and contradict each other?")
  - The existing `MemoryStore` (flat Fact list) starts to mis-rank on queries that need relationships, not keyword/type matching
avoid_when:
  - The task is simple fact lookup — flat vector or keyword search wins on latency, cost, and faithfulness[10]
  - Corpus is small (<100 docs / <50 sessions). Extraction cost dominates; no retrieval quality win[1]
  - You need 1:1 Microsoft-GraphRAG behavior on day one — port the subset, don't chase feature parity
project_context:
  language: TypeScript (Node 20+, ESM)
  relevant_dependencies:
    - "@ai-sdk/* (Vercel AI SDK) — already used by runners"
    - "zod — used everywhere for schemas, will drive extraction output"
    - "existing src/memory/ fact extractor — we reuse the prompt scaffolding"
    - "existing src/context/ CompactionStrategy — graph summaries can register as a strategy"
    - "existing src/interaction/analysis/session-digester — already extracts entities-ish (topics, tags, facts)"
---

## Summary

umwelten already has every ingredient for a knowledge graph except the edges. `src/memory/extract_facts.ts` pulls facts out of conversations, `session-digester.ts` tags sessions with topics/entities/facts, and `FileLearningsStore` persists per-project learnings as JSONL. What's missing is a **relational layer**: the ability to ask "which facts connect these two sessions?" or "who keeps coming up when we talk about provider X?" That's what a context graph adds.

The GraphRAG landscape has matured sharply since 2024. Microsoft's original system (3.4× accuracy vs. vanilla RAG on multi-hop benchmarks[1]) spawned a family — LightRAG (34k stars, ~6000× cheaper indexing than MS-GraphRAG[5]), nano-graphrag (3.8k stars, ~1,100 LOC[3]), HippoRAG (NeurIPS'24, Personalized PageRank over entity graphs[4]), Mem0g (graph-augmented agent memory[6]), and Microsoft's own LazyGraphRAG (defer graph construction to query time[1]). Benchmarks in 2026 are clear: **graphs win on multi-hop reasoning, contextual summarization, and creative synthesis; they lose on simple fact retrieval and blow up token cost if you naively enable "global" search**[10].

The recommendation is **Kuzu** (3.9k stars, MIT, v0.11.3, embedded property graph with Cypher + native vector + FTS indexes, first-class Node.js bindings[7][8]) as the storage layer, with a LightRAG-style **dual-level retrieval** strategy (local entity expansion + global community summaries) layered on top. Kuzu runs in-process like SQLite — no server, no Docker, no Python sidecar — which matches umwelten's zero-infrastructure ethos. Extraction piggybacks on the existing `Stimulus` + Zod pipeline: every session goes through a `GraphDigester` that emits `Entity[]` and `Relationship[]` in the same pass that currently produces facts.

## Philosophy & Mental Model

Think of the context graph as the **schema-on-write counterpart to the session digest**. The digester already asks "what's this session about?" and produces a bag of topics, tags, and facts. The graph asks a sharper question: "what *entities* appeared, and *how are they related*?" Both run on the same source material (session transcripts, scraped pages, extracted facts); the graph just refuses to flatten relationships into free text.

Four abstractions carry the design:

1. **Entity** — a typed noun: `Person`, `Project`, `Provider`, `Tool`, `Concept`, `Session`, `Fact`, `Source`. Has a canonical `name`, a `description`, and an embedding. Deduplication is a named operation (`resolveEntity`), not a side effect.
2. **Relationship** — a typed edge with a short `description`: `(umwelten)-[:USES_PROVIDER {since: "2025-03"}]->(google)`, `(fact_42)-[:SUPPORTS]->(decision_7)`, `(session_abc)-[:MENTIONS]->(kuzu)`. Edges carry their own provenance (`sourceSessionId`, `confidence`, `extractedAt`).
3. **Community** — a cluster of tightly connected entities (Leiden algorithm over the node graph[1]). Each community gets an LLM-generated summary. Communities are the unit of **global** retrieval: "what are the major themes?"
4. **Retriever** — a function that takes a query, decides between `local` (entity-anchored neighborhood walk), `global` (community-summary scan), or `hybrid` (both, merged), and returns a context block the `Interaction` can inject[1][5].

The mental model mirrors LightRAG's dual-level retrieval[5]: **low-level queries** ("what version of Kuzu did we pin?") hit the entity graph directly; **high-level queries** ("what have we learned about embedded graph DBs?") hit community summaries. The `Stimulus` decides which, or asks the LLM to via a tool call.

Crucially: the graph is **additive, never authoritative**. Source documents remain the source of truth. The graph is an *index over* the session history and learnings store — rebuilding it from scratch should always be possible, and the API surface guarantees it (`rebuildGraph(fromSessions)`).

## Setup

```bash
pnpm add kuzu
# Optional: community detection (Leiden)
pnpm add graphology graphology-communities-louvain
```

No native build step on macOS/Linux/Windows (prebuilt binaries via `kuzu`'s npm package[8]). Node 20+.

Project layout (new module, follows the existing layer-3 pattern):

```
src/
  graph/
    types.ts              # Entity, Relationship, Community, GraphQuery
    store.ts              # GraphStore interface (pluggable backend)
    kuzu-store.ts         # KuzuGraphStore: schema, upsert, cypher helpers
    extractor.ts          # extractEntitiesAndRelations(text, model): uses Stimulus + Zod
    communities.ts        # detect communities (Leiden/Louvain) + summarize
    retriever.ts          # local / global / hybrid retrieval
    tools.ts              # graph_query, graph_add_observation tools for Stimulus
    compaction.ts         # CompactionStrategy that summarizes via community walk
    index.ts              # barrel
```

Storage: `~/.umwelten/graph/<workDirSlug>.kuzu/` (one Kuzu DB per habitat work dir, matching how `.umwelten/learnings/claude/<safeKey>/` is partitioned today).

Minimal schema (Cypher DDL, run once on `KuzuGraphStore.init()`):

```cypher
CREATE NODE TABLE Entity(
  id STRING,
  name STRING,
  type STRING,           // 'Person' | 'Project' | 'Provider' | 'Tool' | ...
  description STRING,
  embedding FLOAT[768],  // for vector similarity during entity resolution
  created_at TIMESTAMP,
  PRIMARY KEY (id)
);
CREATE NODE TABLE Source(
  id STRING,             // sessionId or docId
  kind STRING,           // 'session' | 'url' | 'file'
  uri STRING,
  created_at TIMESTAMP,
  PRIMARY KEY (id)
);
CREATE REL TABLE MENTIONS(FROM Source TO Entity, count INT64);
CREATE REL TABLE RELATES(
  FROM Entity TO Entity,
  label STRING,          // 'USES', 'CONTRADICTS', 'AUTHORED_BY', ...
  description STRING,
  confidence DOUBLE,
  source_id STRING,      // provenance: which Source produced this edge
  created_at TIMESTAMP
);
```

Vector index on `Entity.embedding` is native in Kuzu 0.11[8] — used for entity resolution (matching "Gemini 3 Flash" to an existing `:Provider` node).

## Core Usage Patterns

### Pattern 1: Extract entities + relationships from text

Reuse the existing extraction scaffolding. A `GraphExtractor` is just a `Stimulus` + Zod schema, run through the normal `BaseModelRunner`.

```typescript
// src/graph/extractor.ts
import { z } from 'zod';
import { Stimulus } from '../stimulus/stimulus.js';
import { Interaction } from '../interaction/core/interaction.js';
import type { ModelDetails } from '../cognition/types.js';

const ExtractionSchema = z.object({
  entities: z.array(z.object({
    name: z.string(),
    type: z.enum(['Person','Project','Provider','Tool','Concept','Fact']),
    description: z.string(),
  })),
  relationships: z.array(z.object({
    source: z.string(),       // entity.name
    target: z.string(),
    label: z.string(),        // verb phrase: "uses", "contradicts", "depends on"
    description: z.string(),
    confidence: z.number().min(0).max(1),
  })),
});

export async function extractGraph(text: string, model: ModelDetails) {
  const stimulus = new Stimulus({
    role: 'knowledge graph extractor',
    objective: 'identify named entities and their explicit relationships',
    instructions: [
      'Only extract relationships stated or strongly implied in the text.',
      'Use canonical names; prefer full names over pronouns.',
      'If the text is a conversation, treat the speakers as entities too.',
    ],
  });
  const interaction = new Interaction(model, stimulus);
  interaction.addMessage({ role: 'user', content: text });
  const { object } = await interaction.generateObject(ExtractionSchema);
  return object;
}
```

### Pattern 2: Upsert with entity resolution

Before inserting, check if each entity already exists. Vector similarity first (embedding), fall back to lexical (name match).

```typescript
// src/graph/kuzu-store.ts (sketch)
async upsertEntity(e: EntityInput): Promise<string> {
  const embedding = await embed(e.name + ': ' + e.description);
  const matches = await this.conn.query(`
    CALL QUERY_VECTOR_INDEX('Entity', 'embedding_idx', $emb, 3)
    YIELD node, distance
    WHERE distance < 0.2 AND node.type = $type
    RETURN node.id AS id LIMIT 1;
  `, { emb: embedding, type: e.type });
  const rows = await matches.getAll();
  if (rows.length) return rows[0].id as string;
  const id = randomUUID();
  await this.conn.query(`
    CREATE (:Entity {id: $id, name: $name, type: $type,
                     description: $desc, embedding: $emb,
                     created_at: timestamp()});
  `, { id, name: e.name, type: e.type, desc: e.description, emb: embedding });
  return id;
}
```

### Pattern 3: Register retrieval as a tool on the Stimulus

Follow the `urlToolSet` pattern in `src/stimulus/tools/url-tools.ts:122-173`. Two tools cover 80% of use: one for local/entity search, one for global/theme search.

```typescript
// src/graph/tools.ts
import { tool } from 'ai';
import { z } from 'zod';
import type { GraphStore } from './store.js';

export const graphQueryTool = (store: GraphStore) => tool({
  description: 'Query the context graph. Use mode="local" for specific entities, "global" for broad themes.',
  inputSchema: z.object({
    query: z.string(),
    mode: z.enum(['local', 'global', 'hybrid']).default('hybrid'),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  execute: async ({ query, mode, limit }) => {
    const result = await store.retrieve({ query, mode, limit });
    return {
      mode,
      entities: result.entities,      // [{ name, type, description }]
      relationships: result.edges,    // [{ source, label, target }]
      communities: result.communities // [{ label, summary }] (global only)
    };
  },
});

export const graphAddObservationTool = (store: GraphStore, sessionId: string) => tool({
  description: 'Persist a new observation as entities + relationships in the context graph.',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => {
    const { entities, relationships } = await extractGraph(text, store.extractionModel);
    await store.ingest({ sourceId: sessionId, entities, relationships });
    return { added: entities.length, edges: relationships.length };
  },
});
```

### Pattern 4: Community detection + summaries (global retrieval)

Run periodically (nightly, or after every N new edges). Keeps global retrieval cheap at query time.

```typescript
// src/graph/communities.ts
import louvain from 'graphology-communities-louvain';
import Graph from 'graphology';

export async function rebuildCommunities(store: GraphStore, model: ModelDetails) {
  const g = new Graph({ type: 'undirected' });
  for (const e of await store.allEntities()) g.addNode(e.id, e);
  for (const r of await store.allRelationships()) {
    if (g.hasNode(r.sourceId) && g.hasNode(r.targetId)) {
      g.mergeEdge(r.sourceId, r.targetId, { label: r.label });
    }
  }
  const partition = louvain(g, { resolution: 1.0 });
  const communities = groupBy(partition);
  for (const [cid, nodeIds] of communities) {
    const summary = await summarizeCommunity(nodeIds, store, model);
    await store.upsertCommunity({ id: cid, nodeIds, summary });
  }
}
```

### Pattern 5: Register a graph-aware CompactionStrategy

Compaction today (`src/context/registry.ts:14-19`) ships `through-line-and-facts` and `truncate`. Add a third that, before dropping messages, writes their extracted entities/edges to the graph — so the graph becomes the long-term memory for compacted context.

```typescript
// src/graph/compaction.ts
import type { CompactionStrategy } from '../context/types.js';
import { registerCompactionStrategy } from '../context/registry.js';

export const graphCompactionStrategy: CompactionStrategy = {
  id: 'graph-compaction',
  name: 'Graph-backed compaction',
  description: 'Compacts messages into a summary AND writes entities+edges to the context graph.',
  compact: async ({ messages, segmentStart, segmentEnd, model, options }) => {
    const store = options?.graphStore as GraphStore;
    const segment = messages.slice(segmentStart, segmentEnd);
    const text = segment.map(m => `${m.role}: ${contentToText(m.content)}`).join('\n');
    const { entities, relationships } = await extractGraph(text, model!);
    await store.ingest({ sourceId: options!.sessionId as string, entities, relationships });
    const summaryText = renderSummary(entities, relationships);
    return {
      replacementMessages: [{ role: 'system', content: `[Compacted into graph]\n${summaryText}` }],
    };
  },
};

registerCompactionStrategy(graphCompactionStrategy);
```

## Anti-Patterns & Pitfalls

### Don't: Cap the extractor with `maxOutputTokens`

```typescript
// BAD
const stimulus = new Stimulus({ role: 'graph extractor', maxTokens: 2000 });
```

**Why it's wrong:** Truncating extraction mid-JSON silently drops edges. The project's HARD RULES (CLAUDE.md) forbid capping output tokens anywhere except on an explicit per-task `Stimulus`, and even then only when you understand the trade-off. For a graph extractor you *want* the model to enumerate everything it sees.

### Instead: Let it run, measure, and break long inputs into chunks

```typescript
// GOOD
const chunks = chunkBySemanticBoundary(text, { targetTokens: 6000 });
const results = await Promise.all(chunks.map(c => extractGraph(c, model)));
const merged = mergeExtractions(results);  // dedup entities by (name,type)
```

### Don't: Extract a graph on every turn

```typescript
// BAD
interaction.chat(userInput);
await extractAndUpsertGraph(interaction.messages, store);  // on every turn
```

**Why it's wrong:** Entity extraction is an LLM call. Doing it synchronously in the chat loop adds seconds of latency per turn and a second bill per turn. Microsoft explicitly warns that indexing is the expensive part of GraphRAG[1].

### Instead: Extract at session-digest time, or via an async queue

```typescript
// GOOD — piggyback on the existing session-digester pipeline
// src/interaction/analysis/session-digester.ts already runs post-hoc; add:
await graphStore.ingestDigest(digest);
```

### Don't: Use global search for narrow questions

```typescript
// BAD
graphQuery({ query: "what was kuzu's version?", mode: 'global' });
```

**Why it's wrong:** Global search scans community summaries — high token overhead[10] — when one entity lookup would suffice. Research in 2026 showed vector RAG beats GraphRAG on simple fact retrieval[10].

### Instead: Default to `hybrid`, let the retriever decide

```typescript
// GOOD
graphQuery({ query: "what was kuzu's version?", mode: 'hybrid' });
// retriever: if query matches a known entity name with high similarity, do local;
// else sample top-k communities; merge and let reranker sort.
```

### Don't: Treat the graph as authoritative

```typescript
// BAD
const answer = await store.query(cypher);   // return directly to user
```

**Why it's wrong:** Extractions have confidence <1.0. Edges with `confidence: 0.4` will confidently state wrong things. The graph is an **index**, not a knowledge base.

### Instead: Return graph hits as *context* to an LLM that cites sources

```typescript
// GOOD
const { entities, edges } = await store.retrieve({ query });
const ctx = formatAsContext(entities, edges); // includes sourceId for each edge
interaction.addMessage({ role: 'system', content: ctx });
const answer = await interaction.chat(userQuestion);
// answer cites sourceIds; human or judge can verify against original transcripts
```

### Don't: Build your own vector index when Kuzu ships one

```typescript
// BAD
const vectors = new LocalVectorStore();
vectors.add(entity.id, embedding);
// later: SELECT ... JOIN vectors ON ... (two stores, two sync problems)
```

**Why it's wrong:** Kuzu 0.11 ships native vector indexes with HNSW[7][8]. Using an external vector store means you maintain consistency between two DBs — a classic source of drift.

### Instead: Use Kuzu's built-in vector index

```cypher
CREATE VECTOR INDEX embedding_idx ON Entity(embedding)
WITH (metric = 'cosine', M = 16, efConstruction = 200);
```

## Why This Choice

### Decision Criteria

| Criterion | Weight | How Kuzu + LightRAG-pattern scored |
|-----------|--------|------------------------------------|
| Zero infrastructure (matches umwelten's `~/.umwelten/` ethos) | **High** | ✅ Embedded, no server, npm-installable[7][8]. Like SQLite. |
| First-class TypeScript / Node bindings | **High** | ✅ Official `kuzu` npm package, CJS + ESM[8]. |
| Standard query language | **High** | ✅ Cypher (openCypher subset) — portable to Neo4j if we outgrow embedded[7]. |
| Native vector + FTS indexes (no second store) | **High** | ✅ Built into 0.11[7][8]. |
| Extraction cost control | **High** | ✅ LightRAG-style single-pass extraction beats MS-GraphRAG's multi-pass by ~6000×[5]. |
| Multi-hop query quality | Medium | ✅ Cypher pattern matching = multi-hop for free. HippoRAG-style PPR is an easy add-on. |
| Community detection support | Medium | ⚠️ Not built into Kuzu; use `graphology-communities-louvain` in Node (small, MIT). |
| License compatibility | Medium | ✅ Kuzu MIT, LightRAG MIT, all dependencies MIT/Apache[3][5][7]. |
| Migration path off the stack | Low | ✅ Cypher → Neo4j, or re-extract to any other graph DB. Data format is portable. |

### Key Factors

- **Embedded-first matches umwelten's DNA.** The project already ships no-server primitives (`FileLearningsStore`, digest JSON files on disk). Kuzu slots in next to them. Shipping a GraphRAG that requires Neo4j would violate the zero-setup contract users get today.
- **Cypher is the right abstraction level.** Writing graph queries in raw SQL (DuckPGQ path) works but is clumsy; writing them in TS objects (JSON-based graph stores like `dpapathanasiou/simple-graph`) hides the mental model. Cypher reads like what you'd whiteboard.
- **LightRAG-style dual retrieval matches our query shape.** Umwelten users will ask both "what version of kuzu did we pin" (local) and "what have we decided about graph DBs across sessions" (global). A single-mode system would be wrong half the time.
- **The extraction pipeline already exists.** `src/memory/extract_facts.ts` and `session-digester.ts` prove the Stimulus + Zod + runner pattern works for structured extraction. The graph extractor is a 100-line addition, not a new subsystem.

## Alternatives Considered

### Microsoft GraphRAG (the original)

- **What it is:** The reference Python implementation, Leiden clustering, community summaries, multi-pass indexing[1][2].
- **Why not chosen:** Python-only. Indexing a modest corpus costs $4–7 vs. $0.15 for LightRAG[5]. Requires parquet files and a CLI. Completely misaligned with an embedded TS framework.
- **Choose this instead when:** You have a batch-oriented data science pipeline, a big budget, and you want the exact Leiden+community-summary behavior as a reference implementation.
- **Key tradeoff:** Highest retrieval quality on complex reasoning benchmarks, at the highest cost — and you'd have to shell out to Python.

### LightRAG (as a library)

- **What it is:** Dual-level retrieval with cheap single-pass extraction, 34k stars[5][9].
- **Why not chosen:** Python-only core (TypeScript is only the web UI[5]). We'd be shelling out or reimplementing anyway — reimplementing gives us first-class types and fewer moving parts.
- **Choose this instead when:** You're already in Python and want the shipping product rather than a custom build.
- **Key tradeoff:** Gain a polished web UI and reranker integrations; lose native TS integration and add a Python subprocess dependency.

### nano-graphrag

- **What it is:** ~1,100 LOC Python reference implementation; hackable; networkx-backed by default[3].
- **Why not chosen:** Also Python. Its value is pedagogical — reading it is a fantastic way to understand GraphRAG — but the code doesn't run in our process.
- **Choose this instead when:** You want to study or fork a minimal GraphRAG in Python.
- **Key tradeoff:** Simplicity, at the cost of being in the wrong language.

### Mem0 (+ FalkorDB graph variant)

- **What it is:** Universal memory layer for AI agents, with TS SDK and an optional graph-backed variant (Mem0g / mem0-falkordb)[6].
- **Why not chosen:** Mem0's graph tier is paid ($249/mo Pro)[6], and FalkorDB is a Redis-module service, not embedded. Conceptually close but operationally heavier.
- **Choose this instead when:** You want managed memory-as-a-service and don't want to operate anything. Plays well with existing Mem0 integrations.
- **Key tradeoff:** Lower implementation effort; higher ongoing cost and network dependency.

### Zep (temporal knowledge graph)

- **What it is:** Managed temporal KG service; tracks how relationships evolve over time[6].
- **Why not chosen:** Hosted service; temporal-first design is overkill for our query shape today.
- **Choose this instead when:** You need explicit temporal queries ("what did we believe about X on date Y?") and operate at team/enterprise scale.
- **Key tradeoff:** Best-in-class temporal reasoning for the price of a SaaS dependency.

### DuckPGQ (DuckDB + SQL/PGQ)

- **What it is:** DuckDB extension that adds SQL/PGQ graph queries on top of DuckDB tables.
- **Why not chosen:** DuckPGQ is a community extension, still actively evolving; SQL/PGQ as a standard is newer than Cypher. Node.js story for DuckDB extensions is less polished than Kuzu's native bindings.
- **Choose this instead when:** You're already storing evaluation data in DuckDB and want graph queries over it without a second store.
- **Key tradeoff:** Single-store simplicity vs. a less mature graph ecosystem and steeper SQL/PGQ learning curve.

### SQLite + recursive CTEs

- **What it is:** Nodes and edges as tables, traversal via recursive CTE.
- **Why not chosen:** Works for <1k entities, but recursive CTEs over many hops get slow and unreadable. No native vector index. No Cypher.
- **Choose this instead when:** You need to ship *today* on a dependency you already have, and the graph is tiny.
- **Key tradeoff:** Familiar tool, zero new deps; wrong abstraction as the graph grows.

## Caveats & Limitations

- **Extraction quality caps retrieval quality.** A low-confidence extractor produces a noisy graph; no retrieval trick compensates. Plan to run an eval suite (see `EvalSuite` in `src/evaluation/suite.ts`) that scores extraction against a human-labeled golden set before shipping to users.
- **Kuzu 0.11's GitHub repo was archived on 2025-10-10** in favor of separate docs/extensions repositories[7]. The library itself is MIT and actively released (v0.11.3, Oct 2025), but watch for governance changes — if development slows, the openCypher subset makes migration to Neo4j/Memgraph realistic.
- **Community detection is stochastic.** Leiden/Louvain results shift with resolution parameter and random seed. Persist community IDs as seeded-stable values and rebuild on a schedule, not on every edit.
- **Global search can balloon tokens.** MS-GraphRAG global queries used ~40,000 tokens vs. ~900 for vector RAG on equivalent benchmarks[10]. Cap community summaries aggressively and rerank before sending.
- **The extractor will hallucinate relationships** under pressure (long inputs, ambiguous pronouns). Mitigate with per-edge `confidence`, a confidence floor at retrieval time, and always-cite-your-source output.
- **Not a substitute for vector RAG on narrow lookups.** When the query is "what's the npm command to install kuzu?", vector search is faster and cheaper than any graph walk[10]. The retriever must route; don't push all traffic through the graph.

---

## Proposed Example: `examples/context-graph/`

Based on user interest in both cross-session recall *and* a research/scraping agent, the cleanest example combines both in a single worked walkthrough. Call it **"Research Librarian"**.

### Shape

A CLI-driven agent that:

1. **Ingests** URLs via the existing `url-tools` (`wgetTool`, `markifyTool`) and writes entities + relationships to the context graph as it scrapes.
2. **Ingests** prior umwelten sessions via the existing `session-digester` output — so past conversations about the same topics become graph nodes.
3. **Answers** questions in both modes: specific ("what's kuzu's vector index API?" → local retrieval) and thematic ("summarize what I've learned about embedded graph DBs this month" → global retrieval over communities).
4. **Evaluates** itself with an `EvalSuite` that scores answer quality against a frozen gold set with and without the graph — demonstrating *when* graphs help.

### File layout (mirrors `examples/model-showdown/`)

```
examples/context-graph/
  README.md                    # narrative walkthrough
  suite-config.ts              # EvalDimension[] for the combined eval
  ingest-urls.ts               # one-shot: read a seed URL list, scrape, populate graph
  ingest-sessions.ts           # one-shot: walk ~/.umwelten/digests, populate graph
  librarian.ts                 # the REPL agent (Interaction + graph tools)
  eval/
    questions.json             # 20 Qs: 10 local, 10 global
    with-graph-eval.ts         # librarian WITH graph_query tool
    without-graph-eval.ts      # same questions, vector-only
    judge.ts                   # LLM judge (JudgeTask from EvalSuite)
  shared/
    models.ts                  # pin the extraction + judge + chat models
    graph-store.ts             # per-example Kuzu DB at ./data/graph.kuzu
```

### The teaching beats

1. **Day 1 — no graph, just a librarian:** Build the agent with only `url-tools` + vector RAG. Show it failing on a multi-hop question ("which of these papers disagree about X?"). This is the motivating failure.
2. **Day 2 — add the graph:** Register `graphQueryTool` + `graphAddObservationTool`. Re-run the same question. Show the agent walking 2 hops through the graph to find the contradiction. Show the `EvalSuite` scores jump on multi-hop Qs and stay flat on single-hop Qs.
3. **Day 3 — cross-session recall:** Run `ingest-sessions.ts` over the user's own `~/.umwelten/digests/`. Ask "what have I been learning about graph databases this month?" The global retriever returns a community summary drawn from sessions the user actually had. This is the umwelten-specific payoff — no other framework can do this without a manual ingest pipeline.
4. **Day 4 — observability:** Add a `graph view --community X` CLI subcommand that renders the graph to DOT/Mermaid. Let the user *see* why they got the answer they got.

### Why this example, specifically

- **It exercises every new primitive** (`GraphStore`, extractor, retriever, tools, community detection, compaction strategy) in one place — the README becomes a de facto design doc.
- **It produces a quantitative result** via `EvalSuite` — the pull request can include a before/after table showing where graphs help and where they don't, aligning with the project's evidence-driven culture.
- **It connects to existing work** (session-digester, url-tools, EvalSuite, CompactionStrategy) rather than sitting in a silo — maximizing the chance that other examples (like `jeeves-bot` or `gaia-ui`) adopt the graph subsystem later.
- **It gives users an immediate personal payoff** (Day 3 "what have I been learning") without any manual seeding, which is rare in GraphRAG examples.

### Success criteria for the example

- [ ] Extraction cost on 100 typical sessions < $1 total
- [ ] Local retrieval p95 < 100ms (Kuzu is fast; if we're slower, the bottleneck is us)
- [ ] Global retrieval p95 < 2s including community summary synthesis
- [ ] `EvalSuite` shows ≥15 percentage-point lift on the 10 multi-hop questions
- [ ] `EvalSuite` shows ≤3 percentage-point drop on the 10 single-hop questions (graphs shouldn't *hurt* simple lookups by more than the routing cost)
- [ ] `pnpm run example:context-graph` works end-to-end with only an API key in `.env`

---

## References

[1] [Microsoft GraphRAG Documentation](https://microsoft.github.io/graphrag/) — Official docs; indexing pipeline stages (text segmentation, entity extraction, Leiden clustering, community summarization), query modes (global, local, DRIFT, basic), and cost guidance. Also [Microsoft Research project page](https://www.microsoft.com/en-us/research/project/graphrag/) for the paper abstract.

[2] [GraphRAG Complete Guide 2026 — Calmops](https://calmops.com/ai/graphrag-complete-guide-2026/) — Accuracy benchmarks (86% vs. 32% baseline RAG) and 2026-era cost/latency trade-offs.

[3] [nano-graphrag GitHub](https://github.com/gusye1234/nano-graphrag) — 3.8k stars, MIT, ~1,100 LOC Python reference implementation. Storage backends: nano-vectordb / hnswlib / neo4j / networkx.

[4] [HippoRAG GitHub (OSU-NLP-Group)](https://github.com/OSU-NLP-Group/HippoRAG) — NeurIPS'24. Personalized PageRank over entity graphs; 10–20× cheaper than iterative retrieval at comparable accuracy. Also [HippoRAG paper arXiv](https://arxiv.org/abs/2405.14831).

[5] [LightRAG GitHub (HKUDS)](https://github.com/HKUDS/LightRAG) — 34k stars, MIT, EMNLP'25. Dual-level retrieval (low/high); ~6000× cheaper indexing than MS-GraphRAG on comparable corpora. Also [LightRAG arXiv paper](https://arxiv.org/html/2410.05779v1).

[6] [Mem0: Graph Memory Solutions Analysis](https://mem0.ai/blog/graph-memory-solutions-ai-agents) — January 2026 comparison of Mem0, LangMem, Letta, Zep, Supermemory. Mem0g performance vs. vector-only. And [Graph Memory with mem0-falkordb](https://www.falkordb.com/blog/graph-memory-llm-agents-mem0-falkordb/) for the FalkorDB integration.

[7] [Kuzu GitHub](https://github.com/kuzudb/kuzu) — 3.9k stars, MIT, v0.11.3 (Oct 2025). Embedded property graph, Cypher, native vector + FTS indexes. Note: main repo archived Oct 2025, development moved to separate repos.

[8] [Kuzu Node.js API Docs](https://kuzudb.github.io/api-docs/nodejs/) — `npm install kuzu`, `Database`/`Connection`/`QueryResult` classes, CJS + ESM support.

[9] [LightRAG vs GraphRAG vs HippoRAG comparison](https://medium.com/graph-praxis/graphrag-vs-hipporag-vs-pathrag-vs-og-rag-choosing-the-right-architecture-for-your-knowledge-graph-a4745e8b125f) — 2026 architectural comparison; when each wins on which query patterns.

[10] [When to use Graphs in RAG (arXiv 2506.05690)](https://arxiv.org/html/2506.05690v3) — 2026 empirical analysis. GraphRAG wins on multi-hop reasoning and contextual summarization; vector RAG wins on simple fact retrieval. Token overhead ratios (~40k vs. ~900) on equivalent benchmarks.

[11] [Property Graph Index — LlamaIndex](https://docs.llamaindex.ai/en/stable/module_guides/indexing/lpg_index_guide/) — Reference design for pluggable kg_extractors and schema-guided extraction (informs the `GraphExtractor` API shape).

[12] [GraphRAG with KùzuDB — Data Lab Tech TV](https://datalabtechtv.com/posts/graphrag-with-kuzudb/) — Worked GraphRAG example on Kuzu; validates the architecture choice.

[13] [kuzu-memory GitHub](https://github.com/bobmatnyc/kuzu-memory) — Production LLM memory built on Kuzu. Informs the cognitive-type taxonomy for `Entity.type`.

[14] [DuckPGQ (DuckDB SQL/PGQ extension)](https://duckpgq.org/) — Alternative graph-over-relational approach; considered and rejected for Node integration reasons.

[15] [How to Build Lightweight GraphRAG with SQLite](https://dev.to/stephenc222/how-to-build-lightweight-graphrag-with-sqlite-53le) — Considered SQLite-based approach; suitable for 100–1000 docs, ceiling lower than Kuzu.
