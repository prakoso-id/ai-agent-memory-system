# AI Agent Memory System

A **multi-layer cognitive memory service** for AI agents, exposed as a REST API. The system provides persistent memory storage, semantic retrieval, knowledge graphs, reflection-based learning, role-based partitioning, and an observability dashboard — all built on top of four specialized databases.

> **Use this as a standalone memory backend for any AI agent project.** Your agent sends chat messages and queries; the memory system handles storage, deduplication, scoring, conflict detection, and context assembly.

---

## Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | [Bun](https://bun.sh) v1.3+ | TypeScript execution, HTTP server (`Bun.serve`) |
| Language | TypeScript (ESM) | All source code, `.js` imports in compiled output |
| Working Memory | Redis (ioredis) | Conversation history, semantic cache, rate limit counters, session metadata |
| Episodic Memory | PostgreSQL (pg Pool) | Every conversation turn, reflection records, strategies, evaluations |
| Semantic Memory | Qdrant | Vector embeddings — similarity search with composite rescoring |
| Knowledge Graph | Neo4j | Entity-relationship triples extracted from memories |
| LLM (chat) | OpenAI-compatible API | Any provider; tested with DeepSeek via TokenRouter |
| LLM (embeddings) | OpenAI-compatible API | Any provider; tested with NVIDIA Llama-Nemotron via OpenRouter |
| Validation | Zod | Runtime schema validation on all route handlers |
| Logging | Pino | Structured JSON logging; level controlled by `LOG_LEVEL` |
| Tests | Vitest | 14 test files, 143 tests |
| Dashboard | React 18 + Vite | Separate dev server on port 5173 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Your AI Agent                                          │
│  (any language — HTTP client only)                      │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API (Bearer token auth)
┌──────────────────────▼──────────────────────────────────┐
│  Memory System API  http://localhost:3001                │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │ Working     │  │ Episodic    │  │ Semantic       │  │
│  │ Memory      │  │ Memory      │  │ Memory         │  │
│  │ (Redis)     │  │ (PostgreSQL)│  │ (Qdrant)       │  │
│  └─────────────┘  └─────────────┘  └────────────────┘  │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ Knowledge Graph │  │ Reflection + Strategy        │  │
│  │ (Neo4j)         │  │ (PostgreSQL)                 │  │
│  └─────────────────┘  └──────────────────────────────┘  │
│                                                         │
│  ┌──── Phase 2 ─────────────────────────────────────┐   │
│  │ Feedback Tracker · Context Builder               │   │
│  │ Strategy Memory · Behavior Engine                │   │
│  │ Context Compressor (raw→summary→insight)         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──── Phase 3 ─────────────────────────────────────┐   │
│  │ Conflict Detector · Confidence Scorer            │   │
│  │ Hypothesis Manager · Evaluation Tracker          │   │
│  │ Memory Promoter (episodic→semantic→KG)           │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──── Phase 4 ─────────────────────────────────────┐   │
│  │ Semantic Cache (Redis, gzip, LRU)                │   │
│  │ Role-Based Memory Partitioning                   │   │
│  │ Observability Service · Dashboard API            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Memory Layers

| Layer | Storage | Purpose | Lifespan |
|---|---|---|---|
| **Working** | Redis | Current conversation turns (sliding window, compressed) | TTL: 1 hour (configurable) |
| **Episodic** | PostgreSQL | Every interaction — who said what, when, which session | Permanent |
| **Semantic** | Qdrant | Extracted facts with 2048-dim vector embeddings | Permanent |
| **Knowledge Graph** | Neo4j | Entity-relationship triples (`User→prefers→TypeScript`) | Permanent |
| **Reflection** | PostgreSQL | Learned lessons auto-extracted from conversation history | Permanent |
| **Strategy** | PostgreSQL | Reusable behavioral patterns with EMA effectiveness scoring | Permanent |
| **Semantic Cache** | Redis | Compressed LLM responses, deduplicated by cosine similarity | TTL: 1 hour (configurable) |

---

## Retrieval Scoring

### Composite score (5 signals)

```
score = (w1×semantic + w2×recency + w3×importance + w4×task_relevance + w5×usage)
        × boost(id) × confidence(id) × decay(id)
```

