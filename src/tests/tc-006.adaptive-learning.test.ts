/**
 * TC-006 — Adaptive Learning: Feedback-Driven Retrieval Scoring
 *
 * GOAL: Prove that retrieval feedback actually shifts retrieval rankings.
 *
 *   Simulasi:
 *     • Memory A: di-feedback 10× "used=true, helpful=true"
 *     • Memory B: di-feedback 5× "used=false, helpful=false"
 *     • Memory C: no feedback (neutral baseline)
 *
 *   Expected:
 *     • A punya boost > 1.0 (consistently helpful → boosted)
 *     • B punya boost < 1.0 (consistently unhelpful → penalized)
 *     • C punya boost = 1.0 (no data → neutral)
 *     • Retrieval: A muncul di atas B, padahal importance sama
 *
 *   Kalau B tetap di atas A setelah feedback:
 *     👉 adaptive scoring cuma teori indah
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SemanticMemoryService } from '../memory/semantic-memory.js';
import { FeedbackTracker } from '../memory/feedback-tracker.js';
import { MemoryManager } from '../memory/memory-manager.js';
import type { RetrievedMemory } from '../memory/types.js';
import { initDb, cleanupSemantic, cleanupFeedback, uniqueTag } from './helpers.js';

const TAG = uniqueTag('tc-006');
const storedIds: string[] = [];
const svc = new SemanticMemoryService();
const feedback = new FeedbackTracker();

let memoryA_id: string; // akan di-boost (helpful)
let memoryB_id: string; // akan di-penalty (unhelpful)
let memoryC_id: string; // baseline (no feedback)

beforeAll(async () => {
    await initDb();

    // 3 memory dengan importance SAMA (0.7) — bedanya cuma feedback

    const memA = await svc.store({
        content: `TypeScript strict mode should always be enabled for production projects. [${TAG}]`,
        category: 'technical_detail',
        source: 'test',
        importance: 0.70,
        tags: [TAG, 'typescript', 'coding', 'best_practice'],
        metadata: {},
    });
    if (memA) {
        memoryA_id = memA.id;
        storedIds.push(memA.id);
    }

    const memB = await svc.store({
        content: `TypeScript can be configured with various compiler flags for type checking. [${TAG}]`,
        category: 'technical_detail',
        source: 'test',
        importance: 0.70,
        tags: [TAG, 'typescript', 'coding'],
        metadata: {},
    });
    if (memB) {
        memoryB_id = memB.id;
        storedIds.push(memB.id);
    }

    const memC = await svc.store({
        content: `TypeScript interfaces are preferred over type aliases for object shapes. [${TAG}]`,
        category: 'technical_detail',
        source: 'test',
        importance: 0.70,
        tags: [TAG, 'typescript', 'coding'],
        metadata: {},
    });
    if (memC) {
        memoryC_id = memC.id;
        storedIds.push(memC.id);
    }

    // Memory A: 10× helpful feedback → boost tinggi
    for (let i = 0; i < 10; i++) {
        await feedback.recordFeedback({
            memory_id: memoryA_id,
            query: 'typescript best practices',
            used: true,
            helpful: true,
        });
    }

    // Memory B: 5× unhelpful feedback → penalty
    for (let i = 0; i < 5; i++) {
        await feedback.recordFeedback({
            memory_id: memoryB_id,
            query: 'typescript best practices',
            used: true,
            helpful: false,
        });
    }

    // Memory C: no feedback → neutral

    // Reset tracker cache agar test baca fresh
    feedback.resetWeights();
});

afterAll(async () => {
    await cleanupSemantic(storedIds);
    await cleanupFeedback(storedIds);
});

// ── Helpers ────────────────────────────────────────────────────────────────

function ownResults(results: RetrievedMemory[]): RetrievedMemory[] {
    return results.filter(
        (r) => r.source === 'semantic' && (r.memory.tags ?? []).includes(TAG),
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TC-006 — Adaptive Learning: Feedback-Driven Scoring', () => {

    // ═══════════════════════════════════════════════════════════════════════
    // 1. BOOST SCORES
    // ═══════════════════════════════════════════════════════════════════════

    describe('boost scores reflect feedback history', () => {
        it('Memory A (10× helpful) has boost > 1.0', async () => {
            const boost = await feedback.getMemoryBoost(memoryA_id);
            expect(boost).toBeGreaterThan(1.0);
            console.log(`    Memory A boost: ${boost.toFixed(3)}`);
        });

        it('Memory B (5× unhelpful) has boost < 1.0', async () => {
            const boost = await feedback.getMemoryBoost(memoryB_id);
            expect(boost).toBeLessThan(1.0);
            console.log(`    Memory B boost: ${boost.toFixed(3)}`);
        });

        it('Memory C (no feedback) has boost = 1.0 (neutral)', async () => {
            const boost = await feedback.getMemoryBoost(memoryC_id);
            expect(boost).toBe(1.0);
            console.log(`    Memory C boost: ${boost.toFixed(3)}`);
        });

        it('A-boost > B-boost (helpful beats unhelpful)', async () => {
            const boostA = await feedback.getMemoryBoost(memoryA_id);
            const boostB = await feedback.getMemoryBoost(memoryB_id);
            expect(boostA).toBeGreaterThan(boostB);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. BATCH BOOST
    // ═══════════════════════════════════════════════════════════════════════

    describe('batch boost retrieval', () => {
        it('getBoosts() returns correct boosts for all 3 memories in one call', async () => {
            const boosts = await feedback.getBoosts([memoryA_id, memoryB_id, memoryC_id]);
            expect(boosts.size).toBe(3);
            expect(boosts.get(memoryA_id)!).toBeGreaterThan(1.0);
            expect(boosts.get(memoryB_id)!).toBeLessThan(1.0);
            expect(boosts.get(memoryC_id)!).toBe(1.0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. RETRIEVAL RANKING — feedback actually moves the needle
    // ═══════════════════════════════════════════════════════════════════════

    describe('retrieval ranking reflects feedback', () => {
        let results: RetrievedMemory[];

        beforeAll(async () => {
            const manager = new MemoryManager(`ses-tc006-${TAG}`);
            const all = await manager.query({
                task: 'What are the best TypeScript configuration practices?',
                taskType: 'coding',
                limit: 10,
            });
            results = ownResults(all);
        });

        it('returns all 3 test memories', () => {
            expect(results.length).toBeGreaterThanOrEqual(3);
        });

        it('Memory A (boosted) ranks above Memory B (penalized)', () => {
            const idxA = results.findIndex((r) => r.memory.id === memoryA_id);
            const idxB = results.findIndex((r) => r.memory.id === memoryB_id);
            expect(idxA).toBeGreaterThanOrEqual(0);
            expect(idxB).toBeGreaterThanOrEqual(0);
            expect(idxA).toBeLessThan(idxB); // lower index = higher rank
            console.log(`    A rank: #${idxA + 1}, B rank: #${idxB + 1}`);
        });

        it('Memory A has higher totalScore than Memory B', () => {
            const memA = results.find((r) => r.memory.id === memoryA_id);
            const memB = results.find((r) => r.memory.id === memoryB_id);
            expect(memA!.score.totalScore).toBeGreaterThan(memB!.score.totalScore);
            console.log(`    A score: ${memA!.score.totalScore.toFixed(4)}, B score: ${memB!.score.totalScore.toFixed(4)}`);
        });

        it('the score gap between A and B is at least 10% (feedback has real impact)', () => {
            const memA = results.find((r) => r.memory.id === memoryA_id);
            const memB = results.find((r) => r.memory.id === memoryB_id);
            const gap = (memA!.score.totalScore - memB!.score.totalScore) / memA!.score.totalScore;
            expect(gap).toBeGreaterThanOrEqual(0.10);
            console.log(`    Score gap: ${(gap * 100).toFixed(1)}%`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. ADAPTIVE WEIGHTS
    // ═══════════════════════════════════════════════════════════════════════

    describe('adaptive weights', () => {
        it('getAdaptiveWeights() returns valid weight distribution', async () => {
            const weights = await feedback.getAdaptiveWeights();
            const sum =
                weights.semanticSimilarity +
                weights.recency +
                weights.importance +
                weights.taskRelevance +
                weights.usagePopularity;

            // Weights should sum to ~1.0
            expect(sum).toBeCloseTo(1.0, 1);

            // All weights should be non-negative
            expect(weights.semanticSimilarity).toBeGreaterThanOrEqual(0);
            expect(weights.recency).toBeGreaterThanOrEqual(0);
            expect(weights.importance).toBeGreaterThanOrEqual(0);
            expect(weights.taskRelevance).toBeGreaterThanOrEqual(0);
            expect(weights.usagePopularity).toBeGreaterThanOrEqual(0);
        });
    });
});
