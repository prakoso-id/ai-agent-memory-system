# ðŸ§  AI Agent Memory System

A **multi-layer cognitive memory service** for AI agents. Provides persistent memory storage, semantic retrieval, knowledge graphs, reflection-based learning, and adaptive context optimization â€” accessible via REST API.

> **Use this as a standalone memory backend for any AI agent project.**

---

## Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Your AI Agent Project                         â”‚
â”‚  (PM Agent, Content Planner, Chatbot, etc.)    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                   â”‚ REST API (HTTP)
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Memory System API (localhost:3001)            â”‚
â”‚                                                â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚ Working  â”‚ â”‚ Episodic â”‚ â”‚ Semantic Searchâ”‚  â”‚
â”‚  â”‚  (Redis) â”‚ â”‚   (PG)   â”‚ â”‚   (Qdrant)     â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚
â”‚  â”‚ Knowledge    â”‚ â”‚ Reflection Engine      â”‚   â”‚
â”‚  â”‚ Graph (Neo4j)â”‚ â”‚ (learns from history)  â”‚   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚
â”‚                                                â”‚
â”‚  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â• Phase 2 â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•— â”‚
â”‚  â•‘  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â•‘ â”‚
â”‚  â•‘  â”‚ Feedback    â”‚  â”‚ Context Builder   â”‚   â•‘ â”‚
â”‚  â•‘  â”‚ Tracker     â”‚  â”‚ (token-aware)     â”‚   â•‘ â”‚
â”‚  â•‘  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â•‘ â”‚
â”‚  â•‘  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â•‘ â”‚
â”‚  â•‘  â”‚ Strategy    â”‚  â”‚ Behavior Engine   â”‚   â•‘ â”‚
â”‚  â•‘  â”‚ Memory      â”‚  â”‚ (reflectionâ†’act)  â”‚   â•‘ â”‚
â”‚  â•‘  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â•‘ â”‚
â”‚  â•‘  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â•‘ â”‚
â”‚  â•‘  â”‚ Context Compressor (rawâ†’sumâ†’insight)â”‚  â•‘ â”‚
â”‚  â•‘  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â•‘ â”‚
â”‚  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• â”‚
â”‚                                                â”‚
â”‚  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â• Phase 3 â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•— â”‚
â”‚  â•‘  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â•‘ â”‚
â”‚  â•‘  â”‚ Conflict    â”‚  â”‚ Confidence        â”‚   â•‘ â”‚
â”‚  â•‘  â”‚ Detector    â”‚  â”‚ Scorer            â”‚   â•‘ â”‚
â”‚  â•‘  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â•‘ â”‚
â”‚  â•‘  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â•‘ â”‚
â”‚  â•‘  â”‚ Hypothesis  â”‚  â”‚ Evaluation        â”‚   â•‘ â”‚
â”‚  â•‘  â”‚ Manager     â”‚  â”‚ Tracker           â”‚   â•‘ â”‚
â”‚  â•‘  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â•‘ â”‚
â”‚  â•‘  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â•‘ â”‚
â”‚  â•‘  â”‚ Memory Promoter (episodicâ†’semantic) â”‚  â•‘ â”‚
â”‚  â•‘  â”‚ + Semantic Decay & Archival         â”‚  â•‘ â”‚
â”‚  â•‘  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â•‘ â”‚
â”‚  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Memory Layers

| Layer | Storage | Purpose | TTL |
|-------|---------|---------|-----|
| **Working** | Redis | Current conversation context | 1 hour |
| **Episodic** | PostgreSQL | Every interaction (who said what) | Permanent |
| **Semantic** | Qdrant | Extracted facts with vector embeddings | Permanent |
| **Knowledge Graph** | Neo4j | Entity relationships (Userâ†’prefersâ†’TypeScript) | Permanent |
| **Reflection** | PostgreSQL | Learned lessons & strategy improvements | Permanent |
| **Strategy** *(Phase 2)* | PostgreSQL | Reusable behavioral patterns | Permanent |

### Retrieval Scoring

Composite multi-signal scoring with adaptive weights:

```
totalScore = wâ‚ Ã— semantic_similarity
           + wâ‚‚ Ã— recency
           + wâ‚ƒ Ã— importance
           + wâ‚„ Ã— task_relevance
           + wâ‚… Ã— usage_popularity
           Ã— feedback_boost(memory_id)
```

**Default weights** (Phase 1): `wâ‚=0.35  wâ‚‚=0.25  wâ‚ƒ=0.20  wâ‚„=0.10  wâ‚…=0.10`

**Adaptive weights** (Phase 2): Shift automatically based on retrieval feedback signals. When results are frequently unhelpful, the system boosts importance + recency; when consistently helpful, it reinforces semantic similarity.

