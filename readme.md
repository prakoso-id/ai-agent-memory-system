# 🧠 AI Agent Memory System

A **multi-layer cognitive memory service** for AI agents. Provides persistent memory storage, semantic retrieval, knowledge graphs, and reflection — accessible via REST API.

> **Use this as a standalone memory backend for any AI agent project.**

## Architecture

```
┌────────────────────────────────────────────────┐
│  Your AI Agent Project                          │
│  (PM Agent, Content Planner, Chatbot, etc.)     │
└──────────────────┬─────────────────────────────┘
                   │ REST API (HTTP)
┌──────────────────┴─────────────────────────────┐
│  Memory System API (localhost:3001)              │
│                                                  │
│  ┌─────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │ Working  │ │ Episodic │ │ Semantic Search │  │
│  │ (Redis)  │ │  (PG)    │ │   (Qdrant)      │  │
│  └─────────┘ └──────────┘ └─────────────────┘  │
│  ┌──────────────┐ ┌────────────────────────┐    │
│  │ Knowledge    │ │ Reflection Engine      │    │
│  │ Graph (Neo4j)│ │ (learns from history)  │    │
│  └──────────────┘ └────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### Memory Layers

| Layer | Storage | Purpose | TTL |
|-------|---------|---------|-----|
| **Working** | Redis | Current conversation context | 1 hour |
| **Episodic** | PostgreSQL | Every interaction (who said what) | Permanent |
| **Semantic** | Qdrant | Extracted facts with vector embeddings | Permanent |
| **Knowledge Graph** | Neo4j | Entity relationships (User→prefers→TypeScript) | Permanent |
| **Reflection** | PostgreSQL | Learned lessons & strategy improvements | Permanent |

### Retrieval Scoring

```
totalScore = 0.4 × semantic_similarity + 0.3 × recency + 0.3 × importance
```

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

---

## Project Structure

```
src/
├── server.ts                     # REST API server (Bun.serve)
├── index.ts                      # CLI entry point
├── config/index.ts               # Environment config
├── api/
│   ├── middleware.ts             # Auth, CORS, request logging
│   ├── session-manager.ts       # Multi-session AgentController pool
│   └── routes/
│       ├── chat.ts              # SSE streaming + sync chat
│       ├── memory.ts            # Store, search, stats, graph
│       └── sessions.ts          # Session CRUD
├── database/
│   ├── connections.ts           # DB connection manager
│   └── init.ts                  # Schema initialization
├── llm/
│   └── llm-client.ts           # LLM client (chat, stream, embed)
├── memory/
│   ├── types.ts                 # Type definitions
│   ├── working-memory.ts        # Redis working memory
│   ├── episodic-memory.ts       # PostgreSQL episodic memory
│   ├── semantic-memory.ts       # Qdrant vector memory
│   ├── knowledge-graph.ts       # Neo4j knowledge graph
│   ├── reflection-memory.ts     # Reflection storage
│   ├── memory-manager.ts        # Central orchestrator
│   ├── memory-extraction.ts     # LLM knowledge extraction
│   └── memory-consolidation.ts  # Decay, merge, summarize
├── reflection/
│   └── reflection-engine.ts     # Post-task reflection
└── agent/
    ├── agent-controller.ts      # Agent orchestration (chat + stream)
    └── prompt-builder.ts        # Memory-augmented prompts
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **LLM**: LM Studio / OpenRouter (OpenAI-compatible API)
- **Databases**: Redis · PostgreSQL · Qdrant · Neo4j
- **Orchestration**: Docker Compose

## License

MIT
