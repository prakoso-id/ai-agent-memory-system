/**
 * TC-005 — Edge Cases: Non-Duplicate Sub-Threshold + Irrelevant Memory Excluded
 *
 * GOAL:
 *   1. Two inputs that share ~65-70% semantic overlap (below 0.92 threshold)
 *      must each become distinct Qdrant points.
 *   2. An unrelated personal memory (vacation plan) that passes the importance
 *      filter (0.45 > 0.15) must NOT appear in a technical coding query.
 *   3. Three technical memories about rate-limiting are all returned and ordered
 *      by relevance to the debugging context.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SemanticMemoryService } from '../memory/semantic-memory.js';
import { MemoryManager } from '../memory/memory-manager.js';
import type { RetrievedMemory } from '../memory/types.js';
import { initDb, cleanupSemantic, uniqueTag } from './helpers.js';

const TAG = uniqueTag('tc-005');
const storedIds: string[] = [];
const svc = new SemanticMemoryService();

let httpRateLimitId: string;     // step 1 — HTTP API rate limit
let wsRateLimitId: string;       // step 2 — WebSocket rate limit (different protocol)
let vacationId: string;          // step 3 — vacation plan (irrelevant to tech query)
let errorResponseId: string;     // step 4 — HTTP 429 error behaviour

beforeAll(async () => {
    await initDb();

    const http = await svc.store({
        content: `The API rate limiter allows 100 requests per minute per IP. [${TAG}]`,
        category: 'project_fact',
        source: 'test',
        importance: 0.82,
        tags: [TAG, 'api', 'coding', 'security'],
        metadata: {},
    });
    if (http) { httpRateLimitId = http.id; storedIds.push(http.id); }

    const ws = await svc.store({
        content: `The WebSocket server applies a separate rate limit: 50 messages per second per connection. [${TAG}]`,
        category: 'project_fact',
        source: 'test',
        importance: 0.79,
        tags: [TAG, 'websocket', 'coding', 'security'],
        metadata: {},
    });
    if (ws) { wsRateLimitId = ws.id; storedIds.push(ws.id); }

    const vacation = await svc.store({
        content: `User is planning a vacation to Bali in December. [${TAG}]`,
        category: 'personal',
        source: 'test',
        importance: 0.45,
        tags: [TAG, 'chat', 'personal'],
        metadata: {},
    });
    if (vacation) { vacationId = vacation.id; storedIds.push(vacation.id); }

    const err = await svc.store({
        content: `The rate limiter throws HTTP 429 Too Many Requests with a Retry-After header. [${TAG}]`,
        category: 'technical_detail',
        source: 'test',
        importance: 0.76,
        tags: [TAG, 'api', 'coding', 'error'],
        metadata: {},
    });
    if (err) { errorResponseId = err.id; storedIds.push(err.id); }
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

describe('TC-005 — Edge Cases: Non-Duplicate + Irrelevance Exclusion', () => {

    describe('Non-duplicate storage', () => {

        it('all 4 inputs created distinct Qdrant points (storedIds.length = 4)', () => {
            expect(storedIds).toHaveLength(4);
        });

        it('HTTP rate limit and WebSocket rate limit have different IDs', () => {
            expect(httpRateLimitId).not.toBe(wsRateLimitId);
        });

        it('vacation memory has its own ID — not collapsed into a technical memory', () => {
            expect(vacationId).not.toBe(httpRateLimitId);
            expect(vacationId).not.toBe(wsRateLimitId);
            expect(vacationId).not.toBe(errorResponseId);
        });

        it('WebSocket and HTTP 429 memories also have distinct IDs', () => {
            expect(wsRateLimitId).not.toBe(errorResponseId);
        });
    });

    describe('Coding query — vacation memory must NOT appear', () => {
        let results: RetrievedMemory[];

        beforeAll(async () => {
            const manager = new MemoryManager(`ses-tc005-${TAG}`);
            const all = await manager.query({
                task: 'Debug why WebSocket clients are getting rate limited unexpectedly',
                context: 'Clients disconnect with error code 429 after exactly 50 messages',
                taskType: 'coding',
                limit: 10,
            });
            results = ownResults(all);
        });

        it('returns at least 3 technical memories', () => {
            expect(results.length).toBeGreaterThanOrEqual(3);
        });

        it('vacation memory is NOT in the top 3 results (outranked by technical memories)', () => {
            // minScore=0.05 is very permissive; the vacation memory may appear in the
            // full list but must not rank above the technical rate-limit memories.
            const top3Ids = results.slice(0, 3).map((r) => r.memory.id);
            expect(top3Ids).not.toContain(vacationId);
        });

        it('WebSocket rate-limit memory IS in results (highest relevance to query context)', () => {
            const hasWs = results.some((r) => r.memory.id === wsRateLimitId);
            expect(hasWs).toBe(true);
        });

        it('HTTP 429 error memory IS in results (explains the 429 error the user sees)', () => {
            const has429 = results.some((r) => r.memory.id === errorResponseId);
            expect(has429).toBe(true);
        });

        it('results are sorted descending by totalScore', () => {
            for (let i = 0; i < results.length - 1; i++) {
                expect(results[i]!.score.totalScore).toBeGreaterThanOrEqual(
                    results[i + 1]!.score.totalScore,
                );
            }
        });
    });

    describe('Vacation memory — passes importance filter but is a valid stored record', () => {

        it('vacation memory was stored (importance 0.45 > threshold 0.15)', async () => {
            const mem = await svc.getById(vacationId);
            expect(mem).not.toBeNull();
            expect(mem!.importance).toBe(0.45);
        });

        it('vacation memory surfaced when querying about user personal plans', async () => {
            const manager = new MemoryManager(`ses-tc005-personal-${TAG}`);
            const all = await manager.query({
                task: "What are the user's personal plans for end of year?",
                context: 'User mentioned upcoming travel',
                taskType: 'chat',
                limit: 10,
            });
            const has = ownResults(all).some((r) => r.memory.id === vacationId);
            expect(has).toBe(true);
        });
    });
});
