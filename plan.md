# AI Agent Memory System — Enhancement Plan

> Deployment context:
> - **Databases** (Redis, Qdrant, Neo4j, PostgreSQL) → dedicated home server, dijalankan via Docker
> - **Project ini** → berjalan di local network, akses luar via Cloudflare Zero Trust Tunnel
> - `docker-compose.yml` di repo ini **hanya referensi untuk setup DB server**, bukan bagian dari project ini sendiri

---

## Daftar Isi

1. [Bug Fixes](#1-bug-fixes)
2. [Security Vulnerabilities](#2-security-vulnerabilities)
3. [Enhancements](#3-enhancements)
4. [New Features](#4-new-features)
5. [Priority Matrix](#5-priority-matrix)

---

## 1. Bug Fixes

### BUG-001 · CORS header bocor ke semua origin
**File:** `src/api/middleware.ts` → `corsHeaders()`  
**Masalah:** Ketika `origin` tidak ada dalam `corsOrigins`, fungsi fallback ke `corsOrigins[0]` — artinya semua request dari origin yang tidak diizinkan tetap mendapat CORS header yang valid.  
**Fix:** Kembalikan header kosong (tanpa `Access-Control-Allow-Origin`) jika origin tidak diizinkan.

```ts
// Sekarang (salah):
const allowed = config.server.corsOrigins.includes(origin) ? origin : config.server.corsOrigins[0]!;

// Fix:
if (!config.server.corsOrigins.includes(origin)) {
    return {}; // tidak inject CORS header sama sekali
}
return { 'Access-Control-Allow-Origin': origin, ... };
```

---

### BUG-002 · Semantic Cache: scan O(n) tidak scalable
**File:** `src/memory/semantic-cache.ts` → `get()`  
**Masalah:** Setiap query men-scan **seluruh** Redis cache index secara linear, load semua entry, lalu compute cosine similarity satu per satu di memory Node.js. Dengan 10.000 cache entries, ini sangat lambat.  
**Fix:** Gunakan pipeline Redis untuk batch-load hanya field `embedding` + `id`, bukan full entry. Atau implementasi inverted index sederhana berbasis bucket embedding dimension reduction. Jangka panjang: migrasi ke Redis Stack dengan module `redisearch` untuk VSS (Vector Similarity Search).

---

### BUG-003 · LLM `chatStream()` tidak punya timeout/abort
**File:** `src/llm/llm-client.ts`  
**Masalah:** Method `chat()` sudah memiliki `AbortController` dengan timeout 20 detik. Tapi `chatStream()` **tidak punya abort** — streaming yang hang akan block goroutine selamanya.  
**Fix:** Tambahkan `AbortController` + `setTimeout` yang sama ke `chatStream()`.

---

### BUG-004 · Sentinel `\n---MEMORIES---\n` tidak aman di cached payload
**File:** `src/memory/memory-manager.ts` → `cachedQuery()`  
**Masalah:** Combined cache payload dipisah dengan string literal `\n---MEMORIES---\n`. Jika LLM response secara kebetulan mengandung string tersebut (misalnya AI menjawab pertanyaan tentang sistem ini), parsing akan salah.  
**Fix:** Gunakan delimiter yang lebih unik dan tidak mungkin muncul di natural language, atau pisahkan LLM response dan memory JSON menjadi dua cache key terpisah.

---

### BUG-005 · Dashboard `resolveManager` fallback non-deterministik
**File:** `src/api/routes/dashboard.ts` → `resolveManager()`  
**Masalah:** Route dashboard yang tidak memerlukan `session_id` mengambil `sessions.listSessions()[0]` — urutan Map tidak dijamin konsisten di semua runtime, dan akan menggunakan session milik user lain secara acak.  
**Fix:** Endpoint global dashboard (graph, memories) harus query database **langsung**, bukan lewat session manager. Atau tambahkan dedicated "system session" yang selalu ada.

---

### BUG-006 · Redis password tidak diambil dari `REDIS_PASSWORD` env var
**File:** `src/database/connections.ts`, `src/config/index.ts`  
**Masalah:** Config hanya mengambil `REDIS_URL`. Jika user set `REDIS_URL=redis://host:6380` dan `REDIS_PASSWORD=secret` secara terpisah (umum di .env), password tidak akan digunakan — koneksi ke Redis yang `--requirepass` akan gagal.  
**Fix:** Jika `REDIS_URL` tidak mengandung password dan `REDIS_PASSWORD` tersedia, inject password ke URL atau gunakan ioredis options `password` secara terpisah.

---

### BUG-007 · `chatJSON()` tidak handle semua JSON parse failure
**File:** `src/llm/llm-client.ts` → `chatJSON()`  
**Masalah:** LLM kadang membungkus JSON dalam markdown code fence (` ```json ... ``` `). Method saat ini tidak strip fences sebelum `JSON.parse()` — akan throw SyntaxError yang tidak-informatif.  
**Fix:** Strip markdown code fences sebelum parse. Tambahkan retry sekali jika parse pertama gagal.

---

### BUG-008 · Tidak ada validasi ukuran request body
**File:** `src/api/routes/chat.ts`, `src/api/routes/memory.ts`  
**Masalah:** `req.json()` tanpa size limit. Request dengan body 100MB akan di-parse penuh sebelum error.  
**Fix:** Periksa `Content-Length` header atau gunakan `req.text()` dengan batas ukuran sebelum parse.

---

## 2. Security Vulnerabilities

### SEC-001 · Tidak ada rate limiting (OWASP: API4 - Unrestricted Resource Consumption)
**Dampak:** Endpoint `/api/chat` dapat di-spam → setiap request memanggil LLM + menulis ke semua 4 database. Bisa habiskan resource server dan biaya LLM API.  
**Fix:** Implementasi rate limiting per IP dan per API key menggunakan Redis sliding window counter.
```ts
// Contoh: max 20 req/menit per API key
const key = `ratelimit:${apiKey}:${Math.floor(Date.now() / 60000)}`;
const count = await redis.incr(key);
await redis.expire(key, 60);
if (count > 20) return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });
```

---

### SEC-002 · Default API key lemah di source code (OWASP: A07 - Identification Failures)
**File:** `src/config/index.ts`  
**Masalah:** `apiKeys: (process.env.API_KEYS || 'dev-key-change-me')` — jika `.env` tidak di-set, system berjalan dengan known default key.  
**Fix:** Jangan punya fallback default. Throw error saat startup jika `API_KEYS` env var kosong.
```ts
if (!process.env.API_KEYS) {
    throw new Error('FATAL: API_KEYS environment variable is required');
}
```

---

### SEC-003 · Potensi Cypher injection di Knowledge Graph (OWASP: A03 - Injection)
**File:** `src/memory/knowledge-graph.ts`  
**Masalah:** Jika entity name atau relationship string dari LLM response langsung diinterpolasi ke Cypher query tanpa parameterisasi, ini rentan injection.  
**Fix:** Gunakan Neo4j parameterized queries (sudah tersedia di driver) untuk semua dynamic values. Audit seluruh `session.run()` calls.

---

### SEC-004 · Session ID tidak divalidasi kepemilikannya
**File:** `src/api/routes/memory.ts`, `src/api/routes/chat.ts`  
**Masalah:** Siapapun dengan API key valid bisa mengakses memory session milik user lain jika mereka mengetahui `session_id` (UUID yang predictable tidak terlalu secret).  
**Fix:** Untuk multi-user scenario, bind session ke API key saat creation. Validasi bahwa API key yang mengakses session adalah yang menciptakannya.

---

### SEC-005 · PostgreSQL tanpa SSL di production
**File:** `src/database/connections.ts`  
**Masalah:** Koneksi ke PostgreSQL tidak menggunakan SSL/TLS. Walaupun di local network, data episodic memory berjalan plaintext.  
**Fix:** Tambahkan opsi SSL ke pg.Pool: `ssl: { rejectUnauthorized: false }` untuk self-signed cert di home server, atau `ssl: true` jika cert valid.

---

### SEC-006 · CORS bypass via null origin (BUG-001 yang lebih serius)
**File:** `src/api/middleware.ts`  
**Masalah:** Selain BUG-001, browser mengirim `Origin: null` untuk request dari file lokal (sandbox). Jika `corsOrigins` tidak include `null`, fallback ke `corsOrigins[0]` — efektif membuka API ke sandboxed contexts.

---

## 3. Enhancements

### ENH-001 · Config validation saat startup (fail-fast)
**File:** `src/config/index.ts`  
Tambahkan validasi semua required env vars saat startup. Jika ada yang kosong, print pesan error yang jelas dan exit. Jangan biarkan server berjalan dengan config yang salah dan baru crash saat runtime.

```ts
const REQUIRED_ENV = ['API_KEYS', 'REDIS_URL', 'POSTGRES_HOST', 'NEO4J_URI', 'QDRANT_URL'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key]) throw new Error(`Missing required env: ${key}`);
}
```

---

### ENH-002 · LLM retry dengan exponential backoff
**File:** `src/llm/llm-client.ts`  
Saat ini tidak ada retry. LLM provider (lokal maupun remote) bisa timeout sesekali. Tambahkan retry logic dengan max 3 attempts dan backoff `200ms → 400ms → 800ms`.

---

### ENH-003 · Structured logging dengan Pino
**Semua file**  
Ganti semua `console.log` / `console.error` dengan Pino logger. Keuntungan:
- JSON output → mudah di-parse oleh log aggregator
- Log levels (debug/info/warn/error) → bisa filter di production
- Request ID correlation → trace sebuah request di semua log
- Timestamp sudah terformat dengan benar

---

### ENH-004 · Input validation dengan Zod di semua route handlers
**File:** `src/api/routes/*.ts`  
Saat ini parsing dilakukan via type cast `as { field: string }` tanpa validasi runtime. Jika client kirim field yang salah tipe atau missing, error akan muncul jauh di dalam stack.  
Tambahkan Zod schema untuk setiap request body.

---

### ENH-005 · Session persistence ke Redis
**File:** `src/api/session-manager.ts`  
Saat ini sessions disimpan di `Map<>` in-memory — hilang saat server restart. Simpan session metadata ke Redis sehingga server restart tidak memutus semua active sessions. `AgentController` sendiri sudah stateless (semua data di Redis/PG/Qdrant/Neo4j), yang perlu di-persist hanya `SessionInfo`.

---

### ENH-006 · Graceful degradation saat database unavailable
**File:** `src/database/connections.ts`  
Saat ini jika salah satu dari 4 database tidak available saat startup, seluruh server gagal. Implementasi mode degraded:
- Redis down → disable working memory + semantic cache, tapi episodic/semantic tetap jalan
- Qdrant down → disable semantic search, tapi episodic memory tetap jalan
- Neo4j down → disable knowledge graph queries, tapi semua lain tetap jalan

---

### ENH-007 · Health check endpoint per-service
**File:** `src/server.ts`  
Upgrade `GET /api/health` menjadi `GET /api/health/detailed` yang mengembalikan status per-database:
```json
{
  "status": "degraded",
  "services": {
    "redis": "ok",
    "postgres": "ok",
    "qdrant": "ok",
    "neo4j": "unreachable"
  }
}
```
Cloudflare tunnel health check bisa monitor endpoint ini.

---

### ENH-008 · Rate limiting middleware
**File:** `src/api/middleware.ts`  
Tambahkan `withRateLimit(maxPerMinute)` middleware wrapper yang menggunakan Redis sliding window counter (lihat SEC-001). Apply ke endpoint berikut:
- `/api/chat` dan `/api/chat/sync` → 20 req/menit per API key
- `/api/memory/store` → 100 req/menit per API key
- `/api/memory/search` dan `/api/memory/query` → 60 req/menit per API key

---

### ENH-009 · Semantic Cache: O(n) scan → pipeline batch
**File:** `src/memory/semantic-cache.ts`  
Short-term fix untuk BUG-002: ganti sequential `await loadEntry(id)` per entry dengan Redis pipeline batch load, kemudian compute cosine similarity secara parallel. Ini dari O(n × latency) menjadi O(1 round-trip + n compute). Long-term: Redis Stack VSS.

---

### ENH-010 · Konfigurasi `max_tokens` LLM yang adjustable per call type
**File:** `src/llm/llm-client.ts`, `src/config/index.ts`  
Saat ini semua LLM calls pakai `maxTokens: 2048`. Conflict detection dan extraction perlu lebih sedikit token (ringkas), sedangkan reflection dan chat response perlu lebih banyak. Expose `maxTokens` per use-case di config.

---

### ENH-011 · Tambahkan `PATCH /api/memory/:id/feedback` endpoint
**File:** `src/api/routes/memory.ts`  
Feedback saat ini hanya bisa direkam via internal pipeline. Ekspos API untuk client merekam feedback retrieval secara eksplisit (helpful/not helpful). Ini penting untuk adaptive scoring yang akurat.

---

### ENH-012 · Hapus `docker-compose.yml` dari root project atau pindahkan
Karena databases di-manage di home server terpisah, `docker-compose.yml` di root project ini misleading — sepertinya bagian dari project padahal bukan. Opsi:
- Pindahkan ke `infra/docker-compose.yml` dengan README di folder tersebut
- Atau hapus dari repo project ini, simpan di repo/folder infra terpisah

---

### ENH-013 · Context history limit yang configurable
**File:** `src/agent/prompt-builder.ts`  
`recentHistory = conversationHistory.slice(-10)` hardcoded. Jadikan configurable di `config.agent.historyLimit` agar bisa disesuaikan sesuai context window model yang digunakan.

---

## 4. New Features

### FEAT-001 · Memory Export / Import API
Endpoint untuk backup dan restore seluruh memory state:
- `GET /api/memory/export?session_id=` → download JSON dengan semua episodic + semantic memories
- `POST /api/memory/import` → restore dari JSON export
- Berguna untuk: migrasi antar environment, backup sebelum eksperimen, sharing memory state

---

### FEAT-002 · Webhook / Event Notifications
Kirim HTTP callback ke URL yang dikonfigurasi saat event penting terjadi:
- Memory conflict terdeteksi
- Memory dipromote (episodic → semantic → graph)
- Confidence score turun drastis
- Cache hit rate turun di bawah threshold

```env
WEBHOOK_URL=http://your-automation-server/memory-events
WEBHOOK_SECRET=your-hmac-secret
```

---

### FEAT-003 · Batch Memory Operations
Endpoint bulk untuk efisiensi:
- `POST /api/memory/batch/store` → store multiple memories sekaligus
- `POST /api/memory/batch/feedback` → record feedback untuk multiple memories
- Berguna untuk ingest dari external data source (document, chat history)

---

### FEAT-004 · Tool Use / Function Calling Support
Extend `AgentController` untuk mendukung OpenAI-style tool calling:
- Agent bisa memanggil tools yang didefinisikan (web search, file read, calculator)
- Tool results otomatis masuk ke memory pipeline
- Berguna untuk agentic workflows yang lebih kompleks

---

### FEAT-005 · Memory Versioning
Track perubahan semantic memories dari waktu ke waktu:
- Setiap kali memory di-update (confidence berubah, content direvisi), simpan snapshot lama
- `GET /api/memory/:id/history` → lihat evolusi sebuah memory
- Rollback ke versi sebelumnya jika diperlukan

---

### FEAT-006 · Dashboard Real-time Updates via SSE
Dashboard saat ini polling data. Tambahkan SSE endpoint:
- `GET /api/dashboard/stream` → event stream untuk: memory baru, conflict baru, cache stats update
- Dashboard subscribe ke stream ini dan update UI tanpa polling

---

### FEAT-007 · Multi-Agent Memory Sharing
Izinkan beberapa agent berbagi subset memory:
- Semantic memories bisa ditandai sebagai `shared: true`
- Agent dari session berbeda bisa query shared memories
- Berguna untuk: tim agent yang bekerja pada task yang sama, knowledge base bersama

---

### FEAT-008 · Automatic Memory Summarization / Consolidation API
Endpoint manual untuk trigger konsolidasi:
- `POST /api/memory/consolidate` → trigger `MemoryConsolidation.run()` on-demand
- `POST /api/memory/promote/check` → scan dan promote memories yang eligible
- Saat ini proses ini hanya berjalan secara otomatis, tidak bisa di-trigger manual

---

### FEAT-009 · Memory Search dengan Natural Language Filter
Upgrade `POST /api/memory/search` untuk mendukung filter natural language:
- `"memories tentang TypeScript setelah bulan Maret"` → auto-parse menjadi filter `tag: typescript, after: 2026-03-01`
- Gunakan LLM untuk parse query natural language menjadi structured filter
- Hasil lebih relevan untuk non-technical users

---

### FEAT-010 · Dashboard: Conversation Replay
Tab baru di dashboard untuk replay conversation history:
- Pilih session → lihat semua interaksi secara kronologis
- Highlight memory yang di-retrieve di setiap interaksi
- Lihat kapan reflection/strategy dibentuk dalam konteks conversation

---

## 5. Priority Matrix

| ID | Item | Kategori | Priority | Effort |
|----|------|----------|----------|--------|
| BUG-001 | CORS header bocor ke semua origin | Bug / Security | P0 | XS |
| SEC-001 | Tidak ada rate limiting | Security | P0 | S |
| SEC-002 | Default API key di source code | Security | P0 | XS |
| BUG-006 | Redis password tidak dari env var terpisah | Bug | P0 | XS |
| ENH-001 | Config validation saat startup | Enhancement | P0 | XS |
| BUG-003 | `chatStream()` tidak punya timeout/abort | Bug | P1 | XS |
| BUG-007 | `chatJSON()` tidak handle markdown code fence | Bug | P1 | XS |
| BUG-008 | Tidak ada request body size limit | Bug | P1 | XS |
| SEC-003 | Potensi Cypher injection di Knowledge Graph | Security | P1 | S |
| ENH-002 | LLM retry dengan exponential backoff | Enhancement | P1 | S |
| ENH-004 | Input validation dengan Zod | Enhancement | P1 | M |
| ENH-007 | Health check per-service | Enhancement | P1 | S |
| BUG-002 | Semantic Cache O(n) scan | Bug / Perf | P2 | M |
| BUG-004 | Sentinel tidak aman di cached payload | Bug | P2 | XS |
| BUG-005 | Dashboard resolveManager non-deterministik | Bug | P2 | S |
| SEC-004 | Session ID tidak divalidasi kepemilikannya | Security | P2 | M |
| SEC-005 | PostgreSQL tanpa SSL | Security | P2 | XS |
| ENH-003 | Structured logging dengan Pino | Enhancement | P2 | M |
| ENH-005 | Session persistence ke Redis | Enhancement | P2 | M |
| ENH-006 | Graceful degradation database unavailable | Enhancement | P2 | L |
| ENH-008 | Rate limiting middleware | Enhancement | P2 | S |
| ENH-009 | Semantic Cache pipeline batch | Enhancement | P2 | M |
| ENH-012 | Pindahkan docker-compose ke `infra/` | Enhancement | P2 | XS |
| ENH-010 | max_tokens adjustable per call type | Enhancement | P3 | S |
| ENH-011 | `PATCH /api/memory/:id/feedback` endpoint | Enhancement | P3 | S |
| ENH-013 | Context history limit configurable | Enhancement | P3 | XS |
| FEAT-001 | Memory Export / Import API | Feature | P2 | M |
| FEAT-003 | Batch Memory Operations | Feature | P2 | M |
| FEAT-008 | Manual consolidation trigger API | Feature | P2 | S |
| FEAT-002 | Webhook / Event Notifications | Feature | P3 | M |
| FEAT-004 | Tool Use / Function Calling | Feature | P3 | L |
| FEAT-006 | Dashboard Real-time SSE | Feature | P3 | M |
| FEAT-007 | Multi-Agent Memory Sharing | Feature | P3 | L |
| FEAT-005 | Memory Versioning | Feature | P4 | L |
| FEAT-009 | Natural Language Memory Filter | Feature | P4 | L |
| FEAT-010 | Dashboard Conversation Replay | Feature | P4 | M |

**Effort legend:** XS < 1 jam · S = 1–3 jam · M = 0.5–1 hari · L = 2–3 hari

---

## Quick Wins (P0 + P1 yang semua XS/S)

Urutan eksekusi yang disarankan untuk sesi pertama:

1. **BUG-001** — Fix CORS header (5 menit)
2. **BUG-006** — Fix Redis password dari env (10 menit)
3. **SEC-002** — Hapus default API key fallback (5 menit)
4. **ENH-001** — Config validation startup (15 menit)
5. **BUG-003** — Tambah abort ke `chatStream()` (10 menit)
6. **BUG-007** — Strip markdown fence di `chatJSON()` (15 menit)
7. **BUG-004** — Fix cache sentinel (10 menit)
8. **ENH-013** — History limit jadi configurable (5 menit)

Total estimasi: ~75 menit untuk 8 item.
