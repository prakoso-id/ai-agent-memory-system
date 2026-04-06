# 🧠 AI Agent Memory System

A **multi-layer cognitive memory service** for AI agents. Provides persistent memory storage, semantic retrieval, knowledge graphs, reflection-based learning, and adaptive context optimization — accessible via REST API.

> **Use this as a standalone memory backend for any AI agent project.**

---

## Architecture

```
┌────────────────────────────────────────────────┐
│  Your AI Agent Project                         │
│  (PM Agent, Content Planner, Chatbot, etc.)    │
└──────────────────┬─────────────────────────────┘
                   │ REST API (HTTP)
┌──────────────────┴─────────────────────────────┐
│  Memory System API (localhost:3001)            │
│                                                │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Working  │ │ Episodic │ │ Semantic Search│  │
│  │  (Redis) │ │   (PG)   │ │   (Qdrant)     │  │
│  └──────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────────┐ ┌────────────────────────┐   │
│  │ Knowledge    │ │ Reflection Engine      │   │
│  │ Graph (Neo4j)│ │ (learns from history)  │   │
│  └──────────────┘ └────────────────────────┘   │
│                                                │
│  ╔══════════════ Phase 2 ════════════════════╗ │
│  ║  ┌─────────────┐  ┌───────────────────┐   ║ │
│  ║  │ Feedback    │  │ Context Builder   │   ║ │
│  ║  │ Tracker     │  │ (token-aware)     │   ║ │
│  ║  └─────────────┘  └───────────────────┘   ║ │
│  ║  ┌─────────────┐  ┌───────────────────┐   ║ │
│  ║  │ Strategy    │  │ Behavior Engine   │   ║ │
│  ║  │ Memory      │  │ (reflection→act)  │   ║ │
│  ║  └─────────────┘  └───────────────────┘   ║ │
│  ║  ┌─────────────────────────────────────┐  ║ │
│  ║  │ Context Compressor (raw→sum→insight)│  ║ │
│  ║  └─────────────────────────────────────┘  ║ │
│  ╚═══════════════════════════════════════════╝ │
│                                                │
│  ╔══════════════ Phase 3 ════════════════════╗ │
│  ║  ┌─────────────┐  ┌───────────────────┐   ║ │
│  ║  │ Conflict    │  │ Confidence        │   ║ │
│  ║  │ Detector    │  │ Scorer            │   ║ │
│  ║  └─────────────┘  └───────────────────┘   ║ │
│  ║  ┌─────────────┐  ┌───────────────────┐   ║ │
│  ║  │ Hypothesis  │  │ Evaluation        │   ║ │
│  ║  │ Manager     │  │ Tracker           │   ║ │
│  ║  └─────────────┘  └───────────────────┘   ║ │
│  ║  ┌─────────────────────────────────────┐  ║ │
│  ║  │ Memory Promoter (episodic→semantic) │  ║ │
│  ║  │ + Semantic Decay & Archival         │  ║ │
│  ║  └─────────────────────────────────────┘  ║ │
│  ╚═══════════════════════════════════════════╝ │
└────────────────────────────────────────────────┘
```

### Memory Layers

| Layer | Storage | Purpose | TTL |
|-------|---------|---------|-----|
| **Working** | Redis | Current conversation context | 1 hour |
| **Episodic** | PostgreSQL | Every interaction (who said what) | Permanent |
| **Semantic** | Qdrant | Extracted facts with vector embeddings | Permanent |
| **Knowledge Graph** | Neo4j | Entity relationships (User→prefers→TypeScript) | Permanent |
| **Reflection** | PostgreSQL | Learned lessons & strategy improvements | Permanent |
| **Strategy** *(Phase 2)* | PostgreSQL | Reusable behavioral patterns | Permanent |

### Retrieval Scoring

Composite multi-signal scoring with adaptive weights:

```
totalScore = w₁ × semantic_similarity
           + w₂ × recency
           + w₃ × importance
           + w₄ × task_relevance
           + w₅ × usage_popularity
           × feedback_boost(memory_id)
```