Default weights: `w1=0.35  w2=0.25  w3=0.20  w4=0.10  w5=0.10`

**Feedback boost** — per-memory multiplier from `0.5` (unhelpful) to `1.5` (helpful), with Bayesian smoothing.

**Adaptive weights** — shift automatically from retrieval feedback signals. Recomputed whenever the aggregate feedback ratio changes significantly.

### Confidence scoring formula (Phase 3)

```
confidence = 0.30 × min(1, uses/15)
           + 0.25 × 3/(conflicts+3)
           + 0.25 × source_tier(api=1.0, reflection=0.8, episodic=0.6, unknown=0.3)
           + 0.20 × exp(-0.005 × age_hours)
```

### Semantic decay formula (Phase 3)

```
decay_new = decay_old × exp(-rate × age_days / (1 + confidence))
```

High-confidence memories decay slower.

---

## Development Phases

### Phase 1 — Foundation: Filtering & Smart Retrieval

Intelligent retrieval pipeline — makes memory useful, not just stored.

| Module | Description |
|---|---|
| **Write Filter** | Discards noise — memories with importance `< 0.15` are never stored |
| **Duplicate Detection** | Semantic dedup via cosine similarity (`≥ 0.92`); duplicates bump `usage_count` |
| **Context-Aware Retrieval** | `taskType` inference (`coding`, `planning`, `chat`, `debugging`) biases composite score |
| **Multi-Stage Reranker** | Stage 1: Qdrant vector search → Stage 2: source filter → Stage 3: composite score |
| **Unified Query API** | `memory.query({ task, context, taskType })` — single entry-point to all layers |

Tests: **TC-001** write filter (7) · **TC-002** dedup (7) · **TC-003** context-aware (8) · **TC-004** composite score (8) · **TC-005** edge cases (11)

---

### Phase 2 — Adaptive Learning & Context Optimization

The learning loop — the agent improves with use.

| Module | Description |
|---|---|
| **Feedback Tracker** | Records per-memory `used/helpful` signals. Computes boost multiplier and adaptive weight shifts |
| **Strategy Memory** | Stores reusable patterns (*"comparison tables work better than prose"*) with EMA effectiveness (`α=0.2`) |
| **Context Compressor** | Hierarchical pipeline: `raw → summary → insight`. Budget-aware — starts with lowest-scored memories |
| **Behavior Engine** | Bridges reflections to action. Extracts `retrieval_bias`, `prompt_style`, `content_preference` directives via LLM |
| **Context Builder** | Orchestrates: retrieval → priority sort → strategy injection → directive injection → token-budgeted compression |

New database tables: `retrieval_feedback`, `strategy_memories`, `behavioral_directives`

Tests: **TC-006** adaptive learning (10) · **TC-007** reflection impact (15) · **TC-008** context compression (16)

---

### Phase 3 — Memory Evolution & Evaluation

Self-evolving memory — the system improves autonomously.

| Module | Description |
|---|---|
| **Conflict Detector** | Detects contradictory/outdated/ambiguous memories via similarity + LLM classification. Flags without deleting |
| **Confidence Scorer** | 4-signal composite: usage frequency, conflict consistency, source reliability, recency decay |
| **Hypothesis Manager** | Groups conflicting memories as competing perspectives. States: `open → leaning (>0.7) → resolved (>0.8 + 3 evidence)` |
| **Evaluation Tracker** | Records per-query retrieval quality. Computes hit rate, success rate, per-memory usefulness, trend direction |
| **Memory Promoter** | Auto-promotes: episodic→semantic (usage≥5, importance≥0.6) and semantic→KG (usage≥10, confidence≥0.7) via LLM |

New database tables: `memory_conflicts`, `evaluation_records`, `promotion_events`

Qdrant payload additions: `confidence`, `decay_factor`, `conflict_group`, `archived`

Tests: **TC-009** conflict + confidence (15) · **TC-010** evaluation + decay (15) · **TC-011** promotion (12)

---

### Phase 4 — Observability, Scalability & Efficiency

Production-readiness: caching, multi-agent isolation, and monitoring.

