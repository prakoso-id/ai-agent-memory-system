# AI Agent Memory System â€” Integration Contract

> Version 1.0.0 Â· Runtime: [Bun](https://bun.sh) Â· Default port: `3001`

Dokumen ini adalah satu-satunya referensi yang dibutuhkan project lain untuk berintegrasi dengan **AI Agent Memory System**. Mencakup seluruh REST API, tipe data, error codes, dan contoh integrasi dalam berbagai bahasa.

---

## Daftar Isi

1. [Gambaran Sistem](#1-gambaran-sistem)
2. [Infrastruktur yang Dibutuhkan](#2-infrastruktur-yang-dibutuhkan)
3. [Konfigurasi Environment](#3-konfigurasi-environment)
4. [Autentikasi](#4-autentikasi)
5. [Session Management](#5-session-management)
6. [Memory API](#6-memory-api)
7. [Chat API](#7-chat-api)
8. [Dashboard & Observability API](#8-dashboard--observability-api)
9. [Tipe Data Lengkap](#9-tipe-data-lengkap)
10. [Error Codes](#10-error-codes)
11. [Contoh Integrasi](#11-contoh-integrasi)
12. [Arsitektur Memory Layers](#12-arsitektur-memory-layers)
13. [Retrieval Scoring](#13-retrieval-scoring)

---

## 1. Gambaran Sistem

Memory System ini adalah **layanan backend memori kognitif multi-layer** untuk AI agent. Project lain menggunakannya sebagai "otak" yang persisten â€” menyimpan, mengambil, dan belajar dari interaksi.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Project Anda                   â”‚
â”‚  (PM Agent, Chatbot, dll.)      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
               â”‚ REST API / HTTP
               â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Memory System  :3001           â”‚
â”‚                                 â”‚
â”‚  Working Memory   (Redis)       â”‚
â”‚  Episodic Memory  (PostgreSQL)  â”‚
â”‚  Semantic Memory  (Qdrant)      â”‚
â”‚  Knowledge Graph  (Neo4j)       â”‚
â”‚  Reflection Engine              â”‚
â”‚  Semantic Cache   (Redis)       â”‚
â”‚  Role-Based Partitioning        â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Dua cara integrasi:**

| Cara | Kapan digunakan |
|------|----------------|
| **REST API** (direkomendasikan) | Project berbahasa apapun (Python, Go, Node.js, dll.) |
| **TypeScript library** | Project TypeScript/Bun yang ingin embed langsung |

---

## 2. Infrastruktur yang Dibutuhkan

Jalankan semua dependency dengan satu perintah:

```bash
docker-compose up -d
```

| Service | Port | Digunakan untuk |
|---------|------|-----------------|
| Redis | `6379` | Working memory (context aktif), Semantic Cache |
| PostgreSQL | `5432` | Episodic memory, Reflection, Strategy, Evaluation |
| Qdrant | `6333` | Semantic memory (vector search + embedding) |
| Neo4j | `7687` | Knowledge graph (entity relationships) |

Kemudian inisialisasi database schema:

```bash
bun run db:init
```

Jalankan server:

```bash
bun run server
```

---

## 3. Konfigurasi Environment

Buat file `.env` di root project:

```env
# LLM Provider (default: LM Studio local)
LLM_PROVIDER=lmstudio
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=deepseek-r1
EMBEDDING_MODEL=nomic-embed-text

# Database connections
REDIS_URL=redis://localhost:6379
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=agent
POSTGRES_PASSWORD=agent_secret
POSTGRES_DB=agent_memory

# Qdrant (vector database)
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=semantic_memory

# Neo4j (knowledge graph)
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=agent_secret

# API Server
API_PORT=3001
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
API_KEYS=dev-key-change-me,another-key   # comma-separated, change in production!

# Memory settings
MEMORY_RETRIEVAL_LIMIT=7
MEMORY_DECAY_FACTOR=0.01
WORKING_MEMORY_TTL=3600

# Context builder
CONTEXT_MAX_TOKENS=2048
COMPRESSION_THRESHOLD=0.7

# Memory evolution
CONFLICT_SIMILARITY_THRESHOLD=0.75
CONFIDENCE_DECAY_RATE=0.005
STALE_ARCHIVE_DAYS=30
PROMOTION_USAGE_THRESHOLD=5
PROMOTION_CONFIDENCE_THRESHOLD=0.7

# Semantic cache
CACHE_SIMILARITY_THRESHOLD=0.95
CACHE_TTL_SECONDS=3600
CACHE_MAX_ENTRIES=500
CACHE_ENABLED=true

# Role-based memory
DEFAULT_AGENT_ROLE=general
ROLE_RELEVANCE_WEIGHT=0.15
ROLE_MIN_IMPORTANCE=0.1
```

---

## 4. Autentikasi

Semua endpoint **kecuali** `/api/health` membutuhkan API key.

```
Authorization: Bearer <API_KEY>
```

**Contoh:**
```http
POST /api/memory/query HTTP/1.1
Host: localhost:3001
Authorization: Bearer dev-key-change-me
Content-Type: application/json
```

Jika tidak ada header Authorization atau key salah:

```json
// 401
{ "error": "Missing or invalid Authorization header. Use: Bearer <api_key>" }

// 403
{ "error": "Invalid API key" }
```

---

## 5. Session Management

Session adalah unit isolasi memori. Setiap agent/pengguna seharusnya punya session sendiri. Session disimpan di Redis dengan TTL `WORKING_MEMORY_TTL` (default 1 jam sejak interaksi terakhir).

### POST `/api/sessions` â€” Buat session baru

```http
POST /api/sessions
Authorization: Bearer <key>
Content-Type: application/json

{
  "session_id": "my-agent-session-001"   // opsional; auto-generated jika tidak diisi
}
```

**Response `201`:**
```json
{
  "sessionId": "my-agent-session-001",
  "created": true
}
```

---

### GET `/api/sessions` â€” List semua session aktif

```http
GET /api/sessions
Authorization: Bearer <key>
```

**Response `200`:**
```json
{
  "count": 2,
  "sessions": [
    {
      "sessionId": "my-agent-session-001",
      "createdAt": "2026-05-13T10:00:00.000Z",
      "lastInteraction": "2026-05-13T10:05:00.000Z",
      "interactionCount": 12
    }
  ]
}
```

---

### GET `/api/sessions/:id` â€” Detail session

```http
GET /api/sessions/my-agent-session-001
Authorization: Bearer <key>
```

**Response `200`:**
```json
{
  "sessionId": "my-agent-session-001",
  "stats": {
    "episodic": 45,
    "semantic": 23,
    "reflections": 3,
    "graphNodes": 17,
    "strategies": 5,
    "conflicts": 1,
    "evaluations": 40,
    "promotions": 2,
    "hypotheses": 1,
    "interactions": 45
  }
}
```

---

### DELETE `/api/sessions/:id` â€” Hapus session

```http
DELETE /api/sessions/my-agent-session-001
Authorization: Bearer <key>
```

**Response `200`:**
```json
{ "deleted": true, "sessionId": "my-agent-session-001" }
```

---

## 6. Memory API

### POST `/api/memory/store` â€” Simpan memori langsung

Menyimpan fakta ke semantic memory. Difilter berdasarkan importance dan deteksi duplikat.

```http
POST /api/memory/store
Authorization: Bearer <key>
Content-Type: application/json

{
  "session_id": "my-agent-session-001",       // wajib
  "content": "User prefers dark mode UI",     // wajib
  "category": "user_preference",              // opsional, default: "general_knowledge"
  "importance": 0.8,                          // opsional, 0.0â€“1.0, default: 0.7
  "tags": ["ui", "preference"]               // opsional
}
```

**Response `200` â€” berhasil disimpan:**
```json
{
  "stored": true,
  "id": "3f2a1c4b-...",
  "usage_count": 1
}
```

**Response `200` â€” difilter (terlalu rendah atau duplikat):**
```json
{
  "stored": false,
  "reason": "filtered_by_importance_or_duplicate"
}
```

> **Note:** Memori dengan `importance < 0.3` akan difilter. Near-duplicate (cosine similarity â‰¥ threshold) tidak membuat entri baru, tapi menaikkan `usage_count` pada memori yang sudah ada.

---

### POST `/api/memory/search` â€” Semantic search

Pencarian berbasis vektor dengan multi-signal scoring.

```http
POST /api/memory/search
Authorization: Bearer <key>
Content-Type: application/json

{
  "session_id": "my-agent-session-001",   // wajib
  "query": "user's framework preferences", // wajib
  "limit": 5,                             // opsional, default: 7
  "min_score": 0.3,                       // opsional, threshold minimum skor
  "task_type": "coding"                   // opsional: coding|chat|planning|analysis|general|dnd
}
```

**Response `200`:**
```json
{
  "query": "user's framework preferences",
  "task_type": "coding",
  "count": 3,
  "results": [
    {
      "source": "semantic",
      "content": "User prefers TypeScript over JavaScript for all new projects.",
      "score": 0.847,
      "task_relevance": 0.9,
      "importance": 0.9,
      "usage_count": 5,
      "tags": ["user_preference", "typescript"],
      "timestamp": "2026-05-13T10:00:00.000Z"
    }
  ]
}
```

**Nilai `source`:**
- `episodic` â€” dari PostgreSQL (percakapan/events)
- `semantic` â€” dari Qdrant (fakta terektrak)
- `reflection` â€” dari PostgreSQL (lessons learned)
- `knowledge_graph` â€” dari Neo4j (entity nodes)

---

### POST `/api/memory/query` â€” Unified context-aware query â­

**Endpoint utama yang direkomendasikan.** Menggabungkan task description + context untuk retrieval yang sepenuhnya context-aware.

```http
POST /api/memory/query
Authorization: Bearer <key>
Content-Type: application/json

{
  "session_id": "my-agent-session-001",              // wajib
  "task": "fix TypeScript compilation error",        // wajib
  "context": "Error: Cannot find module './utils'",  // opsional, teks context bebas
  "task_type": "coding",                             // opsional, auto-inferred jika tidak diisi
  "limit": 7                                         // opsional
}
```

**Response `200`:**
```json
{
  "task": "fix TypeScript compilation error",
  "task_type": "coding",
  "count": 4,
  "results": [
    {
      "source": "semantic",
      "content": "User uses tsconfig strict mode in all projects",
      "score": 0.912,
      "task_relevance": 0.95,
      "importance": 0.85,
      "usage_count": 8,
      "tags": ["typescript", "config"],
      "timestamp": "2026-05-10T08:30:00.000Z"
    }
  ]
}
```

**`task_type` values dan kapan menggunakannya:**

| Value | Gunakan untuk |
|-------|--------------|
| `coding` | Bug fix, refactoring, review kode |
| `chat` | Percakapan umum, tanya jawab |
| `planning` | Roadmap, architecture, sprint planning |
| `analysis` | Data analysis, metrics, laporan |
| `general` | Fallback / tidak spesifik |
| `dnd` | Konteks D&D / game roleplay |

> Jika tidak diisi, sistem akan *infer* task_type dari teks `task` secara otomatis.

---

### GET `/api/memory/stats` â€” Statistik memori

```http
GET /api/memory/stats?session_id=my-agent-session-001
Authorization: Bearer <key>
```

**Response `200`:**
```json
{
  "episodic": 120,
  "semantic": 45,
  "reflections": 8,
  "graphNodes": 32,
  "strategies": 7,
  "conflicts": 2,
  "evaluations": 110,
  "promotions": 5,
  "hypotheses": 3,
  "interactions": 120
}
```

---

### GET `/api/memory/graph` â€” Knowledge graph query

```http
GET /api/memory/graph?session_id=my-agent-session-001&q=TypeScript&limit=10
Authorization: Bearer <key>
```

**Query params:**
- `session_id` â€” wajib
- `q` â€” kata kunci pencarian entitas
- `limit` â€” max nodes yang dikembalikan (default: 10)

**Response `200`:**
```json
{
  "nodes": [
    {
      "id": "node-uuid",
      "label": "Technology",
      "name": "TypeScript",
      "properties": { "version": "5.x" },
      "createdAt": "2026-05-01T00:00:00.000Z"
    }
  ],
  "relationships": [
    {
      "id": "edge-uuid",
      "sourceId": "user-node-id",
      "targetId": "node-uuid",
      "relationship": "prefers",
      "weight": 0.9
    }
  ]
}
```

---

## 7. Chat API

### POST `/api/chat/sync` â€” Chat sinkronus (direkomendasikan untuk integrasi)

```http
POST /api/chat/sync
Authorization: Bearer <key>
Content-Type: application/json

{
  "session_id": "my-agent-session-001",   // opsional; auto-create jika tidak ada
  "message": "What framework do I prefer?"
}
```

**Response `200`:**
```json
{
  "sessionId": "my-agent-session-001",
  "response": "Based on your previous interactions, you prefer TypeScript with React..."
}
```

---

### POST `/api/chat` â€” Chat streaming (SSE)

```http
POST /api/chat
Authorization: Bearer <key>
Content-Type: application/json

{
  "session_id": "my-agent-session-001",
  "message": "Tell me about my project preferences"
}
```

**Response:** Server-Sent Events stream (`Content-Type: text/event-stream`)

```
data: {"type":"session","sessionId":"my-agent-session-001"}

data: {"type":"token","content":"Based"}

data: {"type":"token","content":" on"}

data: {"type":"done","usage":{"prompt_tokens":150,"completion_tokens":80}}
```

**Event types dalam stream:**

| type | Description |
|------|-------------|
| `session` | Konfirmasi sessionId (selalu event pertama) |
| `token` | Satu token dari LLM response |
| `done` | Stream selesai, berisi usage stats |
| `error` | Error terjadi |

---

## 8. Dashboard & Observability API

### GET `/api/dashboard/metrics` â€” Snapshot metrics

```http
GET /api/dashboard/metrics?session_id=my-agent-session-001
Authorization: Bearer <key>
```

**Response `200`:**
```json
{
  "metrics": {
    "cacheHitRate": 0.42,
    "cacheEntries": 87,
    "avgRetrievalLatencyMs": 145,
    "conflictFrequency": 0.03,
    "promotionRate": 0.08,
    "roleDistribution": {
      "coder": 12,
      "pm": 5,
      "general": 28
    }
  }
}
```

---

### GET `/api/dashboard/advisories` â€” Self-healing suggestions

```http
GET /api/dashboard/advisories?session_id=my-agent-session-001
Authorization: Bearer <key>
```

**Response `200`:**
```json
{
  "advisories": [
    "High conflict frequency detected (>5%). Consider running consolidation.",
    "Cache hit rate below 30% â€” lower CACHE_SIMILARITY_THRESHOLD to ~0.90.",
    "15 memories pending promotion to semantic layer."
  ]
}
```

---

### GET `/api/dashboard/graph` â€” Dashboard knowledge graph

```http
GET /api/dashboard/graph?q=user&limit=80
Authorization: Bearer <key>
```

**Response `200`:**
```json
{
  "nodes": [
    {
      "id": "node-id",
      "label": "User",
      "name": "primary_user",
      "importance": 0.9,
      "usageCount": 45,
      "timestamp": "2026-05-01T00:00:00.000Z"
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "source": "node-id",
      "target": "tech-node-id",
      "relationship": "prefers",
      "weight": 0.85
    }
  ]
}
```

---

### GET `/api/dashboard/memories` â€” Paginated memory list dengan filter

```http
GET /api/dashboard/memories?limit=20&offset=0&topic=typescript&agent_role=coder
Authorization: Bearer <key>
```

**Query params (semua opsional):**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `topic` | string | â€” | Filter berdasarkan tag atau category |
| `min_confidence` | number | â€” | Confidence minimum (0.0â€“1.0) |
| `max_confidence` | number | â€” | Confidence maksimum (0.0â€“1.0) |
| `conflict_status` | string | â€” | `none\|detected\|hypothesis\|resolved\|superseded` |
| `agent_role` | string | â€” | `coder\|pm\|qa\|analyst\|general` |
| `archived` | boolean | `false` | Tampilkan memori yang diarsipkan |
| `limit` | number | `50` | Max hasil per halaman |
| `offset` | number | `0` | Pagination offset |

**Response `200`:**
```json
{
  "memories": [
    {
      "id": "uuid",
      "content": "User prefers TypeScript for all projects",
      "category": "user_preference",
      "source": "api",
      "importance": 0.9,
      "confidence": 0.85,
      "usageCount": 12,
      "tags": ["typescript", "preference"],
      "roles": ["coder"],
      "conflictStatus": "none",
      "archived": false,
      "timestamp": "2026-05-01T00:00:00.000Z",
      "lastAccessed": "2026-05-13T09:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### PATCH `/api/dashboard/memories/:id` â€” Update memori

```http
PATCH /api/dashboard/memories/uuid-here
Authorization: Bearer <key>
Content-Type: application/json

{
  "importance": 0.95,
  "archived": false,
  "role_importance": {
    "role": "coder",
    "value": 0.9
  }
}
```

**Response `200`:**
```json
{ "updated": true, "id": "uuid-here" }
```

---

### DELETE `/api/dashboard/memories/:id` â€” Hapus memori

```http
DELETE /api/dashboard/memories/uuid-here
Authorization: Bearer <key>
```

**Response `200`:**
```json
{ "deleted": true, "id": "uuid-here" }
```

---

### GET `/api/dashboard/cache/stats` â€” Statistik semantic cache

```http
GET /api/dashboard/cache/stats
Authorization: Bearer <key>
```

**Response `200`:**
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

---

### DELETE `/api/dashboard/cache` â€” Flush seluruh cache

```http
DELETE /api/dashboard/cache
Authorization: Bearer <key>
```

**Response `200`:**
```json
{ "flushed": true }
```

---

### DELETE `/api/dashboard/cache/:id` â€” Invalidate satu cache entry

```http
DELETE /api/dashboard/cache/entry-id-here
Authorization: Bearer <key>
```

---

### GET `/api/dashboard/roles/:role/memories` â€” Role-scoped memory list

```http
GET /api/dashboard/roles/coder/memories?limit=10
Authorization: Bearer <key>
```

**`role` values:** `coder` | `pm` | `qa` | `analyst` | `general`

---

## 9. Tipe Data Lengkap

### TaskType

```typescript
type TaskType = 'coding' | 'chat' | 'planning' | 'analysis' | 'general' | 'dnd';
```

### AgentRole

```typescript
type AgentRole = 'coder' | 'pm' | 'qa' | 'analyst' | 'general';
```

### BaseMemory

```typescript
interface BaseMemory {
  id: string;
  content: string;
  timestamp: string;        // ISO 8601
  importance: number;       // 0.0 â€“ 1.0
  usage_count: number;
  last_accessed: string;    // ISO 8601
  tags?: string[];
  source?: string;          // 'episode:<id>' | 'api' | 'reflection' | ...
  metadata: Record<string, unknown>;
}
```

### RetrievedMemory (hasil dari search/query)

```typescript
interface RetrievedMemory {
  memory: BaseMemory;
  source: 'episodic' | 'semantic' | 'reflection' | 'knowledge_graph';
  score: {
    memoryId: string;
    semanticSimilarity: number;
    recency: number;
    importance: number;
    taskRelevance: number;   // 0.0 â€“ 1.0
    totalScore: number;      // composite score
  };
}
```

### MemoryQueryInput

```typescript
interface MemoryQueryInput {
  task: string;            // apa yang sedang dikerjakan agent
  context?: string;        // teks konteks tambahan
  taskType?: TaskType;     // auto-inferred jika tidak diisi
  limit?: number;          // default: MEMORY_RETRIEVAL_LIMIT (7)
}
```

### EpisodicMemory

```typescript
interface EpisodicMemory extends BaseMemory {
  eventType: 'conversation' | 'task_execution' | 'error' | 'reflection' | 'system';
  sessionId: string;
  task?: string;
  result?: 'success' | 'failure' | 'partial';
  context?: string;
}
```

### SemanticMemory

```typescript
interface SemanticMemory extends BaseMemory {
  category: string;        // 'user_preference' | 'project_fact' | 'general_knowledge' | ...
  source: string;          // wajib untuk semantic
  embedding?: number[];    // vector embedding (384-dim)
}
```

### ReflectionMemory

```typescript
interface ReflectionMemory extends BaseMemory {
  observation: string;
  rootCause: string;
  lessonLearned: string;
  strategyImprovement: string;
  relatedEpisodeIds: string[];
}
```

### KnowledgeNode & KnowledgeEdge

```typescript
interface KnowledgeNode {
  id: string;
  label: string;           // 'User' | 'Project' | 'Technology' | ...
  name: string;
  properties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;    // 'works_on' | 'uses' | 'prefers' | ...
  properties: Record<string, unknown>;
  weight: number;          // 0.0 â€“ 1.0
  createdAt: string;
}
```

### DashboardMetrics

```typescript
interface Phase4Metrics {
  cacheHitRate: number;
  cacheEntries: number;
  avgRetrievalLatencyMs: number;
  conflictFrequency: number;
  promotionRate: number;
  roleDistribution: Partial<Record<AgentRole, number>>;
}
```

### MemoryStats

```typescript
interface MemoryStats {
  episodic: number;
  semantic: number;
  reflections: number;
  graphNodes: number;
  strategies: number;
  conflicts: number;
  evaluations: number;
  promotions: number;
  hypotheses: number;
  interactions: number;
}
```

---

## 10. Error Codes

| HTTP Status | Kondisi |
|-------------|---------|
| `200` | Sukses |
| `201` | Resource berhasil dibuat (session) |
| `400` | Request body tidak valid / field wajib kosong |
| `401` | Header `Authorization` tidak ada atau formatnya salah |
| `403` | API key tidak valid |
| `404` | Session tidak ditemukan / resource tidak ada |
| `500` | Internal server error |

**Format error response:**
```json
{ "error": "Pesan error yang menjelaskan masalah" }
```

---

## 11. Contoh Integrasi

### Python (httpx)

```python
import httpx

BASE_URL = "http://localhost:3001"
HEADERS = {
    "Authorization": "Bearer dev-key-change-me",
    "Content-Type": "application/json"
}

# 1. Buat session
res = httpx.post(f"{BASE_URL}/api/sessions", headers=HEADERS, json={
    "session_id": "my-python-agent"
})
session_id = res.json()["sessionId"]

# 2. Simpan memori
httpx.post(f"{BASE_URL}/api/memory/store", headers=HEADERS, json={
    "session_id": session_id,
    "content": "User prefers concise responses without filler words",
    "category": "user_preference",
    "importance": 0.85,
    "tags": ["style", "preference"]
})

# 3. Query kontekstual (endpoint utama)
res = httpx.post(f"{BASE_URL}/api/memory/query", headers=HEADERS, json={
    "session_id": session_id,
    "task": "write a response about Python best practices",
    "context": "User asked about async patterns",
    "task_type": "coding",
    "limit": 5
})
memories = res.json()["results"]
for m in memories:
    print(f"[{m['source']}] score={m['score']:.3f} â€” {m['content'][:80]}")

# 4. Chat sync
res = httpx.post(f"{BASE_URL}/api/chat/sync", headers=HEADERS, json={
    "session_id": session_id,
    "message": "What do you know about my preferences?"
})
print(res.json()["response"])
```

---

### TypeScript / Node.js (fetch)

```typescript
const BASE = "http://localhost:3001";
const HEADERS = {
  "Authorization": "Bearer dev-key-change-me",
  "Content-Type": "application/json",
};

// Buat session
const { sessionId } = await fetch(`${BASE}/api/sessions`, {
  method: "POST",
  headers: HEADERS,
  body: JSON.stringify({ session_id: "my-ts-agent" }),
}).then(r => r.json());

// Query memori
const { results } = await fetch(`${BASE}/api/memory/query`, {
  method: "POST",
  headers: HEADERS,
  body: JSON.stringify({
    session_id: sessionId,
    task: "plan the Q3 feature roadmap",
    task_type: "planning",
    limit: 7,
  }),
}).then(r => r.json());

// Gunakan memories sebagai context untuk LLM prompt
const context = results.map((r: any) => r.content).join("\n");
```

---

### Go (net/http)

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

const baseURL = "http://localhost:3001"
const apiKey  = "dev-key-change-me"

func memoryQuery(sessionID, task string) ([]map[string]any, error) {
    body, _ := json.Marshal(map[string]any{
        "session_id": sessionID,
        "task":       task,
        "task_type":  "general",
        "limit":      7,
    })

    req, _ := http.NewRequest("POST", baseURL+"/api/memory/query", bytes.NewBuffer(body))
    req.Header.Set("Authorization", "Bearer "+apiKey)
    req.Header.Set("Content-Type", "application/json")

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result struct {
        Results []map[string]any `json:"results"`
    }
    json.NewDecoder(resp.Body).Decode(&result)
    return result.Results, nil
}

func main() {
    results, _ := memoryQuery("go-agent-001", "user coding preferences")
    for _, r := range results {
        fmt.Printf("[%s] %.3f â€” %s\n", r["source"], r["score"], r["content"])
    }
}
```

---

### Pola integrasi untuk AI Agent (TypeScript, pattern lengkap)

```typescript
// Workflow standar: setiap giliran agent
async function agentTurn(sessionId: string, userMessage: string): Promise<string> {
  const BASE = "http://localhost:3001";
  const H = { Authorization: "Bearer dev-key-change-me", "Content-Type": "application/json" };
  const post = (path: string, body: object) =>
    fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then(r => r.json());

  // 1. Ambil memori yang relevan
  const { results } = await post("/api/memory/query", {
    session_id: sessionId,
    task: userMessage,
    limit: 7,
  });

  // 2. Bangun context untuk LLM
  const memoryContext = results
    .map((r: any) => `[${r.source}] ${r.content}`)
    .join("\n");

  // 3. Panggil LLM dengan context (sesuaikan dengan LLM Anda)
  const llmPrompt = `
Relevant memories:
${memoryContext}

User: ${userMessage}
Assistant:`;

  // ... panggil LLM Anda di sini ...
  const assistantResponse = "...";

  // 4. Simpan interaksi ke memory (optional â€” chat/sync sudah otomatis)
  // Atau gunakan /api/chat/sync untuk all-in-one
  const { response } = await post("/api/chat/sync", {
    session_id: sessionId,
    message: userMessage,
  });

  return response;
}
```

---

## 12. Arsitektur Memory Layers

| Layer | Storage | Tujuan | TTL |
|-------|---------|--------|-----|
| **Working** | Redis | Context percakapan aktif (messages array) | 1 jam (sejak interaksi terakhir) |
| **Episodic** | PostgreSQL | Setiap interaksi tercatat (siapa berkata apa, kapan) | Permanent |
| **Semantic** | Qdrant | Fakta terextrak dengan vector embedding | Permanent |
| **Knowledge Graph** | Neo4j | Relasi entitas (Userâ†’prefersâ†’TypeScript) | Permanent |
| **Reflection** | PostgreSQL | Lessons learned dari analisis pola | Permanent |
| **Strategy** | PostgreSQL | Pola perilaku yang bisa digunakan ulang | Permanent |

### Lifecycle memori

```
User message
    â”‚
    â–¼
Working Memory (Redis) â†â†’ LLM response
    â”‚
    â–¼
Episodic Memory (setiap interaksi disimpan)
    â”‚
    â–¼ (LLM extraction)
Semantic Memory + Knowledge Graph
    â”‚
    â–¼ (threshold: usage_count â‰¥ 5 + confidence â‰¥ 0.7)
Promoted â†’ lebih tinggi prioritas dalam retrieval
    â”‚
    â–¼ (setelah N interaksi)
Reflection Engine â†’ Strategy Memory + Behavioral Directives
```

---

## 13. Retrieval Scoring

Setiap memori yang dikembalikan memiliki `score` composite:

$$
\text{totalScore} = w_1 \cdot \text{semanticSimilarity} + w_2 \cdot \text{recency} + w_3 \cdot \text{importance} + w_4 \cdot \text{taskRelevance} + w_5 \cdot \text{usagePopularity} \times \text{feedbackBoost}
$$

**Default weights:**

| Dimensi | Default Weight | Keterangan |
|---------|---------------|------------|
| `semanticSimilarity` | 0.35 | Cosine similarity embedding |
| `recency` | 0.25 | Exponential decay dari timestamp |
| `importance` | 0.20 | Nilai importance saat disimpan |
| `taskRelevance` | 0.10 | Overlap tag dengan task_type |
| `usagePopularity` | 0.10 | Normalized usage_count |

**Feedback boost:** `0.5` (sering tidak berguna) â†’ `1.5` (sering berguna), menggunakan Bayesian smoothing. Berubah otomatis berdasarkan feedback via `processInteraction`.

**Adaptive weights:** Bobot bergeser otomatis berdasarkan sinyal feedback. Jika hasil sering tidak berguna, sistem menaikkan `importance` + `recency`.

---

## Health Check

Tidak membutuhkan autentikasi:

```http
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-05-13T10:00:00.000Z",
  "version": "1.0.0",
  "sessions": 3
}
```

---

*Generated from codebase analysis Â· AI Agent Memory System v1.0.0*
