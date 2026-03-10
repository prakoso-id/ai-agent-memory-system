import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import { config } from '../config/index.js';
import { llm } from '../llm/llm-client.js';
import type { SemanticMemory } from './types.js';

/**
 * Semantic Memory — Qdrant-backed vector store.
 * Stores extracted knowledge with embeddings for similarity search.
 */
export class SemanticMemoryService {
    private collection = config.qdrant.collection;

    /** Store a new semantic memory with auto-generated embedding */
    async store(memory: Omit<SemanticMemory, 'id' | 'timestamp' | 'embedding'>): Promise<SemanticMemory> {
        const id = uuid();
        const embedding = await llm.embed(memory.content);
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
                        timestamp,
                        metadata: memory.metadata,
                    },
                },
            ],
        });

        return { ...memory, id, timestamp, embedding };
    }

    /** Semantic similarity search */
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

        // Debug logging
        console.log(`    🔎 Semantic search: query="${query.substring(0, 50)}" threshold=${scoreThreshold} results=${results.length}`);
        for (const r of results.slice(0, 3)) {
            console.log(`       score=${r.score.toFixed(4)} "${(r.payload?.content as string)?.substring(0, 60)}..."`);
        }

        return results.map((r) => ({
            id: r.id as string,
            content: r.payload!.content as string,
            category: r.payload!.category as string,
            source: r.payload!.source as string,
            importance: r.payload!.importance as number,
            timestamp: r.payload!.timestamp as string,
            metadata: (r.payload!.metadata as Record<string, unknown>) ?? {},
            score: r.score,
        }));
    }

    /** Update an existing memory's content and re-embed */
    async update(id: string, content: string, importance?: number): Promise<void> {
        const embedding = await llm.embed(content);
        const existing = await db.qdrant.retrieve(this.collection, { ids: [id], with_payload: true });

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

    /** Delete a semantic memory */
    async delete(id: string): Promise<void> {
        await db.qdrant.delete(this.collection, { points: [id] });
    }

    /** Get total count of semantic memories */
    async count(): Promise<number> {
        const info = await db.qdrant.getCollection(this.collection);
        return info.points_count ?? 0;
    }
}