| Module | Description |
|---|---|
| **Semantic Cache** | Redis-backed LLM call deduplication. Fast path: exact SHA-256 hash. Slow path: cosine-similarity batch scan (threshold `0.95`). Responses gzip-compressed. LRU eviction at `maxEntries`. Pipeline-batched Redis reads (O(1) round-trips) |
| **Role Memory** | Partitions the shared Qdrant collection by agent role (`coder`, `pm`, `qa`, `analyst`, `general`). Stores `importance_per_role` weights. Injects role-relevance dimension into composite score |
| **Observability Service** | Captures retrieval latency in a Redis ring buffer. Aggregates `DashboardMetrics` snapshot. Generates self-healing advisories when metrics cross thresholds |
| **Dashboard** | React + Vite SPA: Knowledge Graph (D3 force-directed), Memory Browser (filterable table with archive/delete/importance controls), Timeline, Metrics panel |
| **Dashboard API** | 10 endpoints under `/api/dashboard/` for metrics, advisories, graph, memory CRUD, cache management, and role-scoped queries |

Qdrant payload additions (on top of Phase 3): `roles`, `importance_per_role`

Tests: **TC-012** semantic cache (7) · **TC-013** role-based memory (6) · **TC-014** observability (8)

---

### Plan Enhancements (current branch)

Security, performance, and reliability improvements applied on top of Phase 4.

| Item | Change |
|---|---|
| **Zod validation** | All route handlers validate request bodies with Zod schemas. Invalid requests return `400` with `fieldErrors`. |
| **Pino logging** | Replaced all `console.log/error` with structured JSON logging via Pino. Level via `LOG_LEVEL` env var. Silent in tests. |
| **Session ownership** | Sessions are bound to the API key that created them. Cross-key access returns `403`. |
| **CORS security** | Unrecognized origins receive no CORS headers (previously leaked `Access-Control-Allow-Origin`). |
| **Rate limiting** | Redis sliding-window counter — 20 requests/minute per API key on chat routes. Fails open if Redis is unavailable. |
| **Body size limits** | Chat and memory routes reject bodies over 512 KB (`413`). |
| **Default API key removed** | `API_KEYS` is required. Server refuses to start if empty. |
| **LLM retry + backoff** | `chat()` retries up to 3 times with 200ms/400ms backoff. Skips retry on auth errors and `AbortError`. |
| **LLM JSON parse retry** | `chatJSON()` strips markdown fences and retries once with a corrective prompt on parse failure. |
| **chatStream() timeout** | 20-second `AbortController` timeout on streaming requests. |
| **Graceful DB degradation** | Each database service initializes independently. Server starts with partial functionality if individual services are down; fails only if all four are unavailable. |
| **PostgreSQL SSL** | Opt-in via `POSTGRES_SSL=true`. |
| **Redis password** | Injected from `REDIS_PASSWORD` env var if not embedded in `REDIS_URL`. |
| **Session persistence** | Session metadata serialized to Redis on every change. Restored on server restart via `loadFromRedis()`. |
| **Configurable history limit** | `AGENT_HISTORY_LIMIT` controls how many conversation turns are sent in the LLM prompt (default: 10). |
| **Detailed health endpoint** | `/api/health` returns per-service status (`ok`/`error` per DB). Returns `503` if any service is degraded. |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3 or later
- Redis, PostgreSQL, Qdrant, Neo4j (Docker Compose provided)
- An OpenAI-compatible LLM API (local via LM Studio, or remote via OpenRouter/DeepSeek)

### 1. Clone & install

```bash
git clone https://github.com/your-org/ai-agent-memory-system.git
cd ai-agent-memory-system
bun install
```

### 2. Start databases

```bash
docker compose up -d
```

This starts Redis on `:6379`, PostgreSQL on `:5432`, Qdrant on `:6333`, Neo4j on `:7687`.

> To use remote databases, skip `docker compose` and set the `REDIS_URL`, `POSTGRES_HOST`, `NEO4J_URI`, and `QDRANT_URL` env vars instead.

### 3. Configure environment

```bash
cp .env.example .env
```

Minimum required variables:

```dotenv
API_KEYS=your-secret-key-here

LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=deepseek/deepseek-chat-v3-0324:free

EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_API_KEY=sk-or-...
EMBEDDING_MODEL=nvidia/llama-nemotron-embed-vl-1b-v2:free
```

