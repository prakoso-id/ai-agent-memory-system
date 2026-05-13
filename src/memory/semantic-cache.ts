import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import { llm } from '../llm/llm-client.js';
import { config } from '../config/index.js';
import type { CacheHit, SemanticCacheEntry, SemanticCacheStats } from './types.js';

/**
 * Semantic Cache — Phase 4 / Enhancement 3.
 *
 * Reduces LLM calls by storing and retrieving semantically similar query
 * responses from Redis.
 *
 * Flow:
 *   get(query)
 *     1. Hash query for exact-match fast path
 *     2. Embed query
 *     3. Scan Redis cache index and compute cosine similarity
 *     4. If best similarity ≥ threshold → return cached response (decompressed)
 *     5. Else → return null (caller proceeds with LLM)
 *
 *   set(query, response)
 *     1. Embed query
 *     2. Compress response (gzip)
 *     3. Store entry in Redis with TTL
 *     4. Add entry ID to index set
 *
 * Public API (middleware-style):
 *   semanticCache.get(query)              → CacheHit | null
 *   semanticCache.set(query, response)    → void
 *   semanticCache.getStats()              → SemanticCacheStats
 *   semanticCache.invalidate(entryId)     → void
 *   semanticCache.flush()                 → void
 */
export class SemanticCache {
    private readonly prefix: string;
    private readonly indexKey: string;
    private readonly threshold: number;
    private readonly ttl: number;
    private readonly maxEntries: number;
    private readonly enabled: boolean;
    private readonly counterKey: string;

