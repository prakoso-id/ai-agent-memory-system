/**
 * TC-004 — Composite Score: Importance + Popularity Balance Recency
 *
 * GOAL: Verify that the composite scorer correctly balances multiple signals.
 *   • A high-importance memory scores above a low-importance one.
 *   • A frequently-accessed memory (simulated via incrementUsageCount)
 *     outranks a brand-new but low-importance one even after that new
 *     one has higher recency.
 *
 * Composite weights (from reranker.ts):
 *   0.35 × semantic_similarity
 *   0.25 × recency
 *   0.20 × importance
 *   0.10 × task_relevance
 *   0.10 × usage_popularity  (saturates at count=20)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SemanticMemoryService } from '../memory/semantic-memory.js';
import { MemoryManager } from '../memory/memory-manager.js';
import type { RetrievedMemory } from '../memory/types.js';
import { initDb, cleanupSemantic, uniqueTag } from './helpers.js';

const TAG = uniqueTag('tc-004');
const storedIds: string[] = [];
const svc = new SemanticMemoryService();

let highImportanceId: string;   // importance=0.90, will be bumped to usage_count=12
let lowImportanceId: string;    // importance=0.30, fresh (usage_count=0)
let midMemoryId: string;        // importance=0.70, usage_count=5

beforeAll(async () => {
    await initDb();

    // ── Store 3 database-related memories ─────────────────────────────────

    const pgMem = await svc.store({
        content: `The primary database is PostgreSQL 16 running in Docker. [${TAG}]`,
        category: 'project_fact',
        source: 'test',
        importance: 0.90,
        tags: [TAG, 'database', 'architecture', 'planning'],
        metadata: {},
    });
    if (pgMem) {
        highImportanceId = pgMem.id;
        storedIds.push(pgMem.id);
        // Simulate 12 retrieval hits to build up usage_count
        for (let i = 0; i < 12; i++) {
            await svc.incrementUsageCount(pgMem.id);
        }
    }

    const sqliteMem = await svc.store({
        content: `SQLite was considered but ruled out due to concurrency limits. [${TAG}]`,
        category: 'decision',
        source: 'test',
        importance: 0.30,
        tags: [TAG, 'database', 'decision'],
        metadata: {},
    });
    if (sqliteMem) {
        lowImportanceId = sqliteMem.id;
        storedIds.push(sqliteMem.id);
        // usage_count stays 0 — brand new, never retrieved
    }

    const redisMem = await svc.store({
        content: `Redis is used for session caching with a 30-minute TTL. [${TAG}]`,
        category: 'project_fact',
        source: 'test',
        importance: 0.70,
        tags: [TAG, 'database', 'architecture', 'coding'],
        metadata: {},
    });
    if (redisMem) {
        midMemoryId = redisMem.id;
        storedIds.push(redisMem.id);
        for (let i = 0; i < 5; i++) {
            await svc.incrementUsageCount(redisMem.id);
        }
    }
});

afterAll(async () => {
    await cleanupSemantic(storedIds);
});

// ── Helpers ────────────────────────────────────────────────────────────────

function ownResults(results: RetrievedMemory[]): RetrievedMemory[] {
    return results.filter(
        (r) => r.source === 'semantic' && (r.memory.tags ?? []).includes(TAG),
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TC-004 — Composite Score: Importance + Popularity', () => {

    it('high-importance memory has usage_count = 12 after 12 increments', async () => {
        const mem = await svc.getById(highImportanceId);
        expect(mem).not.toBeNull();
        expect(mem!.usage_count).toBe(12);
    });

    it('mid memory has usage_count = 5', async () => {
        const mem = await svc.getById(midMemoryId);
        expect(mem).not.toBeNull();
        expect(mem!.usage_count).toBe(5);
    });

    it('low-importance memory has usage_count = 0', async () => {
        const mem = await svc.getById(lowImportanceId);
        expect(mem).not.toBeNull();
        expect(mem!.usage_count).toBe(0);
    });

    describe('query: "Which database for the new analytics service?"', () => {
        let results: RetrievedMemory[];

        beforeAll(async () => {
            const manager = new MemoryManager(`ses-tc004-${TAG}`);
            const all = await manager.query({
                task: 'Which database should I use for the new analytics service?',
                context: 'High read throughput and low write latency required',
                taskType: 'planning',
                limit: 10,
            });
            results = ownResults(all);
        });

        it('returns all 3 test memories', () => {
            expect(results.length).toBeGreaterThanOrEqual(3);
        });

        it('results are sorted descending by totalScore', () => {
            for (let i = 0; i < results.length - 1; i++) {
                expect(results[i]!.score.totalScore).toBeGreaterThanOrEqual(
                    results[i + 1]!.score.totalScore,
                );
            }
        });

        it('PostgreSQL memory (high importance + high popularity) ranks above SQLite memory', () => {
            const pgResult = results.find((r) => r.memory.id === highImportanceId);
            const sqliteResult = results.find((r) => r.memory.id === lowImportanceId);

            expect(pgResult).toBeDefined();
            expect(sqliteResult).toBeDefined();
            expect(pgResult!.score.totalScore).toBeGreaterThan(sqliteResult!.score.totalScore);
        });

        it('PostgreSQL memory ranks #1 overall among our test memories', () => {
            expect(results[0]!.memory.id).toBe(highImportanceId);
        });

        it('SQLite (low importance, zero popularity) ranks last among our test memories', () => {
            const last = results[results.length - 1];
            expect(last!.memory.id).toBe(lowImportanceId);
        });
    });
});