### 4. Initialize database schemas

```bash
bun run db:init
```

Creates all PostgreSQL tables, Qdrant collections (embedding dimension auto-detected from the model), and Neo4j constraints.

### 5. Run the API server

```bash
bun run server
# → http://localhost:3001
```

### 6. Run the dashboard (optional)

```bash
bun run dashboard:dev
# → http://localhost:5173
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| **LLM** | | |
| `LLM_BASE_URL` | `http://localhost:1234/v1` | Chat LLM API base URL |
| `LLM_API_KEY` | `lm-studio` | Chat LLM API key |
| `LLM_MODEL` | `deepseek-r1` | Chat model identifier |
| `EMBEDDING_BASE_URL` | *(same as LLM_BASE_URL)* | Embedding API base URL |
| `EMBEDDING_API_KEY` | *(same as LLM_API_KEY)* | Embedding API key |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model identifier |
| **Server** | | |
| `API_PORT` | `3001` | HTTP server port |
| `API_KEYS` | *(required — no default)* | Comma-separated valid API keys |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated allowed origins |
| `LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| **Agent** | | |
| `MEMORY_RETRIEVAL_LIMIT` | `7` | Max memories returned per retrieval |
| `MEMORY_DECAY_FACTOR` | `0.01` | Exponential decay rate for recency scoring |
| `WORKING_MEMORY_TTL` | `3600` | Session TTL in seconds |
| `AGENT_HISTORY_LIMIT` | `10` | Max conversation turns sent to the LLM prompt |
| **Databases** | | |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `REDIS_PASSWORD` | *(unset)* | Redis password — injected into URL if not already present |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `agent` | PostgreSQL user |
| `POSTGRES_PASSWORD` | `agent_secret` | PostgreSQL password |
| `POSTGRES_DB` | `agent_memory` | PostgreSQL database name |
| `POSTGRES_SSL` | `false` | Set `true` to enable SSL (`rejectUnauthorized: false`) |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant base URL |
| `QDRANT_API_KEY` | *(unset)* | Qdrant API key (for Qdrant Cloud) |
| `QDRANT_COLLECTION` | `semantic_memory` | Qdrant collection name |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j Bolt URI |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD" | "agent_secret` | Neo4j password |
| **Context Builder** | | |
| `CONTEXT_MAX_TOKENS` | `2048` | Token budget for context assembly |
| `COMPRESSION_THRESHOLD` | `0.7` | Context compression trigger threshold |
| **Memory Evolution** | | |
| `CONFLICT_SIMILARITY_THRESHOLD` | `0.75` | Cosine similarity threshold for conflict detection |
| `CONFIDENCE_DECAY_RATE` | `0.005` | Confidence time-decay rate per hour |
| `STALE_ARCHIVE_DAYS` | `30` | Days before unused memories are archived |
| `PROMOTION_USAGE_THRESHOLD` | `5` | Min usage for episodic→semantic promotion |
| `PROMOTION_CONFIDENCE_THRESHOLD` | `0.7` | Min confidence for semantic→KG promotion |
| **Semantic Cache** | | |
| `CACHE_ENABLED` | `true` | Enable/disable semantic cache globally |
| `CACHE_SIMILARITY_THRESHOLD` | `0.95` | Cosine similarity threshold for a cache hit |
| `CACHE_TTL_SECONDS` | `3600` | Cache entry TTL in seconds |
| `CACHE_MAX_ENTRIES` | `500` | Max cache entries before LRU eviction (0 = unlimited) |
| `CACHE_KEY_PREFIX` | `sc:` | Redis key prefix for cache entries |
| **Role Memory** | | |
| `DEFAULT_AGENT_ROLE` | `general` | Default role for agents that do not specify one |
| `ROLE_RELEVANCE_WEIGHT` | `0.15` | Score weight for role-relevance dimension in reranking |
| `ROLE_MIN_IMPORTANCE` | `0.1` | Minimum role-importance to include in role-scoped results |
| **Observability** | | |
| `LATENCY_BUFFER_SIZE` | `200` | Latency ring buffer size in samples |

---

## API Reference