**Feedback boost**: Per-memory multiplier from `0.5` (consistently unhelpful) to `1.5` (consistently helpful), with Bayesian smoothing.

---

## Development Phases

### Phase 1 â€” Foundation: Filtering & Smart Retrieval

> `865f89b` feat(memory): implement Phase 1 foundation (filtering & smart retrieval)

Built the intelligent retrieval pipeline that makes memory useful, not just stored.

| Feature | Description | Files |
|---------|-------------|-------|
| **Write Filter** | Discard noise â€” memories below importance `0.15` are never stored | `utils/write-filter.ts` |
| **Duplicate Detection** | Semantic dedup via cosine similarity (`â‰¥0.92`). Duplicates bump `usage_count` instead of creating new records | `semantic-memory.ts` |
| **Context-Aware Retrieval** | `taskType` inference (`coding`, `planning`, `chat`, `debugging`) biases scoring toward relevant tags | `utils/task-relevance.ts` |
| **Multi-Stage Reranker** | Stage 1: Vector search â†’ Stage 2: Source filter â†’ Stage 3: Composite score (5 signals) | `utils/reranker.ts` |
| **Unified Query API** | `memory.query({ task, context, taskType })` â€” single entry-point to all memory layers | `memory-manager.ts` |

**Test suites (5):**

| Test | Scenario | Tests |
|------|----------|-------|
| TC-001 | Write filter rejects noise, stores important facts | 7 |
| TC-002 | Duplicate detection via `usage_count` increment | 7 |
| TC-003 | Context-aware retrieval reranks by `taskType` | 8 |
| TC-004 | Composite score balances importance + popularity vs recency | 8 |
| TC-005 | Edge cases: non-duplicate + irrelevance exclusion | 9 |

---

### Phase 2 â€” Adaptive Learning & Context Optimization

Built the learning loop that makes the agent improve over time:

| Module | Description | Files |
|--------|-------------|-------|
| **Feedback Tracker** | Records per-memory `used/helpful` feedback. Computes per-memory boost (`0.5â€“1.5Ã—`) and adaptive reranking weights from aggregate signals | `feedback-tracker.ts` |
| **Strategy Memory** | Stores reusable patterns like *"comparison tables work better than prose"* with effectiveness tracking (EMA, Î±=0.2) and domain classification | `strategy-memory.ts` |
| **Context Compression** | Hierarchical compression pipeline: `raw â†’ summary â†’ insight`. Budget-aware batch compression starts with lowest-scored memories first | `context-compression.ts` |
| **Behavior Engine** | Bridges reflections to action. Extracts `retrieval_bias`, `prompt_style`, `content_preference` directives from reflection data via LLM | `behavior-engine.ts` |
| **Context Builder** | Main Phase 2 consumer API. Orchestrates: retrieval â†’ priority sorting â†’ strategy injection â†’ directive injection â†’ token-budgeted compression | `context-builder.ts` |

**New database tables:**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `retrieval_feedback` | Adaptive scoring signal | `memory_id`, `used`, `helpful` |
| `strategy_memories` | Reusable patterns | `pattern`, `effectiveness`, `domain` |
| `behavioral_directives` | Reflection-to-behavior bridge | `type`, `directive`, `weight`, `active` |

**Updated modules:**

| Module | Changes |
|--------|---------|
| `reranker.ts` | Accepts adaptive weights + per-memory feedback boosts |
| `memory-manager.ts` | Wires FeedbackTracker + StrategyMemory into retrieval pipeline |
| `prompt-builder.ts` | `buildMessagesFromContext(BuiltContext)` with strategy & directive prompt sections |
| `reflection-engine.ts` | Auto-extracts behavioral directives and reusable strategies from reflections |
| `agent-controller.ts` | Uses ContextBuilder for token-aware context assembly |

**Context Builder API:**

```typescript
const ctx = await contextBuilder.buildContext({
  query: 'fix TypeScript error in auth handler',
  max_tokens: 2048,
  priority: ['relevant', 'important', 'recent'],
  include_strategies: true,
  include_directives: true,
});
// Returns: { memories, strategies, directives, totalTokens, compressionApplied }
```

**Test suites (3):**

| Test | Scenario | Tests |
|------|----------|-------|
| TC-006 | Adaptive learning: feedback boosts shift retrieval rankings (A-boost=1.42 vs B-boost=0.64, 50% score gap) | 10 |
| TC-007 | Reflection impact: directives extracted from reflections shape prompt assembly | 15 |
| TC-008 | Context compression: 8 memories compressed to fit 200-token budget via hierarchical summarization | 16 |

---

### Phase 3 â€” Memory Evolution & Evaluation

Built the self-evolving memory layer that makes the system improve autonomously:

| Module | Description | Files |
|--------|-------------|-------|
| **Conflict Detector** | Detects contradictory/outdated/ambiguous memories via semantic similarity + LLM classification. Flags conflicts without deleting | `conflict-detector.ts` |
| **Confidence Scorer** | 4-signal confidence system: usage frequency, conflict consistency, source reliability tiers, recency decay. Weights: `0.30 / 0.25 / 0.25 / 0.20` | `confidence-scorer.ts` |
| **Hypothesis Manager** | Groups conflicting memories as competing perspectives. Auto-transitions: `open â†’ leaning (>0.7) â†’ resolved (>0.8 + 3 evidence)` | `hypothesis-manager.ts` |
| **Evaluation Tracker** | Records per-query retrieval quality. Computes hit rate, success rate, per-memory usefulness, and trend detection (current vs previous period) | `evaluation-tracker.ts` |
| **Memory Promoter** | Promotes frequently-used memories: episodicâ†’semantic (usageâ‰¥5, importanceâ‰¥0.6) and semanticâ†’knowledge graph (usageâ‰¥10, confidenceâ‰¥0.7) via LLM extraction | `memory-promoter.ts` |

**New database tables:**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `memory_conflicts` | Conflict tracking between memories | `memory_id_a`, `memory_id_b`, `conflict_type`, `status` |
| `evaluation_records` | Retrieval quality metrics | `query_id`, `retrieved_memory_ids`, `success`, `hit_rate` |
| `promotion_events` | Memory promotion audit trail | `memory_id`, `from_layer`, `to_layer`, `reason` |

**Qdrant payload additions** (backward-compatible):

| Field | Default | Purpose |
|-------|---------|--------|
| `confidence` | `0.5` | Composite confidence score â€” multiplies retrieval score |
| `decay_factor` | `1.0` | Time-based decay multiplier â€” reduced during consolidation |
| `conflict_group` | `null` | Links conflicting memories together |
| `archived` | `false` | Soft-delete flag â€” archived memories excluded from search |

**Updated modules:**

| Module | Changes |
|--------|---------|
| `semantic-memory.ts` | Stores confidence/decay/archived payload fields. Search excludes archived. Score multiplied by confidence Ã— decay_factor |
| `memory-consolidation.ts` | Added semantic decay (confidence-gated) and stale memory archival |
| `reranker.ts` | Accepts `confidenceBoosts` map for confidence-weighted ranking |
| `memory-manager.ts` | Wires all Phase 3 modules. Adds conflict detection after semantic store, promotion in consolidation cycles |
| `agent-controller.ts` | Records evaluation data after each chat response |

**Confidence scoring formula:**

```
confidence = 0.30 Ã— min(1, usage_count/15)
           + 0.25 Ã— (1 - conflicts/(conflicts+3))
           + 0.25 Ã— source_tier(api=1.0, reflection=0.8, episode=0.6, unknown=0.3)
           + 0.20 Ã— exp(-0.005 Ã— age_hours)
```

**Memory decay formula:**

```
new_decay = old_decay Ã— exp(-rate Ã— age_days / (1 + confidence))
```

High-confidence memories decay slower (denominator `1 + confidence`).

**Promotion rules:**

```
Episodic â†’ Semantic:
  usage_count â‰¥ 5  AND  importance â‰¥ 0.6
  â†’ LLM extracts core fact â†’ stored as semantic memory

Semantic â†’ Knowledge Graph:
  usage_count â‰¥ 10  AND  confidence â‰¥ 0.7
  â†’ LLM extracts entity-relationship triples â†’ added to Neo4j
```

**Test suites (3):**

| Test | Scenario | Tests |
|------|----------|-------|
| TC-009 | Conflict detection, confidence scoring, source reliability, hypothesis lifecycle | 15 |
| TC-010 | Evaluation tracking, metrics computation, semantic decay, stale archival, trend detection | 15 |
| TC-011 | Episodicâ†’semantic promotion, semanticâ†’KG promotion, audit trail, threshold rejection | 12 |

---

### Phase 4 â€” Observability, Scalability & Efficiency

Built the production-readiness layer: semantic caching, multi-agent role partitioning, and a full observability dashboard.

| Module | Description | Files |
|--------|-------------|-------|
| **Observability Service** | Captures retrieval latency samples in a Redis ring buffer (p50). Aggregates `DashboardMetrics` snapshot: cache hit rate, conflict frequency, promotion rate, role distribution. Generates self-healing advisories when metrics cross thresholds | `observability-service.ts` |
| **Semantic Cache** | Redis-backed LLM call deduplication. Two-stage lookup: exact SHA-256 hash fast-path, then cosine-similarity scan (threshold `0.95`). gzip-compresses stored responses. LRU eviction when `maxEntries` is reached | `semantic-cache.ts` |
| **Role Memory Service** | Partitions the shared Qdrant collection by agent role (`coder`, `pm`, `qa`, `analyst`, `general`). Stores per-role importance weights (`importance_per_role`). Injects a role-relevance dimension into the composite rerank score | `role-memory.ts` |
| **Dashboard** | React + Vite frontend with 4 tabs: Knowledge Graph (D3 force-directed), Memory Browser (filterable table with archive/delete/importance controls), Timeline, and Observability Metrics panel | `dashboard/` |