**Default weights** (Phase 1): `w₁=0.35  w₂=0.25  w₃=0.20  w₄=0.10  w₅=0.10`

**Adaptive weights** (Phase 2): Shift automatically based on retrieval feedback signals. When results are frequently unhelpful, the system boosts importance + recency; when consistently helpful, it reinforces semantic similarity.

**Feedback boost**: Per-memory multiplier from `0.5` (consistently unhelpful) to `1.5` (consistently helpful), with Bayesian smoothing.

---

## Development Phases

### Phase 1 — Foundation: Filtering & Smart Retrieval

> `865f89b` feat(memory): implement Phase 1 foundation (filtering & smart retrieval)

Built the intelligent retrieval pipeline that makes memory useful, not just stored.

| Feature | Description | Files |
|---------|-------------|-------|
| **Write Filter** | Discard noise — memories below importance `0.15` are never stored | `utils/write-filter.ts` |
| **Duplicate Detection** | Semantic dedup via cosine similarity (`≥0.92`). Duplicates bump `usage_count` instead of creating new records | `semantic-memory.ts` |
| **Context-Aware Retrieval** | `taskType` inference (`coding`, `planning`, `chat`, `debugging`) biases scoring toward relevant tags | `utils/task-relevance.ts` |
| **Multi-Stage Reranker** | Stage 1: Vector search → Stage 2: Source filter → Stage 3: Composite score (5 signals) | `utils/reranker.ts` |
| **Unified Query API** | `memory.query({ task, context, taskType })` — single entry-point to all memory layers | `memory-manager.ts` |

**Test suites (5):**

| Test | Scenario | Tests |
|------|----------|-------|
| TC-001 | Write filter rejects noise, stores important facts | 7 |
| TC-002 | Duplicate detection via `usage_count` increment | 7 |
| TC-003 | Context-aware retrieval reranks by `taskType` | 8 |
| TC-004 | Composite score balances importance + popularity vs recency | 8 |
| TC-005 | Edge cases: non-duplicate + irrelevance exclusion | 9 |

---

### Phase 2 — Adaptive Learning & Context Optimization

Built the learning loop that makes the agent improve over time:

| Module | Description | Files |
|--------|-------------|-------|
| **Feedback Tracker** | Records per-memory `used/helpful` feedback. Computes per-memory boost (`0.5–1.5×`) and adaptive reranking weights from aggregate signals | `feedback-tracker.ts` |
| **Strategy Memory** | Stores reusable patterns like *"comparison tables work better than prose"* with effectiveness tracking (EMA, α=0.2) and domain classification | `strategy-memory.ts` |
| **Context Compression** | Hierarchical compression pipeline: `raw → summary → insight`. Budget-aware batch compression starts with lowest-scored memories first | `context-compression.ts` |
| **Behavior Engine** | Bridges reflections to action. Extracts `retrieval_bias`, `prompt_style`, `content_preference` directives from reflection data via LLM | `behavior-engine.ts` |
| **Context Builder** | Main Phase 2 consumer API. Orchestrates: retrieval → priority sorting → strategy injection → directive injection → token-budgeted compression | `context-builder.ts` |

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

### Phase 3 — Memory Evolution & Evaluation

Built the self-evolving memory layer that makes the system improve autonomously:

| Module | Description | Files |
|--------|-------------|-------|
| **Conflict Detector** | Detects contradictory/outdated/ambiguous memories via semantic similarity + LLM classification. Flags conflicts without deleting | `conflict-detector.ts` |
| **Confidence Scorer** | 4-signal confidence system: usage frequency, conflict consistency, source reliability tiers, recency decay. Weights: `0.30 / 0.25 / 0.25 / 0.20` | `confidence-scorer.ts` |
| **Hypothesis Manager** | Groups conflicting memories as competing perspectives. Auto-transitions: `open → leaning (>0.7) → resolved (>0.8 + 3 evidence)` | `hypothesis-manager.ts` |
| **Evaluation Tracker** | Records per-query retrieval quality. Computes hit rate, success rate, per-memory usefulness, and trend detection (current vs previous period) | `evaluation-tracker.ts` |
| **Memory Promoter** | Promotes frequently-used memories: episodic→semantic (usage≥5, importance≥0.6) and semantic→knowledge graph (usage≥10, confidence≥0.7) via LLM extraction | `memory-promoter.ts` |