**Base URL:** `http://localhost:3001`
**Auth:** All endpoints except `GET /api/health` require `Authorization: Bearer <API_KEY>`
**Content-Type:** `application/json` for all `POST`/`PATCH` requests
**Body limit:** 512 KB
**Rate limit:** 20 requests/minute per API key on chat routes

### Health

```http
GET /api/health
```

```json
{
  "status": "ok",
  "timestamp": "2026-05-16T12:00:00.000Z",
  "version": "1.0.0",
  "sessions": 2,
  "services": {
    "redis": "ok",
    "postgres": "ok",
    "qdrant": "ok",
    "neo4j": "ok"
  }
}
```

Returns `503` with `"status": "degraded"` if any service is unhealthy.

---

### Sessions

Sessions are scoped to the API key that creates them. Cross-key access returns `403`.

```http
POST /api/sessions
{ "session_id": "optional-uuid" }
→ 201  { "sessionId": "4ab0c57c-...", "created": true }

GET /api/sessions
→ { "count": 2, "sessions": [ { "sessionId": "...", "createdAt": "...", "lastActivity": "...", "interactionCount": 5 } ] }

GET /api/sessions/:id
→ { sessionId, createdAt, lastActivity, interactionCount }

DELETE /api/sessions/:id
→ { "deleted": true, "sessionId": "..." }
```

---

### Chat

#### Streaming (SSE)

```http
POST /api/chat
{ "session_id": "4ab0c57c-...", "message": "Hello, my name is Jackson" }
```

```
data: {"type":"session","sessionId":"4ab0c57c-..."}
data: {"type":"memory","count":3,"topScore":0.775}
data: {"type":"token","content":"Hello"}
data: {"type":"token","content":" Jackson"}
data: {"type":"done","fullResponse":"Hello Jackson! How can I help?"}
```

#### Sync (full JSON)

```http
POST /api/chat/sync
{ "session_id": "4ab0c57c-...", "message": "What is my name?" }
→ { "sessionId": "4ab0c57c-...", "response": "Your name is Jackson!" }
```

**Validation:** `message` must be 1–32 768 characters. `session_id` must be a UUID if provided.

---

### Memory

#### Store a fact directly

```http
POST /api/memory/store
{
  "session_id": "4ab0c57c-...",
  "content": "User prefers dark mode and Vim keybindings",
  "category": "user_preference",
  "importance": 0.9,
  "tags": ["editor", "ui"]
}
→ { "stored": true, "id": "a1b2c3d4-..." }
→ { "stored": false, "reason": "filtered_by_importance_or_duplicate" }
```

Categories: `user_identity` · `user_preference` · `project_fact` · `general_knowledge` · `technical_detail`

#### Semantic search

```http
POST /api/memory/search
{
  "session_id": "4ab0c57c-...",
  "query": "what tools does the user prefer?",
  "limit": 5,
  "min_score": 0.1,
  "task_type": "coding"
}
→ { "query": "...", "count": 3, "results": [ { "source", "content", "score", "importance", "usage_count", "tags", "timestamp" } ] }
```

#### Unified context query

```http
POST /api/memory/query
{
  "session_id": "4ab0c57c-...",
  "task": "fix TypeScript generics error",
  "context": "using mapped types",
  "task_type": "coding",
  "limit": 7
}
```

#### Stats

```http
GET /api/memory/stats?session_id=4ab0c57c-...
→ { "episodic": 12, "semantic": 8, "reflections": 2, "graphNodes": 15, "strategies": 3, "interactions": 12 }
```

#### Knowledge graph query

```http
GET /api/memory/graph?session_id=4ab0c57c-...&q=TypeScript
→ { "query": "TypeScript", "count": 2, "nodes": [ { "id", "name", "label", "properties" } ] }
```

---

### Dashboard API

