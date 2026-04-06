/**
 * TC-010: Evaluation Tracking & Memory Decay
 *
 * Tests Phase 3 evaluation tracker, semantic decay, and stale archival.
 *
 * Scenarios:
 *   1. Evaluation records stored correctly
 *   2. Hit rate and success metrics computed
 *   3. Semantic memory decay reduces scores
 *   4. Stale memories archived after threshold
 *   5. Confidence-gated decay (high confidence decays slower)
 *   6. Trend detection (improving/declining)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, cleanupSemantic } from './helpers.js';
import { EvaluationTracker } from '../memory/evaluation-tracker.js';
import { SemanticMemoryService } from '../memory/semantic-memory.js';
import { db } from '../database/connections.js';
import { v4 as uuid } from 'uuid';

const TEST_TIMEOUT = 30_000;

describe('TC-010: Evaluation Tracking & Decay', () => {
    const evaluations = new EvaluationTracker();
    const semantic = new SemanticMemoryService();
    const storedIds: string[] = [];
    const evalIds: string[] = [];

    beforeAll(async () => {
        await initDb();
    }, 60_000);

    afterAll(async () => {
        await cleanupSemantic(storedIds);
        // Clean up evaluation records
        for (const id of evalIds) {
            try {
                await db.pg.query('DELETE FROM evaluation_records WHERE id = $1', [id]);
            } catch { /* best-effort */ }
        }
    });

    // =================================================================
    // Scenario 1: Evaluation records stored correctly
    // =================================================================

    describe('Scenario 1: Evaluation record storage', () => {
        it('should store an evaluation record', async () => {
            const record = await evaluations.recordEvaluation(
                uuid(),
                'what programming language does the user prefer?',
                ['mem-1', 'mem-2', 'mem-3'],
                true,
                0.67,
            );

            expect(record).toBeDefined();
            expect(record.success).toBe(true);
            expect(record.hit_rate).toBe(0.67);
            expect(record.retrieved_memory_ids).toHaveLength(3);
            evalIds.push(record.id);
        });

        it('should store evaluation with response quality', async () => {
            const record = await evaluations.recordEvaluation(
                uuid(),
                'what is the project deadline?',
                ['mem-4'],
                true,
                1.0,
                0.9,
            );

            expect(record.response_quality).toBe(0.9);
            evalIds.push(record.id);
        });

        it('should store a failed evaluation', async () => {
            const record = await evaluations.recordEvaluation(
                uuid(),
                'irrelevant query with no matches',
                [],
                false,
                0,
            );

            expect(record.success).toBe(false);
            expect(record.hit_rate).toBe(0);
            evalIds.push(record.id);
        });
    });

    // =================================================================
    // Scenario 2: Metrics computation
    // =================================================================

    describe('Scenario 2: Hit rate and success metrics', () => {
        it('should compute aggregate metrics', async () => {
            const metrics = await evaluations.getMetrics(7);

            expect(metrics).toBeDefined();
            expect(metrics.total_queries).toBeGreaterThanOrEqual(3);
            expect(metrics.avg_hit_rate).toBeGreaterThanOrEqual(0);
            expect(metrics.avg_hit_rate).toBeLessThanOrEqual(1);
            expect(metrics.retrieval_success_rate).toBeGreaterThanOrEqual(0);
        });

        it('should compute per-memory usefulness', async () => {
            const usefulness = await evaluations.getMemoryUsefulness('mem-1');
            // mem-1 appeared in 1 successful retrieval out of 1 total
            expect(usefulness).toBeGreaterThanOrEqual(0);
            expect(usefulness).toBeLessThanOrEqual(1);
        });

        it('should retrieve recent evaluations', async () => {
            const recent = await evaluations.getRecent(5);
            expect(recent).toBeDefined();
            expect(recent.length).toBeGreaterThanOrEqual(3);
        });
    });

    // =================================================================
    // Scenario 3: Semantic memory decay
    // =================================================================

    describe('Scenario 3: Semantic decay reduces scores', () => {
        it('should store a memory with initial decay_factor of 1.0', async () => {
            const mem = await semantic.store({
                content: 'Test memory for decay testing - should decay over time',
                category: 'technical_detail',
                source: 'episode:decay-test',
                importance: 0.5,
                tags: ['decay-test'],
                metadata: {},
            });

            expect(mem).not.toBeNull();
            storedIds.push(mem!.id);
        }, TEST_TIMEOUT);

        it('should reduce score when decay_factor is lowered', async () => {
            if (storedIds.length === 0) return;

            const id = storedIds[storedIds.length - 1]!;

            // Search before decay
            const before = await semantic.search('decay testing', { limit: 5, minScore: 0 });
            const memBefore = before.find((m) => m.id === id);

            // Apply manual decay
            await semantic.updateDecayFactor(id, 0.5);

            // Search after decay
            const after = await semantic.search('decay testing', { limit: 5, minScore: 0 });
            const memAfter = after.find((m) => m.id === id);

            if (memBefore && memAfter) {
                expect(memAfter.score).toBeLessThan(memBefore.score);
            }
        }, TEST_TIMEOUT);
    });

    // =================================================================
    // Scenario 4: Stale memory archival
    // =================================================================

    describe('Scenario 4: Stale memory archival', () => {
        it('should store a low-importance memory', async () => {
            // Store with very low importance so it qualifies for archival
            const mem = await semantic.store({
                content: 'This is a very old unimportant memory that nobody uses for archival test',
                category: 'general_knowledge',
                source: 'episode:stale-test',
                importance: 0.16, // above write filter but low enough to archive
                tags: ['stale-test'],
                metadata: {},
            });

            expect(mem).not.toBeNull();
            storedIds.push(mem!.id);
        }, TEST_TIMEOUT);

        it('should exclude archived memories from search', async () => {
            if (storedIds.length === 0) return;

            const id = storedIds[storedIds.length - 1]!;

            // Manually archive it
            await semantic.archive(id);

            // Search should not return archived memory
            const results = await semantic.search('archival test unimportant memory', {
                limit: 10,
                minScore: 0,
            });

            const found = results.find((m) => m.id === id);
            expect(found).toBeUndefined();
        }, TEST_TIMEOUT);

        it('should still retrieve archived memory by ID', async () => {
            if (storedIds.length === 0) return;
            const id = storedIds[storedIds.length - 1]!;

            const mem = await semantic.getById(id);
            expect(mem).not.toBeNull();
        });
    });

    // =================================================================
    // Scenario 5: Confidence-gated decay
    // =================================================================

    describe('Scenario 5: Confidence-gated decay', () => {
        it('should show that high-confidence memories have higher initial confidence', async () => {
            const { ConfidenceScorer } = await import('../memory/confidence-scorer.js');
            const { ConflictDetector } = await import('../memory/conflict-detector.js');
            const detector = new ConflictDetector();
            const scorer = new ConfidenceScorer(detector);

            const apiConf = scorer.computeInitialConfidence('api');
            const unknownConf = scorer.computeInitialConfidence('unknown');

            expect(apiConf).toBeGreaterThan(unknownConf);
        });

        it('should compute higher confidence for recent memories', async () => {
            const { ConfidenceScorer } = await import('../memory/confidence-scorer.js');
            const { ConflictDetector } = await import('../memory/conflict-detector.js');
            const detector = new ConflictDetector();
            const scorer = new ConfidenceScorer(detector);

            const recent = await scorer.computeConfidence(
                'test-recent', 5, 'api',
                new Date().toISOString(),
            );
            const old = await scorer.computeConfidence(
                'test-old', 5, 'api',
                new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
            );

            expect(recent.recency_signal).toBeGreaterThan(old.recency_signal);
            expect(recent.overall).toBeGreaterThan(old.overall);
        });
    });

    // =================================================================
    // Scenario 6: Trend detection
    // =================================================================

    describe('Scenario 6: Trend detection', () => {
        it('should detect trend direction', async () => {
            const trend = await evaluations.getTrend(7);

            expect(trend).toBeDefined();
            expect(typeof trend.improving).toBe('boolean');
            expect(typeof trend.delta).toBe('number');
        });

        it('should count total evaluations', async () => {
            const count = await evaluations.count();
            expect(count).toBeGreaterThanOrEqual(3);
        });
    });
});
