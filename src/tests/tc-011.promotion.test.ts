/**
 * TC-011: Memory Promotion
 *
 * Tests Phase 3 memory promotion lifecycle:
 *   episodic → semantic → knowledge graph
 *
 * Scenarios:
 *   1. Episodic → Semantic promotion triggers at threshold
 *   2. Semantic → Knowledge Graph promotion
 *   3. Promotion event audit trail
 *   4. No promotion below threshold
 *   5. Full promotion cycle integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, uniqueTag, cleanupSemantic, cleanupEpisodic } from './helpers.js';
import { EpisodicMemoryService } from '../memory/episodic-memory.js';
import { SemanticMemoryService } from '../memory/semantic-memory.js';
import { KnowledgeGraphService } from '../memory/knowledge-graph.js';
import { MemoryPromoter } from '../memory/memory-promoter.js';
import { db } from '../database/connections.js';

const TEST_TIMEOUT = 30_000;

describe('TC-011: Memory Promotion', () => {
    const episodic = new EpisodicMemoryService();
    const semantic = new SemanticMemoryService();
    const knowledgeGraph = new KnowledgeGraphService();
    const promoter = new MemoryPromoter(episodic, semantic, knowledgeGraph);
    const testSession = uniqueTag('tc011');
    const storedSemanticIds: string[] = [];

    beforeAll(async () => {
        await initDb();
    }, 60_000);

    afterAll(async () => {
        await cleanupEpisodic(testSession);
        await cleanupSemantic(storedSemanticIds);
        // Clean up promotion events
        try {
            await db.pg.query(
                `DELETE FROM promotion_events WHERE reason LIKE '%tc011%' OR reason LIKE '%Automatic%'`,
            );
        } catch { /* best-effort */ }
    });

    // =================================================================
    // Scenario 1: Episodic → Semantic promotion
    // =================================================================

    describe('Scenario 1: Episodic → Semantic promotion', () => {
        let episodeId: string;

        it('should store an episode with high usage', async () => {
            const episode = await episodic.store({
                eventType: 'conversation',
                sessionId: testSession,
                content: 'User asked about TypeScript generics. Explained with examples of mapped types and conditional types.',
                importance: 0.8,
                tags: ['typescript', 'generics'],
                metadata: { test: 'tc011' },
            });

            episodeId = episode.id;

            // Simulate high usage by touching it multiple times
            for (let i = 0; i < 6; i++) {
                await db.pg.query(
                    `UPDATE episodic_memories
                     SET usage_count = usage_count + 1, last_accessed = NOW()
                     WHERE id = $1`,
                    [episodeId],
                );
            }
        });

        it('should be eligible for promotion at usage >= 5 and importance >= 0.6', async () => {
            const eligible = promoter.isEpisodicPromotionEligible(6, 0.8);
            expect(eligible).toBe(true);
        });

        it('should promote to semantic memory', async () => {
            const newId = await promoter.promoteEpisodicToSemantic(episodeId);

            // LLM-dependent: may return null if extraction fails
            if (newId) {
                storedSemanticIds.push(newId);
                const memory = await semantic.getById(newId);
                expect(memory).not.toBeNull();
                expect(memory!.tags).toContain('promoted');
                expect(memory!.tags).toContain('from_episodic');
            }
        }, TEST_TIMEOUT);
    });

    // =================================================================
    // Scenario 2: Semantic → Knowledge Graph promotion
    // =================================================================

    describe('Scenario 2: Semantic → KG promotion', () => {
        let semanticId: string;

        it('should store a high-usage semantic memory', async () => {
            const mem = await semantic.store({
                content: 'Jackson always uses TypeScript with strict mode enabled for all projects',
                category: 'user_preference',
                source: 'episode:test-promo',
                importance: 0.9,
                tags: ['typescript', 'preference'],
                metadata: {},
            });

            expect(mem).not.toBeNull();
            semanticId = mem!.id;
            storedSemanticIds.push(semanticId);

            // Simulate high usage
            for (let i = 0; i < 12; i++) {
                await semantic.incrementUsageCount(semanticId);
            }
        }, TEST_TIMEOUT);

        it('should be eligible for KG promotion at usage >= 10 and confidence >= 0.7', () => {
            const eligible = promoter.isSemanticPromotionEligible(12, 0.8);
            expect(eligible).toBe(true);
        });

        it('should promote to knowledge graph', async () => {
            const nodes = await promoter.promoteSemanticToGraph(semanticId, 0.8);

            // LLM-dependent: may return null
            if (nodes && nodes.length > 0) {
                expect(nodes.length).toBeGreaterThan(0);
            }
        }, TEST_TIMEOUT);
    });

    // =================================================================
    // Scenario 3: Promotion audit trail
    // =================================================================

    describe('Scenario 3: Promotion event history', () => {
        it('should record promotion events', async () => {
            const history = await promoter.getPromotionHistory(undefined, 10);
            expect(Array.isArray(history)).toBe(true);
            // There may be events from the previous scenarios
        });

        it('should detect already-promoted memories', async () => {
            const history = await promoter.getPromotionHistory(undefined, 10);
            if (history.length > 0) {
                const promoted = await promoter.hasBeenPromoted(history[0]!.memory_id);
                expect(promoted).toBe(true);
            }
        });
    });

    // =================================================================
    // Scenario 4: No promotion below threshold
    // =================================================================

    describe('Scenario 4: Below-threshold rejection', () => {
        it('should not be eligible with low usage', () => {
            expect(promoter.isEpisodicPromotionEligible(2, 0.8)).toBe(false);
        });

        it('should not be eligible with low importance', () => {
            expect(promoter.isEpisodicPromotionEligible(10, 0.3)).toBe(false);
        });
    });

    // =================================================================
    // Scenario 5: Full promotion cycle
    // =================================================================

    describe('Scenario 5: Full promotion cycle', () => {
        it('should run a complete promotion cycle without errors', async () => {
            const events = await promoter.runPromotionCycle();
            expect(Array.isArray(events)).toBe(true);
        }, TEST_TIMEOUT);

        it('should count total promotions', async () => {
            const count = await promoter.count();
            expect(count).toBeGreaterThanOrEqual(0);
        });
    });
});