All dashboard endpoints require auth. `session_id` query param is optional — defaults to the most recently active session.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dashboard/metrics?session_id=` | Full `DashboardMetrics` snapshot |
| `GET` | `/api/dashboard/advisories?session_id=` | Self-healing improvement suggestions |
| `GET` | `/api/dashboard/graph?q=&limit=` | Neo4j graph (nodes + edges) for D3 |
| `GET` | `/api/dashboard/memories` | Paginated, filtered memory list |
| `PATCH` | `/api/dashboard/memories/:id` | Update importance, archived flag, or role importance |
| `DELETE` | `/api/dashboard/memories/:id` | Hard-delete from Qdrant + Neo4j |
| `GET` | `/api/dashboard/cache/stats` | Cache hit rate, total entries, avg similarity |
| `DELETE` | `/api/dashboard/cache` | Flush entire semantic cache |
| `DELETE` | `/api/dashboard/cache/:id` | Invalidate a single cache entry |
| `GET` | `/api/dashboard/roles/:role/memories?limit=` | Role-scoped memory list |

**Memory list filters** (`GET /api/dashboard/memories`):

| Param | Values | Default |
|---|---|---|
| `topic` | any string | — |
| `min_confidence` | 0–1 | — |
| `max_confidence` | 0–1 | — |
| `conflict_status" | "none` · `detected` · `resolved` | — |
| `agent_role" | "coder` · `pm` · `qa` · `analyst` · `general` | — |
| `archived` | `true` · `false` | `false` |
| `limit` | integer | 50 |
| `offset` | integer | 0 |

**Metrics response:**

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

---

## Integration Examples

### TypeScript / JavaScript

```typescript
const API = 'http://localhost:3001';
const KEY = 'your-api-key';
const H = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Create a session (bound to this API key)
const { sessionId } = await fetch(`${API}/api/sessions`, { method: 'POST', headers: H }).then(r => r.json());

// Sync chat
const { response } = await fetch(`${API}/api/chat/sync`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ session_id: sessionId, message: 'Hello, my name is Jackson' }),
}).then(r => r.json());

// Streaming chat (SSE)
const res = await fetch(`${API}/api/chat`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ session_id: sessionId, message: 'What is my name?' }),
});
for await (const chunk of res.body!) {
  const lines = new TextDecoder().decode(chunk).split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === 'token') process.stdout.write(event.content);
  }
}

// Store a fact directly
await fetch(`${API}/api/memory/store`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ session_id: sessionId, content: 'Jackson loves TypeScript', category: 'user_preference', importance: 0.9 }),
});

// Semantic search
const { results } = await fetch(`${API}/api/memory/search`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ session_id: sessionId, query: 'user preferences' }),
}).then(r => r.json());
```

### Python

```python
import requests, json

API, H = "http://localhost:3001", {
    "Authorization": "Bearer your-api-key",
    "Content-Type": "application/json"
}

sid = requests.post(f"{API}/api/sessions", headers=H).json()["sessionId"]

# Sync chat
print(requests.post(f"{API}/api/chat/sync", headers=H,
    json={"session_id": sid, "message": "Hello, my name is Jackson"}).json()["response"])

# Streaming chat
r = requests.post(f"{API}/api/chat", headers=H,
    json={"session_id": sid, "message": "What is my name?"}, stream=True)
for line in r.iter_lines():
    if line and line.startswith(b"data: "):
        e = json.loads(line[6:])
        if e["type"] == "token":
            print(e["content"], end="", flush=True)
print()
```

### cURL

```bash
# Health
curl http://localhost:3001/api/health

# Create session
curl -s -X POST http://localhost:3001/api/sessions \
  -H "Authorization: Bearer your-api-key" | jq .sessionId

# Sync chat
curl -s -X POST http://localhost:3001/api/chat/sync \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","message":"Hello!"}' | jq .response

# Store fact
curl -s -X POST http://localhost:3001/api/memory/store \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","content":"User loves Golang","category":"user_preference","importance":0.9}'

# Semantic search
curl -s -X POST http://localhost:3001/api/memory/search \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"SESSION_ID","query":"what does the user like?","limit":5}' | jq .
```

---

## Tests

```bash
bun run test            # All 14 suites (143 tests)

