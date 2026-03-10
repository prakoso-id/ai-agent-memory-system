# 🧠 Self-Evolving AI Agent with Persistent Memory

An AI agent with a multi-layer cognitive memory architecture that persists knowledge across sessions, learns from experience, and improves reasoning over time — powered entirely by local LLM infrastructure.

## Architecture

```
User  →  Agent Controller  →  Memory Manager
              ↓                     ↓
         Prompt Builder      ┌──────────────┐
              ↓              │ Working (Redis)│
         Local LLM           │ Episodic (PG)  │
      (LM Studio /           │ Semantic (Qdrant)│
       OpenRouter)            │ Knowledge (Neo4j)│
                              │ Reflection (PG)  │
                              └──────────────┘
                                    ↓
                             Reflection Engine
                             (learns from tasks)
```

### Memory Layers

| Layer | Storage | Purpose |
|-------|---------|---------|
| **Working** | Redis | Current conversation context (TTL-based) |
| **Episodic** | PostgreSQL | Events, interactions, task outcomes |
| **Semantic** | Qdrant | Extracted knowledge with vector embeddings |
| **Knowledge Graph** | Neo4j | Entity relationships and structured reasoning |
| **Reflection** | PostgreSQL | Lessons learned and strategy improvements |

### Memory Lifecycle

```
Interaction → Episodic Store → Knowledge Extraction → Semantic + Graph
                                                          ↓
              Consolidation ← Decay ← Reflection Engine ←┘
```

### Retrieval Scoring

```
score = 0.4 × semantic_similarity + 0.3 × recency + 0.3 × importance
```

## Quick Start

### 1. Prerequisites
- [Bun](https://bun.sh) runtime
- [Docker](https://docker.com) (for databases)
- [LM Studio](https://lmstudio.ai) or OpenRouter API key

### 2. Setup

```bash
# Install dependencies
bun install

# Start databases
docker compose up -d

# Copy and configure environment
cp .env.example .env
# Edit .env with your LLM settings

# Initialize database schemas
bun run src/database/init.ts

# Start the agent
bun run dev
```

### 3. Usage

```
You > I prefer TypeScript and I'm building an AI meeting summarizer with Next.js
Agent > [responds and stores preferences in memory]

You > /stats
📊 Memory Statistics:
  Episodic memories : 1
  Semantic memories : 3
  Reflections       : 0
  Knowledge nodes   : 4
  Interactions      : 1

You > /quit
```

**After restarting**, the agent remembers everything from previous sessions.

### CLI Commands

| Command | Description |
|---------|-------------|
| `/stats` | Show memory counts across all layers |
| `/consolidate` | Force memory cleanup (decay, merge, summarize) |
| `/clear` | Reset working memory (conversation context) |
| `/quit` | Exit |

## Configuration

All settings are in `.env`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `lmstudio` | `lmstudio` or `openrouter` |
| `LLM_BASE_URL` | `http://localhost:1234/v1` | LLM API endpoint |
| `LLM_MODEL` | `deepseek-r1` | Chat model name |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model |
| `MEMORY_RETRIEVAL_LIMIT` | `7` | Max memories per retrieval |
| `MEMORY_DECAY_FACTOR` | `0.01` | Exponential decay rate |

## Project Structure

```
src/
├── index.ts                    # CLI entry point
├── config/index.ts             # Environment config
├── database/
│   ├── connections.ts          # DB connection manager
│   └── init.ts                 # Schema initialization
├── llm/llm-client.ts          # LLM client (LM Studio/OpenRouter)
├── memory/
│   ├── types.ts               # Type definitions
│   ├── working-memory.ts      # Redis working memory
│   ├── episodic-memory.ts     # PostgreSQL episodic memory
│   ├── semantic-memory.ts     # Qdrant vector memory
│   ├── knowledge-graph.ts     # Neo4j knowledge graph
│   ├── reflection-memory.ts   # Reflection storage
│   ├── memory-manager.ts      # Central orchestrator
│   ├── memory-extraction.ts   # LLM knowledge extraction
│   └── memory-consolidation.ts # Decay, merge, summarize
├── reflection/
│   └── reflection-engine.ts   # Post-task reflection
└── agent/
    ├── agent-controller.ts    # Agent main loop
    └── prompt-builder.ts      # Memory-augmented prompts
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **LLM**: LM Studio / OpenRouter (OpenAI-compatible API)
- **Databases**: Redis · PostgreSQL · Qdrant · Neo4j
- **Orchestration**: Docker Compose