**New `MemoryManager` methods (Phase 4):**

| Method | Description |
|--------|-------------|
| `cachedQuery(input, llmCall?)` | `query()` wrapped with semantic cache. Returns `{ memories, llmResponse, cacheHit }` |
| `roleQuery(input)` | Role-scoped retrieval â€” filters and reranks by `agentRole` |
| `getDashboardMetrics()` | Full `DashboardMetrics` snapshot for the dashboard |
| `getAdvisories()` | List of self-healing improvement suggestions |

**New `MemoryManager` public properties (Phase 4):**

| Property | Type | Description |
|----------|------|-------------|
| `cache` | `SemanticCache` | Direct access to cache (`get`, `set`, `flush`, `invalidate`, `getStats`) |
| `roles` | `RoleMemoryService` | Direct access to role store (`store`, `query`, `listByRole`, `updateRoleImportance`, `getRoleDistribution`) |
| `observability` | `ObservabilityService` | Direct access to latency tracking and advisory generation |

**Qdrant payload additions** (backward-compatible, added on top of Phase 3 fields):

| Field | Default | Purpose |
|-------|---------|--------|
| `roles` | `[]` | Which agent roles can see this memory (empty = all roles) |
| `importance_per_role` | `{}` | Per-role importance override map (`{ coder: 0.9, pm: 0.2 }`) |

**`cachedQuery()` API:**

```typescript
// Cache miss â€” LLM is called, response stored in Redis
const result = await memory.cachedQuery(
  { task: 'webpack production config', taskType: 'coding' },
  async () => 'Use mode: "production" and enable TerserPlugin.',
);
console.log(result.cacheHit);       // false (first call)
console.log(result.llmResponse);    // 'Use mode: "production"...'

// Semantically similar query â€” cache hit, LLM NOT called
const result2 = await memory.cachedQuery(
  { task: 'best webpack config for prod', taskType: 'coding' },
);
console.log(result2.cacheHit);      // true
```

**`roleQuery()` API:**

```typescript
const results = await memory.roleQuery({
  task:      'TypeScript compile errors',
  agentRole: 'coder',
  taskType:  'coding',
  limit: 5,
});
// Returns memories with role-boosted composite scores
```

**Phase 4 gap fix:** `confidenceBoosts` from Phase 3 are now correctly wired into `rerank()` â€” memories with high confidence scores now properly rank higher.

**Test suites (3):**

| Test | Scenario | Tests |
|------|----------|-------|
| TC-012 | Semantic cache: cold miss, exact-hash hit, semantic similarity hit, no false positives, invalidation, flush, stats counters | 7 |
| TC-013 | Role-based partitioning: role-annotated storage, coder/PM role queries, universal access (empty roles), role importance update, listByRole filtering | 6 |
| TC-014 | Observability: latency ring buffer + p50, DashboardMetrics shape, advisory generation, cachedQuery missâ†’hit, logEvent safety, role distribution | 8 |

---

## Quick Start

### 1. Prerequisites

- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- [Docker](https://docker.com) + Docker Compose
- [LM Studio](https://lmstudio.ai) (local LLM) or OpenRouter API key

### 2. Setup

```bash
# Clone
git clone https://github.com/prakoso-id/ai-agent-memory-system.git
cd ai-agent-memory-system

# Install dependencies
bun install

# Start databases (Redis, PostgreSQL, Qdrant, Neo4j)
docker compose up -d

# Configure environment
cp .env.example .env
# Edit .env â€” set your LLM model names (must match exactly what LM Studio shows)

# Initialize database schemas
bun run db:init
```

### 3. Run

```bash
# API Server (for other projects to consume)
bun run server
# â†’ http://localhost:3001

# CLI mode (interactive chat)
bun run dev
```

### 4. Test

```bash
# Run all tests (14 suites, 143 tests)
bun run test

# Run individual Phase 1 tests
bun run test:tc001    # Write filter
bun run test:tc002    # Duplicate detection
bun run test:tc003    # Context-aware retrieval
bun run test:tc004    # Composite scoring
bun run test:tc005    # Edge cases

# Run individual Phase 2 tests
bun run test:tc006    # Adaptive learning
bun run test:tc007    # Reflection impact
bun run test:tc008    # Context compression

# Run individual Phase 3 tests
bun run test:tc009    # Conflict detection & confidence
bun run test:tc010    # Evaluation tracking & decay
bun run test:tc011    # Memory promotion

# Run Phase 4 tests
bun run test:tc012    # Semantic cache
bun run test:tc013    # Role-based memory
bun run test:tc014    # Observability & metrics
bun run test:phase4   # All Phase 4 suites at once

# Run examples
bun run example:phase1
bun run example:phase2
bun run example:phase3
bun run example:phase4

# Run dashboard (dev)
bun run dashboard:dev
# â†’ http://localhost:5173
```

---

## API Reference

**Base URL:** `http://localhost:3001`
**Auth:** All endpoints (except health) require `Authorization: Bearer <API_KEY>`

### Health Check

```http
GET /api/health
```

```json
{ "status": "ok", "version": "1.0.0", "sessions": 2 }
```

---

### Sessions

#### Create Session

```http
POST /api/sessions
Authorization: Bearer <API_KEY>
Content-Type: application/json

{ "session_id": "optional-custom-id" }
```

**Response:**
```json
{ "sessionId": "4ab0c57c-32c4-4974-89f3-583187a0421e", "created": true }
```

#### List Sessions

```http
GET /api/sessions
Authorization: Bearer <API_KEY>
```

**Response:**
```json
{
  "count": 2,
  "sessions": [
    {
      "sessionId": "4ab0c57c-...",
      "createdAt": "2026-03-10T11:25:37.808Z",
      "lastActivity": "2026-03-10T11:27:09.939Z",
      "interactionCount": 5
    }
  ]
}
```

#### Get Session Details

```http
GET /api/sessions/:id
Authorization: Bearer <API_KEY>
```

#### Delete Session

```http
DELETE /api/sessions/:id
Authorization: Bearer <API_KEY>
```

---

### Chat

#### Streaming Chat (SSE)

Real-time token-by-token response via Server-Sent Events.

```http
POST /api/chat
Authorization: Bearer <API_KEY>
Content-Type: application/json

{ "session_id": "4ab0c57c-...", "message": "Hello, my name is Jackson" }
```

**SSE Response stream:**
```
data: {"type":"session","sessionId":"4ab0c57c-..."}

data: {"type":"memory","count":3,"topScore":0.775}

data: {"type":"token","content":"Hello"}

data: {"type":"token","content":" Jackson"}

data: {"type":"token","content":"!"}

data: {"type":"done","fullResponse":"Hello Jackson! ..."}
```

#### Sync Chat (JSON)

Full response in one JSON object (simpler, but waits for complete response).

```http
POST /api/chat/sync
Authorization: Bearer <API_KEY>
Content-Type: application/json

{ "session_id": "4ab0c57c-...", "message": "What is my name?" }
```

**Response:**
```json
{
  "sessionId": "4ab0c57c-...",
  "response": "Your name is Jackson!"
}
```

---

### Memory

#### Store a Fact Directly

```http
POST /api/memory/store
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "session_id": "4ab0c57c-...",
  "content": "User prefers dark mode and Vim keybindings",
  "category": "user_preference",
  "importance": 0.9
}
```

**Categories:** `user_identity`, `user_preference`, `project_fact`, `general_knowledge`, `technical_detail`

**Response:**
```json
{ "stored": true, "id": "a1b2c3d4-..." }
```

#### Semantic Search

```http
POST /api/memory/search
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "session_id": "4ab0c57c-...",
  "query": "what tools does the user prefer?",
  "limit": 5,
  "min_score": 0.1
}
```

**Response:**
```json
{
  "query": "what tools does the user prefer?",
  "count": 3,
  "results": [
    {
      "source": "semantic",
      "content": "User prefers TypeScript and dark mode",
      "score": 0.82,
      "importance": 0.9,
      "timestamp": "2026-03-10T11:25:37.808Z"
    }
  ]
}
```

#### Memory Statistics

```http
GET /api/memory/stats?session_id=4ab0c57c-...
Authorization: Bearer <API_KEY>
```

**Response:**
```json
{
  "episodic": 12,
  "semantic": 8,
  "reflections": 2,
  "graphNodes": 15,
  "strategies": 3,
  "interactions": 12
}
```

#### Knowledge Graph Query

```http
GET /api/memory/graph?session_id=4ab0c57c-...&q=TypeScript
Authorization: Bearer <API_KEY>
```

**Response:**
```json
{
  "query": "TypeScript",
  "count": 2,
  "nodes": [
    { "id": "...", "name": "TypeScript", "label": "Technology", "properties": {} },
    { "id": "...", "name": "Jackson", "label": "User", "properties": {} }
  ]
}
```

---

### Phase 4 Endpoints

#### GET `/api/dashboard/metrics` â€” Observability snapshot

```http
GET /api/dashboard/metrics?session_id=4ab0c57c-...
Authorization: Bearer <API_KEY>
```

**Response:**
```json
{
  "metrics": {
    "cacheHitRate": 0.42,
    "cacheEntries": 87,
    "avgRetrievalLatencyMs": 145,
    "conflictFrequency": 0.03,
    "promotionRate": 0.08,
    "roleDistribution": { "coder": 12, "pm": 5, "general": 28 }
  }
}
```

#### GET `/api/dashboard/advisories` â€” Self-healing suggestions

```http
GET /api/dashboard/advisories?session_id=4ab0c57c-...
Authorization: Bearer <API_KEY>
```

**Response:**
```json
{
  "advisories": [
    "Cache hit rate is 0% â€” check embedding model availability.",
    "High conflict frequency (15 conflicts). Consider running consolidation.",
    "Avg retrieval latency 600ms exceeds 500ms threshold."
  ]
}
```

#### GET `/api/dashboard/graph` â€” Dashboard knowledge graph

```http
GET /api/dashboard/graph?q=user&limit=80
Authorization: Bearer <API_KEY>
```

#### GET `/api/dashboard/memories` â€” Paginated + filtered memory list

```http
GET /api/dashboard/memories?limit=50&topic=typescript&agent_role=coder&min_confidence=0.5
Authorization: Bearer <API_KEY>
```

**Query params (all optional):** `topic`, `min_confidence`, `max_confidence`, `conflict_status` (`none|detected|resolved`), `agent_role` (`coder|pm|qa|analyst|general`), `archived`, `limit` (default 50), `offset` (default 0).

#### PATCH `/api/dashboard/memories/:id` â€” Update memory fields

```http
PATCH /api/dashboard/memories/a1b2c3d4-...
Authorization: Bearer <API_KEY>
Content-Type: application/json

{ "importance": 0.95, "archived": false, "role_importance": { "role": "coder", "value": 0.9 } }
```

#### DELETE `/api/dashboard/memories/:id` â€” Hard-delete a memory

```http
DELETE /api/dashboard/memories/a1b2c3d4-...
Authorization: Bearer <API_KEY>
```

#### GET `/api/dashboard/cache/stats` â€” Semantic cache statistics

```http
GET /api/dashboard/cache/stats
Authorization: Bearer <API_KEY>
```

**Response:**
```json
{
  "cache": {
    "totalEntries": 87,
    "hitRate": 0.42,
    "totalHits": 210,
    "totalMisses": 290,
    "avgSimilarityOnHit": 0.97
  }
}
```

#### DELETE `/api/dashboard/cache` â€” Flush entire cache

```http
DELETE /api/dashboard/cache
Authorization: Bearer <API_KEY>
```

#### DELETE `/api/dashboard/cache/:id` â€” Invalidate single cache entry

```http
DELETE /api/dashboard/cache/entry-id-here
Authorization: Bearer <API_KEY>
```

#### GET `/api/dashboard/roles/:role/memories` â€” Role-scoped memory list

```http
GET /api/dashboard/roles/coder/memories?limit=20
Authorization: Bearer <API_KEY>
```

**`role` values:** `coder` | `pm` | `qa` | `analyst` | `general`

---

## Integration Guide

### JavaScript / TypeScript

```typescript
const MEMORY_API = 'http://localhost:3001';
const API_KEY = 'dev-key-change-me';

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

// 1. Create a session
const { sessionId } = await fetch(`${MEMORY_API}/api/sessions`, {
  method: 'POST', headers,
}).then(r => r.json());

// 2. Chat (sync)
const { response } = await fetch(`${MEMORY_API}/api/chat/sync`, {
  method: 'POST', headers,
  body: JSON.stringify({ session_id: sessionId, message: 'Hello, my name is Jackson' }),
}).then(r => r.json());

// 3. Chat (streaming via SSE)
const res = await fetch(`${MEMORY_API}/api/chat`, {
  method: 'POST', headers,
  body: JSON.stringify({ session_id: sessionId, message: 'What do I like?' }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const event = JSON.parse(line.slice(6));
      if (event.type === 'token') {
        process.stdout.write(event.content); // print token-by-token
      }
    }
  }
}

// 4. Search memories
const { results } = await fetch(`${MEMORY_API}/api/memory/search`, {
  method: 'POST', headers,
  body: JSON.stringify({ session_id: sessionId, query: 'user preferences' }),
}).then(r => r.json());

// 5. Store a fact directly
await fetch(`${MEMORY_API}/api/memory/store`, {
  method: 'POST', headers,
  body: JSON.stringify({
    session_id: sessionId,
    content: 'User deadline is March 30',
    category: 'project_fact',
    importance: 0.9,
  }),
});
```

### Python

```python
import requests
import json

API = "http://localhost:3001"
HEADERS = {
    "Authorization": "Bearer dev-key-change-me",
    "Content-Type": "application/json"
}

# Create session
session = requests.post(f"{API}/api/sessions", headers=HEADERS).json()
sid = session["sessionId"]

# Sync chat
resp = requests.post(f"{API}/api/chat/sync", headers=HEADERS, json={
    "session_id": sid,
    "message": "Hello, my name is Jackson and I love Python"
}).json()
print(resp["response"])

# Streaming chat
resp = requests.post(f"{API}/api/chat", headers=HEADERS, json={
    "session_id": sid,
    "message": "What is my name?"
}, stream=True)

for line in resp.iter_lines():
    if line and line.startswith(b"data: "):
        event = json.loads(line[6:])
        if event["type"] == "token":
            print(event["content"], end="", flush=True)
print()

# Search
results = requests.post(f"{API}/api/memory/search", headers=HEADERS, json={
    "session_id": sid,
    "query": "user name"
}).json()
print(results)
```

### cURL

```bash
# Health check
curl http://localhost:3001/api/health

# Create session
curl -X POST http://localhost:3001/api/sessions \
  -H "Authorization: Bearer dev-key-change-me"

# Chat (sync)
curl -X POST http://localhost:3001/api/chat/sync \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","message":"Hello!"}'

# Chat (streaming)
curl -N -X POST http://localhost:3001/api/chat \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","message":"What is my name?"}'

# Store fact
curl -X POST http://localhost:3001/api/memory/store \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","content":"User loves Golang","category":"user_preference","importance":0.9}'

# Semantic search
curl -X POST http://localhost:3001/api/memory/search \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","query":"what does the user like?"}'

# Stats
curl "http://localhost:3001/api/memory/stats?session_id=SESSION_ID" \
  -H "Authorization: Bearer dev-key-change-me"

# List sessions
curl http://localhost:3001/api/sessions \
  -H "Authorization: Bearer dev-key-change-me"
```

---

## Configuration

All settings are in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| **LLM** | | |
| `LLM_PROVIDER` | `lmstudio` | `lmstudio` or `openrouter` |
| `LLM_BASE_URL` | `http://localhost:1234/v1` | LLM API endpoint |
| `LLM_MODEL` | `qwen3.5-9b` | Chat model (must match LM Studio) |
| `EMBEDDING_MODEL` | `text-embedding-nomic-embed-text-v2-moe` | Embedding model (must match exactly) |
| **Server** | | |
| `API_PORT` | `3001` | HTTP server port |
| `API_KEYS` | `dev-key-change-me` | Comma-separated API keys |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| **Agent** | | |
| `MEMORY_RETRIEVAL_LIMIT` | `7` | Max memories per retrieval |
| `MEMORY_DECAY_FACTOR` | `0.01` | Exponential decay rate |
| `WORKING_MEMORY_TTL` | `3600` | Session TTL in seconds |
| **Context Builder** *(Phase 2)* | | |
| `CONTEXT_MAX_TOKENS` | `2048` | Token budget for context assembly |
| `COMPRESSION_THRESHOLD` | `0.7` | Compression trigger threshold |
| **Memory Evolution** *(Phase 3)* | | |
| `CONFLICT_SIMILARITY_THRESHOLD` | `0.75` | Cosine similarity threshold for conflict detection |
| `CONFIDENCE_DECAY_RATE` | `0.005` | Confidence time-decay rate (per hour) |
| `STALE_ARCHIVE_DAYS` | `30` | Days after which unused memories are archived |
| `PROMOTION_USAGE_THRESHOLD` | `5` | Min usage count for episodicâ†’semantic promotion |
| `PROMOTION_CONFIDENCE_THRESHOLD` | `0.7` | Min confidence for semanticâ†’KG promotion |

---

## Project Structure

```
src/
â”œâ”€â”€ server.ts                      # REST API server (Bun.serve)
â”œâ”€â”€ index.ts                       # CLI entry point
â”œâ”€â”€ config/index.ts                # Environment config
â”œâ”€â”€ api/
â”‚   â”œâ”€â”€ middleware.ts              # Auth, CORS, request logging
â”‚   â”œâ”€â”€ session-manager.ts        # Multi-session AgentController pool
â”‚   â””â”€â”€ routes/
â”‚       â”œâ”€â”€ chat.ts               # SSE streaming + sync chat
â”‚       â”œâ”€â”€ memory.ts             # Store, search, stats, graph
â”‚       â””â”€â”€ sessions.ts           # Session CRUD
â”œâ”€â”€ database/
â”‚   â”œâ”€â”€ connections.ts            # DB connection manager
â”‚   â””â”€â”€ init.ts                   # Schema initialization (Phase 1 + Phase 2 tables)
â”œâ”€â”€ llm/
â”‚   â””â”€â”€ llm-client.ts            # LLM client (chat, stream, embed, chatJSON)
â”œâ”€â”€ memory/
â”‚   â”œâ”€â”€ types.ts                  # Type definitions (all phases)
â”‚   â”œâ”€â”€ working-memory.ts         # Redis working memory
â”‚   â”œâ”€â”€ episodic-memory.ts        # PostgreSQL episodic memory
â”‚   â”œâ”€â”€ semantic-memory.ts        # Qdrant vector memory + dedup
â”‚   â”œâ”€â”€ knowledge-graph.ts        # Neo4j knowledge graph
â”‚   â”œâ”€â”€ reflection-memory.ts      # Reflection storage
â”‚   â”œâ”€â”€ memory-manager.ts         # Central orchestrator
â”‚   â”œâ”€â”€ memory-extraction.ts      # LLM knowledge extraction
â”‚   â”œâ”€â”€ memory-consolidation.ts   # Decay, merge, summarize
â”‚   â”œâ”€â”€ feedback-tracker.ts       # [Phase 2] Retrieval feedback + adaptive weights
â”‚   â”œâ”€â”€ strategy-memory.ts        # [Phase 2] Reusable pattern storage
â”‚   â”œâ”€â”€ context-compression.ts    # [Phase 2] Hierarchical compression (rawâ†’summaryâ†’insight)
â”‚   â”œâ”€â”€ conflict-detector.ts      # [Phase 3] Contradictory/outdated memory detection
â”‚   â”œâ”€â”€ confidence-scorer.ts      # [Phase 3] 4-signal confidence scoring
â”‚   â”œâ”€â”€ hypothesis-manager.ts     # [Phase 3] Multi-perspective conflict storage
â”‚   â”œâ”€â”€ evaluation-tracker.ts     # [Phase 3] Retrieval quality metrics
â”‚   â”œâ”€â”€ memory-promoter.ts        # [Phase 3] Episodicâ†’semanticâ†’KG promotion
â”‚   â””â”€â”€ utils/
â”‚       â”œâ”€â”€ reranker.ts           # Multi-signal composite scorer (adaptive)
â”‚       â”œâ”€â”€ task-relevance.ts     # Task-type inference + tag scoring
â”‚       â””â”€â”€ write-filter.ts       # Importance + novelty gate
â”œâ”€â”€ reflection/
â”‚   â”œâ”€â”€ reflection-engine.ts      # Post-task reflection + strategy extraction
â”‚   â””â”€â”€ behavior-engine.ts        # [Phase 2] Reflection â†’ behavioral directives
â”œâ”€â”€ agent/
â”‚   â”œâ”€â”€ agent-controller.ts       # Agent orchestration (chat + stream)
â”‚   â”œâ”€â”€ prompt-builder.ts         # Memory-augmented prompts (supports BuiltContext)
â”‚   â””â”€â”€ context-builder.ts        # [Phase 2] Token-aware context assembly
â”œâ”€â”€ examples/
â”‚   â”œâ”€â”€ phase1-usage.ts           # Phase 1 feature demo
â”‚   â”œâ”€â”€ phase2-usage.ts           # Phase 2 feature demo
â”‚   â””â”€â”€ phase3-usage.ts           # Phase 3 feature demo
â””â”€â”€ tests/
    â”œâ”€â”€ helpers.ts                # Shared test utilities + cleanup
    â”œâ”€â”€ tc-001.write-filter.test.ts
    â”œâ”€â”€ tc-002.dedup.test.ts
    â”œâ”€â”€ tc-003.context-aware.test.ts
    â”œâ”€â”€ tc-004.composite-score.test.ts
    â”œâ”€â”€ tc-005.edge-cases.test.ts
    â”œâ”€â”€ tc-006.adaptive-learning.test.ts    # [Phase 2]
    â”œâ”€â”€ tc-007.reflection-impact.test.ts    # [Phase 2]
    â”œâ”€â”€ tc-008.context-compression.test.ts  # [Phase 2]
    â”œâ”€â”€ tc-009.conflict-confidence.test.ts  # [Phase 3]
    â”œâ”€â”€ tc-010.evaluation-decay.test.ts     # [Phase 3]
    â””â”€â”€ tc-011.promotion.test.ts            # [Phase 3]
```

## Technical Summary

- **Runtime**: [Bun](https://bun.sh), Node.js
- **Language**: TypeScript
- **Backend**: REST API (Bun.serve), SSE Streaming
- **Database**: PostgreSQL, Redis, Qdrant (Vector DB), Neo4j (Graph DB)
- **DevOps**: Docker, Docker Compose
- **Testing**: Vitest (11 suites, 122 tests â€” all against real databases)
- **AI/LLM**: OpenAI SDK, LM Studio, OpenRouter, Vector Embeddings (Qdrant), Prompt Engineering
- **Key Patterns**: Adaptive retrieval scoring, hierarchical context compression, reflection-to-behavior pipeline, semantic deduplication, multi-stage reranking, conflict detection, confidence scoring, memory promotion lifecycle

## License

MIT
