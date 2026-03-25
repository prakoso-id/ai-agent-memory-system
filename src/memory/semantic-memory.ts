import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import { config } from '../config/index.js';
import { llm } from '../llm/llm-client.js';
import { passesImportanceFilter, findDuplicateId } from './utils/write-filter.js';
import type { SemanticMemory } from './types.js';

/**
 * Semantic Memory — Qdrant-backed vector store.
 *
 * Phase 1 additions:
 *   • Write filtering: importance threshold + novelty detection
 *   • Duplicate handling: increment usage_count instead of inserting
 *   • Extended payload: usage_count, last_accessed, tags
 *   • last_accessed is updated asynchronously on every search hit
 */
export class SemanticMemoryService {
    private collection = config.qdrant.collection;

    // ====================================================================
    // WRITE
    // ====================================================================

    /**
     * Store a new semantic memory with auto-generated embedding.
     *
     * Returns:
     *   - The stored (or existing) `SemanticMemory` on success.
     *   - `null` when the memory is filtered out by the importance threshold.
     *
     * If a near-duplicate already exists (cosine ≥ 0.92) the duplicate's
     * `usage_count` is incremented and that record is returned.
     */
    async store(
        memory: Omit<SemanticMemory, 'id' | 'timestamp' | 'embedding' | 'usage_count' | 'last_accessed'>,
    ): Promise<SemanticMemory | null> {
        // Gate 1: importance filter — skip cheap noise before embedding
        if (!passesImportanceFilter(memory.importance)) {
            console.log(
                `    ⚪ Skipped low-importance memory (${memory.importance.toFixed(2)}): ` +
                `"${memory.content.substring(0, 60)}"`,
            );
            return null;
        }

        const embedding = await llm.embed(memory.content);

        // Gate 2: novelty / duplicate detection
        const duplicateId = await findDuplicateId(embedding, this.collection);
        if (duplicateId) {
            console.log(
                `    ♻️  Duplicate detected (id: ${duplicateId.substring(0, 8)}…) — bumping usage_count`,
            );
            await this.incrementUsageCount(duplicateId);
            return this.getById(duplicateId);
        }

        // New memory
        const id = uuid();
        const timestamp = new Date().toISOString();

        await db.qdrant.upsert(this.collection, {
            wait: true,
            points: [
                {
                    id,
                    vector: embedding,
                    payload: {
                        content: memory.content,
                        category: memory.category,
                        source: memory.source,
                        importance: memory.importance,
                        usage_count: 0,
                        last_accessed: timestamp,
                        tags: memory.tags ?? [],
                        timestamp,
                        metadata: memory.metadata,
                    },
                },
            ],
        });

        return {
            ...memory,
            id,
            timestamp,
            embedding,
            usage_count: 0,
            last_accessed: timestamp,
            tags: memory.tags ?? [],
        };
    }

    // ====================================================================
    // READ
    // ====================================================================

    /**
     * Semantic similarity search.
     * Updates `last_accessed` on returned hits so recency reflects actual use.
     */
    async search(
        query: string,
        options?: {
            limit?: number;
            minScore?: number;
            category?: string;
        },
    ): Promise<Array<SemanticMemory & { score: number }>> {
        const queryEmbedding = await llm.embed(query);
        const limit = options?.limit ?? config.agent.memoryRetrievalLimit;
        const scoreThreshold = options?.minScore ?? 0.05;

        const filter = options?.category
            ? { must: [{ key: 'category', match: { value: options.category } }] }
            : undefined;

        const results = await db.qdrant.search(this.collection, {
            vector: queryEmbedding,
            limit,
            score_threshold: scoreThreshold,
            filter,
            with_payload: true,
        });

        console.log(
            `    🔎 Semantic search: query="${query.substring(0, 50)}" ` +
            `threshold=${scoreThreshold} results=${results.length}`,
        );
        for (const r of results.slice(0, 3)) {
            console.log(
                `       score=${r.score.toFixed(4)} ` +
                `"${(r.payload?.content as string)?.substring(0, 60)}"`,
            );
        }

        // Touch last_accessed asynchronously — don't block search
        const now = new Date().toISOString();
        for (const r of results) {
            this.touchLastAccessed(r.id as string, now).catch(() => {});
        }

        return results.map((r) => ({
            id: r.id as string,
            content: r.payload!.content as string,
            category: r.payload!.category as string,
            source: r.payload!.source as string,
            importance: r.payload!.importance as number,
            usage_count: (r.payload!.usage_count as number) ?? 0,
            last_accessed: (r.payload!.last_accessed as string) ?? now,
            tags: (r.payload!.tags as string[]) ?? [],
            timestamp: r.payload!.timestamp as string,
            metadata: (r.payload!.metadata as Record<string, unknown>) ?? {},
            score: r.score,
        }));
    }

    /** Retrieve a single semantic memory by its Qdrant point ID. */
    async getById(id: string): Promise<SemanticMemory | null> {
        const points = await db.qdrant.retrieve(this.collection, {
            ids: [id],
            with_payload: true,
            with_vector: false,
        });
        if (points.length === 0) return null;

        const p = points[0]!;
        const payload = p.payload!;
        return {
            id: p.id as string,
            content: payload.content as string,
            category: payload.category as string,
            source: payload.source as string,
            importance: payload.importance as number,
            usage_count: (payload.usage_count as number) ?? 0,
            last_accessed: (payload.last_accessed as string) ?? (payload.timestamp as string),
            tags: (payload.tags as string[]) ?? [],
            timestamp: payload.timestamp as string,
            metadata: (payload.metadata as Record<string, unknown>) ?? {},
        };
    }

    // ====================================================================
    // UPDATE
    // ====================================================================

    /** Update an existing memory's content and re-embed. */
    async update(id: string, content: string, importance?: number): Promise<void> {
        const embedding = await llm.embed(content);
        const existing = await db.qdrant.retrieve(this.collection, {
            ids: [id],
            with_payload: true,
        });

        if (existing.length === 0) throw new Error(`Semantic memory ${id} not found`);

        await db.qdrant.upsert(this.collection, {
            wait: true,
            points: [
                {
                    id,
                    vector: embedding,
                    payload: {
                        ...existing[0]!.payload,
                        content,
                        importance: importance ?? (existing[0]!.payload!.importance as number),
                        timestamp: new Date().toISOString(),
                    },
                },
            ],
        });
    }

    /** Increment the `usage_count` payload field for a given point. */
    async incrementUsageCount(id: string): Promise<void> {
        const points = await db.qdrant.retrieve(this.collection, {
            ids: [id],
            with_payload: true,
            with_vector: false,
        });
        if (points.length === 0) return;

        const current = (points[0]!.payload!.usage_count as number) ?? 0;
        await db.qdrant.setPayload(this.collection, {
            payload: { usage_count: current + 1, last_accessed: new Date().toISOString() },
            points: [id],
        });
    }

    // ====================================================================
    // DELETE / COUNT
    // ====================================================================

    /** Delete a semantic memory by ID. */
    async delete(id: string): Promise<void> {
        await db.qdrant.delete(this.collection, { points: [id] });
    }

    /** Total count of semantic memories in the collection. */
    async count(): Promise<number> {
        const info = await db.qdrant.getCollection(this.collection);
        return info.points_count ?? 0;
    }

    // ====================================================================
    // PRIVATE HELPERS
    // ====================================================================

    private async touchLastAccessed(id: string, timestamp: string): Promise<void> {
        await db.qdrant.setPayload(this.collection, {
            payload: { last_accessed: timestamp },
            points: [id],
        });
    }
}