**New database tables:**

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `memory_conflicts` | Conflict tracking between memories | `memory_id_a`, `memory_id_b`, `conflict_type`, `status` |
| `evaluation_records` | Retrieval quality metrics | `query_id`, `retrieved_memory_ids`, `success`, `hit_rate` |
| `promotion_events` | Memory promotion audit trail | `memory_id`, `from_layer`, `to_layer`, `reason` |

**Qdrant payload additions** (backward-compatible):

| Field | Default | Purpose |
|-------|---------|--------|
| `confidence` | `0.5` | Composite confidence score — multiplies retrieval score |
| `decay_factor` | `1.0` | Time-based decay multiplier — reduced during consolidation |
| `conflict_group` | `null` | Links conflicting memories together |
| `archived` | `false` | Soft-delete flag — archived memories excluded from search |

**Updated modules:**

| Module | Changes |
|--------|---------|
| `semantic-memory.ts` | Stores confidence/decay/archived payload fields. Search excludes archived. Score multiplied by confidence × decay_factor |
| `memory-consolidation.ts` | Added semantic decay (confidence-gated) and stale memory archival |
| `reranker.ts` | Accepts `confidenceBoosts` map for confidence-weighted ranking |
| `memory-manager.ts` | Wires all Phase 3 modules. Adds conflict detection after semantic store, promotion in consolidation cycles |
| `agent-controller.ts` | Records evaluation data after each chat response |

**Confidence scoring formula:**

```
confidence = 0.30 × min(1, usage_count/15)
           + 0.25 × (1 - conflicts/(conflicts+3))
           + 0.25 × source_tier(api=1.0, reflection=0.8, episode=0.6, unknown=0.3)
           + 0.20 × exp(-0.005 × age_hours)
```

**Memory decay formula:**

```
new_decay = old_decay × exp(-rate × age_days / (1 + confidence))
```

High-confidence memories decay slower (denominator `1 + confidence`).

**Promotion rules:**

```
Episodic → Semantic:
  usage_count ≥ 5  AND  importance ≥ 0.6
  → LLM extracts core fact → stored as semantic memory

Semantic → Knowledge Graph:
  usage_count ≥ 10  AND  confidence ≥ 0.7
  → LLM extracts entity-relationship triples → added to Neo4j
```

**Test suites (3):**

| Test | Scenario | Tests |
|------|----------|-------|
| TC-009 | Conflict detection, confidence scoring, source reliability, hypothesis lifecycle | 15 |
| TC-010 | Evaluation tracking, metrics computation, semantic decay, stale archival, trend detection | 15 |
| TC-011 | Episodic→semantic promotion, semantic→KG promotion, audit trail, threshold rejection | 12 |

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
# Edit .env — set your LLM model names (must match exactly what LM Studio shows)

# Initialize database schemas
bun run db:init
```

### 3. Run

```bash
# API Server (for other projects to consume)
bun run server
# → http://localhost:3001

# CLI mode (interactive chat)
bun run dev
```

### 4. Test

```bash
# Run all tests (11 suites, 122 tests)
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

# Run examples
bun run example:phase1
bun run example:phase2
bun run example:phase3
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
| `PROMOTION_USAGE_THRESHOLD` | `5` | Min usage count for episodic→semantic promotion |
| `PROMOTION_CONFIDENCE_THRESHOLD` | `0.7` | Min confidence for semantic→KG promotion |

---

## Project Structure

