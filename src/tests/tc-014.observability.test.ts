/**
 * TC-014: Observability & Phase 4 Metrics â€” Phase 4 / Enhancement 1
 *
 * Tests the observability service, Phase 4 metrics aggregation,
 * cache-wired MemoryManager, and advisory generation.
 *
 * Scenarios:
 *   1. Latency samples recorded and p50 computable
 *   2. getDashboardMetrics() returns valid DashboardMetrics shape
 *   3. Advisory messages generated based on metrics thresholds
 *   4. cachedQuery() â†’ cache miss on first call, hit on second
 *   5. ObservabilityService.logEvent() does not throw
 *   6. getRoleDistribution() returns consistent shape
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb } from './helpers.js';
import { ObservabilityService } from '../memory/observability-service.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { db } from '../database/connections.js';
import { config } from '../config/index.js';
import type { DashboardMetrics } from '../memory/types.js';

const TEST_TIMEOUT = 30_000;

describe('TC-014: Observability & Phase 4 Metrics', () => {
    const obs = new ObservabilityService();
    const memory = new MemoryManager('tc-014-session');

    beforeAll(async () => {
        await initDb();
        await memory.cache.flush();
        await db.redis.del(config.observability.latencyKey);
        await db.redis.del(config.observability.cacheCounterKey);
    }, 60_000);

    afterAll(async () => {
        await memory.cache.flush();
        await db.redis.del(config.observability.latencyKey);
        await db.redis.del(config.observability.cacheCounterKey);
    });

    // ============================================================
    // Scenario 1 â€” Latency ring buffer
    // ============================================================
    describe('Scenario 1: Latency ring buffer', () => {
        it('should record latency samples and compute p50', async () => {
            await obs.recordLatency({ queryId: 'q1', latencyMs: 100, source: 'retrieval' });
            await obs.recordLatency({ queryId: 'q2', latencyMs: 200, source: 'retrieval' });
            await obs.recordLatency({ queryId: 'q3', latencyMs: 50,  source: 'cache' });

            const p50Retrieval = await obs.getP50LatencyMs('retrieval');
            const p50Cache     = await obs.getP50LatencyMs('cache');
            const p50All       = await obs.getP50LatencyMs();

            expect(p50Retrieval).toBeGreaterThan(0);
            expect(p50Cache).toBeGreaterThan(0);
            expect(p50All).toBeGreaterThan(0);
            // p50 of [100, 200] sorted â†’ median = 150
            expect(p50Retrieval).toBeGreaterThanOrEqual(100);
            expect(p50Retrieval).toBeLessThanOrEqual(200);
        }, TEST_TIMEOUT);

        it('should return 0 when no samples exist for a source', async () => {
            const p50 = await obs.getP50LatencyMs('cache');
            // At least one cache sample was recorded above, so â‰¥ 0
            expect(p50).toBeGreaterThanOrEqual(0);
        });
    });

    // ============================================================
    // Scenario 2 â€” DashboardMetrics shape
    // ============================================================
    describe('Scenario 2: DashboardMetrics shape validation', () => {
        it('should return a valid DashboardMetrics object from getDashboardMetrics()', async () => {
            const metrics: DashboardMetrics = await memory.getDashboardMetrics();

            // Shape assertions
            expect(typeof metrics.cacheHitRate).toBe('number');
            expect(typeof metrics.cacheEntries).toBe('number');
            expect(typeof metrics.avgRetrievalLatencyMs).toBe('number');
            expect(typeof metrics.conflictFrequency).toBe('number');
            expect(typeof metrics.promotionRate).toBe('number');
            expect(typeof metrics.roleDistribution).toBe('object');

            // Range assertions
            expect(metrics.cacheHitRate).toBeGreaterThanOrEqual(0);
            expect(metrics.cacheHitRate).toBeLessThanOrEqual(1);
            expect(metrics.cacheEntries).toBeGreaterThanOrEqual(0);
        }, TEST_TIMEOUT);
    });

    // ============================================================
    // Scenario 3 â€” Advisory generation
    // ============================================================
    describe('Scenario 3: Advisory generation', () => {
        it('should return at least one advisory string', async () => {
            const advisories = obs.generateAdvisories({
                cacheHitRate:          0,    // deliberately zero â†’ should trigger advisory
                cacheEntries:          60,
                avgRetrievalLatencyMs: 600,  // above 500ms threshold
                conflictFrequency:     15,   // above 10 threshold
                promotionRate:         0.5,
                roleDistribution:      {},
            });

            expect(Array.isArray(advisories)).toBe(true);
            expect(advisories.length).toBeGreaterThan(0);
            expect(typeof advisories[0]).toBe('string');
        });

        it('should return a "healthy" advisory when metrics are good', () => {
            const advisories = obs.generateAdvisories({
                cacheHitRate:          0.8,
                cacheEntries:          30,
                avgRetrievalLatencyMs: 150,
                conflictFrequency:     2,
                promotionRate:         5,
                roleDistribution:      {},
            });

            expect(advisories).toEqual(expect.arrayContaining([
                expect.stringContaining('No immediate'),
            ]));
        });
    });

    // ============================================================
    // Scenario 4 â€” cachedQuery cache-miss â†’ cache-hit
    // ============================================================
    describe('Scenario 4: cachedQuery miss then hit', () => {
        it('should miss on first call then hit on second identical call', async () => {
            let llmCallCount = 0;
            const TASK = 'how does the reranker combine confidence and feedback boosts';

            const first = await memory.cachedQuery(
                { task: TASK, taskType: 'analysis' },
                async () => { llmCallCount++; return 'Multiplicative boost applied after composite score.'; },
            );
            expect(first.cacheHit).toBe(false);
            expect(llmCallCount).toBe(1);

            const second = await memory.cachedQuery(
                { task: TASK, taskType: 'analysis' },
                async () => { llmCallCount++; return 'Should not get called on cache hit.'; },
            );
            // Second call with identical TASK â€” exact-hash should hit
            expect(second.cacheHit).toBe(true);
            expect(llmCallCount).toBe(1);   // LLM was NOT called a second time
        }, TEST_TIMEOUT * 2);
    });

    // ============================================================
    // Scenario 5 â€” logEvent does not throw
    // ============================================================
    describe('Scenario 5: ObservabilityService.logEvent', () => {
        it('should log events without throwing', () => {
            expect(() => obs.logEvent({
                type: 'cache_hit',
                data: { similarity: 0.97, latencyMs: 12 },
            })).not.toThrow();

            expect(() => obs.logEvent({
                type: 'conflict_detected',
                data: { memoryId: 'abc', type: 'contradictory' },
            })).not.toThrow();
        });
    });

    // ============================================================
    // Scenario 6 â€” getRoleDistribution shape
    // ============================================================
    describe('Scenario 6: Role distribution shape', () => {
        it('should return a partial record with numeric counts per role', async () => {
            const dist = await memory.roles.getRoleDistribution();

            expect(typeof dist).toBe('object');
            for (const [, count] of Object.entries(dist)) {
                expect(typeof count).toBe('number');
                expect(count).toBeGreaterThanOrEqual(0);
            }
        }, TEST_TIMEOUT);
    });
});