# Individual suites
bun run test:tc001      # Phase 1: write filter
bun run test:tc002      # Phase 1: duplicate detection
bun run test:tc003      # Phase 1: context-aware retrieval
bun run test:tc004      # Phase 1: composite scoring
bun run test:tc005      # Phase 1: edge cases
bun run test:tc006      # Phase 2: adaptive learning
bun run test:tc007      # Phase 2: reflection impact
bun run test:tc008      # Phase 2: context compression
bun run test:tc009      # Phase 3: conflict detection + confidence
bun run test:tc010      # Phase 3: evaluation + decay
bun run test:tc011      # Phase 3: memory promotion
bun run test:tc012      # Phase 4: semantic cache
bun run test:tc013      # Phase 4: role-based memory
bun run test:tc014      # Phase 4: observability + metrics
```

| Suite | Phase | Scenarios covered | Tests |
|---|---|---|---|
| TC-001 | 1 | Write filter: noise rejection, importance threshold | 7 |
| TC-002 | 1 | Dedup: `usage_count` bump, novelty threshold `0.92` | 7 |
| TC-003 | 1 | Context-aware: `taskType` reranks results | 8 |
| TC-004 | 1 | Composite score: importance + popularity vs recency | 8 |
| TC-005 | 1 | Edge cases: non-dup storage, irrelevance exclusion | 11 |
| TC-006 | 2 | Adaptive: feedback boosts shift rankings 50%+ gap | 10 |
| TC-007 | 2 | Reflection → directives → prompt shaping | 15 |
| TC-008 | 2 | Compression: 8 memories → 200-token budget | 16 |
| TC-009 | 3 | Conflict detection, hypothesis lifecycle, source tiers | 15 |
| TC-010 | 3 | Evaluation tracking, decay, stale archival, trend | 15 |
| TC-011 | 3 | Episodic→semantic→KG promotion, audit trail | 12 |
| TC-012 | 4 | Cache: hash hit, similarity hit, false-positive guard | 7 |
| TC-013 | 4 | Role partitioning: coder/PM isolation, universal access | 6 |
| TC-014 | 4 | Latency p50, metrics shape, advisory, miss→hit | 8 |
| **Total** | | | **143** |

---

## Project Structure

```
ai-agent-memory-system/
├── src/
│   ├── server.ts                    # Bun.serve HTTP server — all route dispatch
│   ├── index.ts                     # CLI entry point (interactive chat)
│   ├── logger.ts                    # Pino logger singleton + createLogger() child factory
│   ├── config/
│   │   └── index.ts                 # All config from env vars + validateConfig()
│   ├── api/
│   │   ├── middleware.ts            # withAuth, withRateLimit, corsHeaders, extractApiKey, logRequest
│   │   ├── session-manager.ts       # Multi-session pool, Redis persistence, ownership validation
│   │   └── routes/
│   │       ├── chat.ts              # POST /api/chat (SSE) + /api/chat/sync
│   │       ├── memory.ts            # POST /api/memory/{store,search,query} · GET /api/memory/{stats,graph}
│   │       ├── sessions.ts          # CRUD /api/sessions[/:id]
│   │       └── dashboard.ts         # All /api/dashboard/* endpoints
│   ├── database/
│   │   ├── connections.ts           # Singleton DB manager with per-service availability flags
│   │   └── init.ts                  # Schema initialization (all phases)
│   ├── llm/
│   │   └── llm-client.ts            # chat (retry+backoff), chatStream (timeout), embed, chatJSON (parse retry)
│   ├── memory/
│   │   ├── types.ts                 # All TypeScript types (all phases)
│   │   ├── working-memory.ts        # Redis sliding-window conversation history
│   │   ├── episodic-memory.ts       # PostgreSQL interaction log
│   │   ├── semantic-memory.ts       # Qdrant vector store + dedup + confidence/decay/archived payload
│   │   ├── knowledge-graph.ts       # Neo4j entity-relationship graph (parameterized queries)
│   │   ├── reflection-memory.ts     # Reflection storage
│   │   ├── memory-manager.ts        # Central orchestrator — wires all layers
│   │   ├── memory-extraction.ts     # LLM knowledge extraction from conversations
│   │   ├── memory-consolidation.ts  # Decay, merge, summarize, stale archival
│   │   ├── feedback-tracker.ts      # [P2] Retrieval feedback + adaptive weights
│   │   ├── strategy-memory.ts       # [P2] Reusable behavioral patterns
│   │   ├── context-compression.ts   # [P2] Hierarchical compression (raw→summary→insight)
│   │   ├── conflict-detector.ts     # [P3] Contradictory/outdated memory detection
│   │   ├── confidence-scorer.ts     # [P3] 4-signal confidence formula
│   │   ├── hypothesis-manager.ts    # [P3] Multi-perspective conflict resolution
│   │   ├── evaluation-tracker.ts    # [P3] Retrieval quality metrics + trend detection
│   │   ├── memory-promoter.ts       # [P3] Episodic→semantic→KG auto-promotion
│   │   ├── semantic-cache.ts        # [P4] Redis LLM response cache with pipeline batch scan
│   │   ├── role-memory.ts           # [P4] Role-partitioned memory with importance_per_role
│   │   ├── observability-service.ts # [P4] Latency ring buffer, DashboardMetrics, advisories
│   │   └── utils/
│   │       ├── reranker.ts          # Multi-signal composite scorer (adaptive weights + boosts)
│   │       ├── task-relevance.ts    # taskType inference + tag scoring
│   │       └── write-filter.ts      # Importance threshold + novelty gate
│   ├── reflection/
│   │   ├── reflection-engine.ts     # Post-task reflection + strategy extraction via LLM
│   │   └── behavior-engine.ts       # [P2] Reflection → behavioral directives
│   ├── agent/
│   │   ├── agent-controller.ts      # Orchestrates chat + stream + memory pipeline
│   │   ├── prompt-builder.ts        # Memory-augmented LLM prompts (supports BuiltContext)
│   │   └── context-builder.ts       # [P2] Token-aware context assembly
│   ├── examples/
│   │   ├── phase1-usage.ts
│   │   ├── phase2-usage.ts
│   │   ├── phase3-usage.ts
│   │   └── phase4-usage.ts
│   └── tests/
│       ├── helpers.ts               # Shared test setup + DB cleanup utilities
│       ├── tc-001.write-filter.test.ts
│       ├── tc-002.dedup.test.ts
│       ├── tc-003.context-aware.test.ts
│       ├── tc-004.composite-score.test.ts
│       ├── tc-005.edge-cases.test.ts
│       ├── tc-006.adaptive-learning.test.ts
│       ├── tc-007.reflection-impact.test.ts
│       ├── tc-008.context-compression.test.ts
│       ├── tc-009.conflict-confidence.test.ts
│       ├── tc-010.evaluation-decay.test.ts
│       ├── tc-011.promotion.test.ts
│       ├── tc-012.semantic-cache.test.ts
│       ├── tc-013.role-memory.test.ts
│       └── tc-014.observability.test.ts
├── dashboard/                       # React + Vite SPA (port 5173)
│   ├── src/
│   │   ├── components/
│   │   │   ├── GraphView.tsx        # D3 force-directed knowledge graph
│   │   │   ├── MemoryTable.tsx      # Filterable memory browser with inline controls
│   │   │   ├── MemoryTimeline.tsx   # Chronological memory timeline
│   │   │   ├── MetricsPanel.tsx     # Cache hit rate, latency, conflict frequency
│   │   │   └── FilterBar.tsx        # Role / confidence / status filters
│   │   ├── hooks/
│   │   │   ├── useMemoryList.ts
│   │   │   ├── useMemoryGraph.ts
│   │   │   └── useMetrics.ts
│   │   └── lib/api.ts               # Typed fetch wrappers for all dashboard endpoints
│   └── package.json
├── docker-compose.yml               # Redis, PostgreSQL, Qdrant, Neo4j
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Security Notes

- **API keys:** `API_KEYS` env var is required. The server refuses to start if it is empty or unset. Keys are comma-separated and never stored in code.
- **Session ownership:** Each session is bound to the API key that created them. Requests from a different key return `403 Access Denied`.
- **CORS:** Requests from unrecognized origins receive no `Access-Control-*` headers.
- **Rate limiting:** Chat routes enforce 20 requests/minute per API key via a Redis sliding-window counter. The limiter fails open (does not block traffic) if Redis is temporarily unavailable.
- **Input validation:** All request bodies are validated with Zod before processing. Malformed or out-of-range values return `400 Validation failed` with field-level error details.
- **Body size limit:** All routes reject bodies larger than 512 KB (`413 Request Entity Too Large`).
- **Knowledge graph queries:** All Neo4j `session.run()` calls use parameterized queries — no string interpolation, no Cypher injection surface.
- **PostgreSQL SSL:** Opt-in via `POSTGRES_SSL=true`.

---

## License

MIT