    constructor() {
        this.prefix    = config.semanticCache.keyPrefix;
        this.indexKey  = config.semanticCache.indexKey;
        this.threshold = config.semanticCache.similarityThreshold;
        this.ttl       = config.semanticCache.ttlSeconds;
        this.maxEntries = config.semanticCache.maxEntries;
        this.enabled   = config.semanticCache.enabled;
        this.counterKey = config.observability.cacheCounterKey;
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    /**
     * Try to retrieve a cached response for the given query.
     *
     * Returns a `CacheHit` when a sufficiently similar cached query exists,
     * or `null` if the caller must execute the LLM pipeline.
     */
    async get(query: string): Promise<CacheHit | null> {
        if (!this.enabled) return null;

        const start = Date.now();

        // Fast path: exact hash match
        const hash = this.hashQuery(query);
        const exactKey = `${this.prefix}hash:${hash}`;
        const exactId  = await db.redis.get(exactKey);
        if (exactId) {
            const entry = await this.loadEntry(exactId);
            if (entry) {
                await this.recordHit(exactId, 1.0, Date.now() - start);
                console.log(`  🎯 [SemanticCache] Exact hit (hash) — latency ${Date.now() - start}ms`);
                return { response: entry.response, similarity: 1.0, entryId: exactId };
            }
        }

        // Slow path: cosine similarity scan
        const queryEmbedding = await llm.embed(query);
        const ids = await db.redis.smembers(this.indexKey);

        let bestId: string | null = null;
        let bestSim = -1;

        for (const id of ids) {
            const entry = await this.loadEntry(id);
            if (!entry) continue;

            const sim = cosineSimilarity(queryEmbedding, entry.embedding);
            if (sim > bestSim) {
                bestSim = sim;
                bestId  = id;
            }
        }

        if (bestId && bestSim >= this.threshold) {
            const entry = await this.loadEntry(bestId);
            if (!entry) return null;

            await this.recordHit(bestId, bestSim, Date.now() - start);
            console.log(
                `  🎯 [SemanticCache] Semantic hit — similarity=${bestSim.toFixed(4)} ` +
                `latency=${Date.now() - start}ms`,
            );
            return { response: entry.response, similarity: bestSim, entryId: bestId };
        }

        await this.recordMiss(Date.now() - start);
        console.log(
            `  ❌ [SemanticCache] Cache miss — best_sim=${bestSim.toFixed(4)} ` +
            `threshold=${this.threshold} latency=${Date.now() - start}ms`,
        );
        return null;
    }

    /**
     * Store a query/response pair in the cache.
     *
     * The response is gzip-compressed before storage to reduce Redis memory
     * usage. The embedding is stored as a JSON array.
     */
    async set(query: string, response: string): Promise<void> {
        if (!this.enabled) return;

        const embedding  = await llm.embed(query);
        const compressed = this.compress(response);
        const id         = uuid();
        const hash       = this.hashQuery(query);

        const entry: SemanticCacheEntry = {
            queryHash: hash,
            embedding,
            response: compressed,
            queryText: query.substring(0, 200),   // cap stored text
            createdAt: new Date().toISOString(),
            hitCount: 0,
        };

        // Store entry JSON with TTL
        const entryKey = this.entryKey(id);
        await db.redis.set(entryKey, JSON.stringify(entry), 'EX', this.ttl);

        // Maintain index set and exact-hash lookup
        await db.redis.sadd(this.indexKey, id);
        await db.redis.set(`${this.prefix}hash:${hash}`, id, 'EX', this.ttl);

        // Evict if over capacity
        if (this.maxEntries > 0) {
            await this.evictIfNeeded();
        }

        console.log(
            `  💾 [SemanticCache] Stored entry ${id.substring(0, 8)} ` +
            `(compressed ${response.length}→${compressed.length} chars, TTL ${this.ttl}s)`,
        );
    }

    /** Invalidate a specific cache entry (e.g. when caller detects stale data) */
    async invalidate(entryId: string): Promise<void> {
        const entry = await this.loadEntry(entryId);
        if (entry) {
            await db.redis.del(`${this.prefix}hash:${entry.queryHash}`);
        }
        await db.redis.del(this.entryKey(entryId));
        await db.redis.srem(this.indexKey, entryId);
        console.log(`  🗑️  [SemanticCache] Invalidated entry ${entryId.substring(0, 8)}`);
    }

    /** Remove all cache entries */
    async flush(): Promise<void> {
        const ids = await db.redis.smembers(this.indexKey);
        const pipeline = db.redis.pipeline();
        for (const id of ids) {
            pipeline.del(this.entryKey(id));
        }
        pipeline.del(this.indexKey);
        await pipeline.exec();
        console.log(`  🗑️  [SemanticCache] Flushed ${ids.length} entries`);
    }

    /** Return aggregate cache statistics */
    async getStats(): Promise<SemanticCacheStats> {
        const [totalEntries, hits, misses, totalSim] = await Promise.all([
            db.redis.scard(this.indexKey),
            db.redis.hget(this.counterKey, 'hits').then(v => parseInt(v ?? '0')),
            db.redis.hget(this.counterKey, 'misses').then(v => parseInt(v ?? '0')),
            db.redis.hget(this.counterKey, 'totalSim').then(v => parseFloat(v ?? '0')),
        ]);

        const total = hits + misses;
        return {
            totalEntries,
            hitRate:            total > 0 ? hits / total : 0,
            totalHits:          hits,
            totalMisses:        misses,
            avgSimilarityOnHit: hits > 0 ? totalSim / hits : 0,
        };
    }

    // =====================================================================
    // PRIVATE HELPERS
    // =====================================================================

    private entryKey(id: string): string {
        return `${this.prefix}entry:${id}`;
    }

    private hashQuery(query: string): string {
        return createHash('sha256').update(query.trim().toLowerCase()).digest('hex');
    }

    private compress(data: string): string {
        return gzipSync(Buffer.from(data, 'utf-8')).toString('base64');
    }

    private decompress(data: string): string {
        return gunzipSync(Buffer.from(data, 'base64')).toString('utf-8');
    }

    private async loadEntry(id: string): Promise<(SemanticCacheEntry & { response: string }) | null> {
        const raw = await db.redis.get(this.entryKey(id));
        if (!raw) {
            // Entry TTL expired — clean from index
            await db.redis.srem(this.indexKey, id);
            return null;
        }
        const entry: SemanticCacheEntry = JSON.parse(raw);
        return {
            ...entry,
            response: this.decompress(entry.response),
        };
    }

    private async recordHit(entryId: string, similarity: number, latencyMs: number): Promise<void> {
        const pipeline = db.redis.pipeline();
        pipeline.hincrby(this.counterKey, 'hits', 1);
        pipeline.hincrbyfloat(this.counterKey, 'totalSim', similarity);
        // Bump entry hit count
        const entryKey = this.entryKey(entryId);
        const raw = await db.redis.get(entryKey);
        if (raw) {
            const entry: SemanticCacheEntry = JSON.parse(raw);
            entry.hitCount++;
            pipeline.set(entryKey, JSON.stringify(entry), 'KEEPTTL');
        }
        await pipeline.exec();
        void latencyMs; // recorded separately by ObservabilityService
    }

    private async recordMiss(latencyMs: number): Promise<void> {
        await db.redis.hincrby(this.counterKey, 'misses', 1);
        void latencyMs;
    }

    /**
     * Simple LRU-style eviction: if total entries exceed maxEntries,
     * remove entries with the lowest hit count first.
     */
    private async evictIfNeeded(): Promise<void> {
        const count = await db.redis.scard(this.indexKey);
        if (count <= this.maxEntries) return;

        const ids = await db.redis.smembers(this.indexKey);
        const scored: Array<{ id: string; hitCount: number }> = [];

        for (const id of ids) {
            const raw = await db.redis.get(this.entryKey(id));
            const entry: SemanticCacheEntry | null = raw ? JSON.parse(raw) : null;
            scored.push({ id, hitCount: entry?.hitCount ?? 0 });
        }

        // Sort ascending by hit count — evict least-used
        scored.sort((a, b) => a.hitCount - b.hitCount);
        const toEvict = scored.slice(0, count - this.maxEntries);

        for (const { id } of toEvict) {
            await this.invalidate(id);
        }
        console.log(`  ♻️  [SemanticCache] Evicted ${toEvict.length} LRU entries`);
    }
}

// =====================================================================
// PURE MATH UTILITY
// =====================================================================

/**
 * Cosine similarity between two equal-length numeric vectors.
 * Returns a value in [-1, 1]; 1.0 = identical direction.
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot   += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

/** Singleton instance */
export const semanticCache = new SemanticCache();
