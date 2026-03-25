/**
 * TC-003 — Context-Aware Retrieval: Same Store, Different task_type Reranks Results
 *
 * GOAL: Store a mixed set of memories tagged for different task types.
 *       Issue two queries against the same data — one with task_type='coding',
 *       one with task_type='planning' — and assert that:
 *         • Coding-tagged memories score higher task_relevance in the coding query.
 *         • Planning-tagged memories score higher task_relevance in the planning query.
 *         • The #1 result is different between the two queries.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SemanticMemoryService } from '../memory/semantic-memory.js';
import { MemoryManager } from '../memory/memory-manager.js';
import type { RetrievedMemory } from '../memory/types.js';
import { initDb, cleanupSemantic, uniqueTag } from './helpers.js';

const TAG = uniqueTag('tc-003');
const storedIds: string[] = [];
const svc = new SemanticMemoryService();

// IDs for the two distinct memory "flavours"
let codingMemoryId: string;
let planningMemoryId: string;

beforeAll(async () => {
    await initDb();

    // ── Seed memories ──────────────────────────────────────────────────────
    const authImpl = await svc.store({
        content: `The auth service uses JWT tokens with 15-minute expiry and refresh rotation. [${TAG}]`,
        category: 'project_fact',
        source: 'test',
        importance: 0.85,
        tags: [TAG, 'security', 'coding', 'api', 'architecture'],
        metadata: {},
    });
    if (authImpl) { storedIds.push(authImpl.id); codingMemoryId = authImpl.id; }

    const roadmap = await svc.store({
        content: `Q3 roadmap includes migrating the auth service to OAuth 2.0 with PKCE. [${TAG}]`,
        category: 'project_fact',
        source: 'test',
        importance: 0.80,
        tags: [TAG, 'planning', 'roadmap', 'milestone', 'authentication'],
        metadata: {},
    });
    if (roadmap) { storedIds.push(roadmap.id); planningMemoryId = roadmap.id; }

    const errorCode = await svc.store({
        content: `User wants refresh token endpoint to throw 401 instead of 403 on expiry. [${TAG}]`,
        category: 'user_preference',
        source: 'test',
        importance: 0.78,
        tags: [TAG, 'coding', 'api', 'user_preference', 'error'],
        metadata: {},
    });
    if (errorCode) storedIds.push(errorCode.id);

    const budget = await svc.store({
        content: `Stakeholders approved the OAuth migration budget in the last sprint review. [${TAG}]`,
        category: 'decision',
        source: 'test',
        importance: 0.72,
        tags: [TAG, 'planning', 'decision', 'stakeholder', 'roadmap'],
        metadata: {},
    });
    if (budget) storedIds.push(budget.id);
});

afterAll(async () => {
    await cleanupSemantic(storedIds);
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** From a result set, find memories that are from our test TAG */
function ownResults(results: RetrievedMemory[]): RetrievedMemory[] {
    return results.filter(
        (r) => r.source === 'semantic' && (r.memory.tags ?? []).includes(TAG),
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TC-003 — Context-Aware Retrieval: task_type reranking', () => {

    it('all 4 seed memories were stored', () => {
        expect(storedIds).toHaveLength(4);
    });

    describe('coding query — task_type = coding', () => {
        let codingResults: RetrievedMemory[];

        beforeAll(async () => {
            const manager = new MemoryManager(`ses-tc003-coding-${TAG}`);
            const all = await manager.query({
                task: 'Fix the 401 vs 403 error code in the refresh token handler',
                context: 'JWT middleware is throwing the wrong HTTP status',
                taskType: 'coding',
                limit: 10,
            });
            codingResults = ownResults(all);
        });

        it('returns at least 2 of our test memories', () => {
            expect(codingResults.length).toBeGreaterThanOrEqual(2);
        });

        it('coding-tagged memories have task_relevance > 0.5', () => {
            const codingMem = codingResults.find((r) => r.memory.id === codingMemoryId);
            expect(codingMem).toBeDefined();
            expect(codingMem!.score.taskRelevance).toBeGreaterThan(0.5);
        });

        it('results are sorted descending by totalScore', () => {
            for (let i = 0; i < codingResults.length - 1; i++) {
                expect(codingResults[i]!.score.totalScore).toBeGreaterThanOrEqual(
                    codingResults[i + 1]!.score.totalScore,
                );
            }
        });
    });

    describe('planning query — task_type = planning', () => {
        let planningResults: RetrievedMemory[];

        beforeAll(async () => {
            const manager = new MemoryManager(`ses-tc003-planning-${TAG}`);
            const all = await manager.query({
                task: 'Update the Q3 roadmap with the OAuth migration decision',
                context: 'Sprint review outcome needs to be incorporated',
                taskType: 'planning',
                limit: 10,
            });
            planningResults = ownResults(all);
        });

        it('returns at least 2 of our test memories', () => {
            expect(planningResults.length).toBeGreaterThanOrEqual(2);
        });

        it('planning-tagged memories have task_relevance > 0.5', () => {
            const planMem = planningResults.find((r) => r.memory.id === planningMemoryId);
            expect(planMem).toBeDefined();
            expect(planMem!.score.taskRelevance).toBeGreaterThan(0.5);
        });

        it('results are sorted descending by totalScore', () => {
            for (let i = 0; i < planningResults.length - 1; i++) {
                expect(planningResults[i]!.score.totalScore).toBeGreaterThanOrEqual(
                    planningResults[i + 1]!.score.totalScore,
                );
            }
        });
    });

    it('top result differs between coding and planning query', async () => {
        const manager = new MemoryManager(`ses-tc003-diff-${TAG}`);

        const codingTop = ownResults(await manager.query({
            task: 'Fix 401 vs 403 error in JWT middleware',
            taskType: 'coding',
            limit: 10,
        }))[0];

        const planningTop = ownResults(await manager.query({
            task: 'Update the Q3 OAuth migration roadmap',
            taskType: 'planning',
            limit: 10,
        }))[0];

        // The #1 result should not be the same memory for both task types
        expect(codingTop?.memory.id).not.toBe(planningTop?.memory.id);
    });
});