```
src/
├── server.ts                      # REST API server (Bun.serve)
├── index.ts                       # CLI entry point
├── config/index.ts                # Environment config
├── api/
│   ├── middleware.ts              # Auth, CORS, request logging
│   ├── session-manager.ts        # Multi-session AgentController pool
│   └── routes/
│       ├── chat.ts               # SSE streaming + sync chat
│       ├── memory.ts             # Store, search, stats, graph
│       └── sessions.ts           # Session CRUD
├── database/
│   ├── connections.ts            # DB connection manager
│   └── init.ts                   # Schema initialization (Phase 1 + Phase 2 tables)
├── llm/
│   └── llm-client.ts            # LLM client (chat, stream, embed, chatJSON)
├── memory/
│   ├── types.ts                  # Type definitions (all phases)
│   ├── working-memory.ts         # Redis working memory
│   ├── episodic-memory.ts        # PostgreSQL episodic memory
│   ├── semantic-memory.ts        # Qdrant vector memory + dedup
│   ├── knowledge-graph.ts        # Neo4j knowledge graph
│   ├── reflection-memory.ts      # Reflection storage
│   ├── memory-manager.ts         # Central orchestrator
│   ├── memory-extraction.ts      # LLM knowledge extraction
│   ├── memory-consolidation.ts   # Decay, merge, summarize
│   ├── feedback-tracker.ts       # [Phase 2] Retrieval feedback + adaptive weights
│   ├── strategy-memory.ts        # [Phase 2] Reusable pattern storage
│   ├── context-compression.ts    # [Phase 2] Hierarchical compression (raw→summary→insight)
│   ├── conflict-detector.ts      # [Phase 3] Contradictory/outdated memory detection
│   ├── confidence-scorer.ts      # [Phase 3] 4-signal confidence scoring
│   ├── hypothesis-manager.ts     # [Phase 3] Multi-perspective conflict storage
│   ├── evaluation-tracker.ts     # [Phase 3] Retrieval quality metrics
│   ├── memory-promoter.ts        # [Phase 3] Episodic→semantic→KG promotion
│   └── utils/
│       ├── reranker.ts           # Multi-signal composite scorer (adaptive)
│       ├── task-relevance.ts     # Task-type inference + tag scoring
│       └── write-filter.ts       # Importance + novelty gate
├── reflection/
│   ├── reflection-engine.ts      # Post-task reflection + strategy extraction
│   └── behavior-engine.ts        # [Phase 2] Reflection → behavioral directives
├── agent/
│   ├── agent-controller.ts       # Agent orchestration (chat + stream)
│   ├── prompt-builder.ts         # Memory-augmented prompts (supports BuiltContext)
│   └── context-builder.ts        # [Phase 2] Token-aware context assembly
├── examples/
│   ├── phase1-usage.ts           # Phase 1 feature demo
│   ├── phase2-usage.ts           # Phase 2 feature demo
│   └── phase3-usage.ts           # Phase 3 feature demo
└── tests/
    ├── helpers.ts                # Shared test utilities + cleanup
    ├── tc-001.write-filter.test.ts
    ├── tc-002.dedup.test.ts
    ├── tc-003.context-aware.test.ts
    ├── tc-004.composite-score.test.ts
    ├── tc-005.edge-cases.test.ts
    ├── tc-006.adaptive-learning.test.ts    # [Phase 2]
    ├── tc-007.reflection-impact.test.ts    # [Phase 2]
    ├── tc-008.context-compression.test.ts  # [Phase 2]
    ├── tc-009.conflict-confidence.test.ts  # [Phase 3]
    ├── tc-010.evaluation-decay.test.ts     # [Phase 3]
    └── tc-011.promotion.test.ts            # [Phase 3]
```

## Technical Summary

- **Runtime**: [Bun](https://bun.sh), Node.js
- **Language**: TypeScript
- **Backend**: REST API (Bun.serve), SSE Streaming
- **Database**: PostgreSQL, Redis, Qdrant (Vector DB), Neo4j (Graph DB)
- **DevOps**: Docker, Docker Compose
- **Testing**: Vitest (11 suites, 122 tests — all against real databases)
- **AI/LLM**: OpenAI SDK, LM Studio, OpenRouter, Vector Embeddings (Qdrant), Prompt Engineering
- **Key Patterns**: Adaptive retrieval scoring, hierarchical context compression, reflection-to-behavior pipeline, semantic deduplication, multi-stage reranking, conflict detection, confidence scoring, memory promotion lifecycle

## License

MIT
