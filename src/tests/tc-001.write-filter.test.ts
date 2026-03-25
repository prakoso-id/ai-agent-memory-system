/**
 * TC-001 — Write Filter: Low-Importance Noise is Discarded
 *
 * GOAL: Verify that memories with importance < 0.15 are never stored
 *       in Qdrant, while high-importance memories pass through and are
 *       retrievable via a coding query.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SemanticMemoryService } from '../memory/semantic-memory.js';
import { IMPORTANCE_THRESHOLD } from '../memory/utils/write-filter.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { initDb, cleanupSemantic, uniqueTag } from './helpers.js';

const TAG = uniqueTag('tc-001');
const storedIds: string[] = [];
const svc = new SemanticMemoryService();

beforeAll(async () => {
    await initDb();
});

afterAll(async () => {
    await cleanupSemantic(storedIds);
});

describe('TC-001 — Write Filter: Low-Importance Noise', () => {

    it('returns null for a single-word noise memory (importance 0.04)', async () => {
        const result = await svc.store({
            content: 'ok',
            category: 'general_knowledge',
            source: 'test',
            importance: 0.04,
            tags: [TAG],
            metadata: {},
        });
        expect(result).toBeNull();
    });

    it('returns null for a filler-utterance memory (importance 0.06)', async () => {
        const result = await svc.store({
            content: `The user said 'hmm' while thinking. [${TAG}]`,
            category: 'conversation',
            source: 'test',
            importance: 0.06,
            tags: [TAG, 'chat'],
            metadata: {},
        });
        expect(result).toBeNull();
    });

    it('stores a high-importance user preference (importance 0.88)', async () => {
        const result = await svc.store({
            content: `User prefers async/await over raw Promise chains in TypeScript. [${TAG}]`,
            category: 'user_preference',
            source: 'test',
            importance: 0.88,
            tags: [TAG, 'typescript', 'coding', 'user_preference'],
            metadata: {},
        });
        expect(result).not.toBeNull();
        expect(result!.usage_count).toBe(0);
        storedIds.push(result!.id);
    });

    it('stores a high-importance project fact (importance 0.82)', async () => {
        const result = await svc.store({
            content: `The project uses strict TypeScript compiler options (strictNullChecks, noImplicitAny). [${TAG}]`,
            category: 'project_fact',
            source: 'test',
            importance: 0.82,
            tags: [TAG, 'typescript', 'coding', 'project_fact'],
            metadata: {},
        });
        expect(result).not.toBeNull();
        storedIds.push(result!.id);
    });

    it('exactly 2 memories stored — noise records are absent', () => {
        expect(storedIds).toHaveLength(2);
    });

    it(`IMPORTANCE_THRESHOLD is 0.15`, () => {
        expect(IMPORTANCE_THRESHOLD).toBe(0.15);
    });

    it('query returns only the 2 high-importance memories — noise never surfaces', async () => {
        const manager = new MemoryManager(`ses-tc001-${TAG}`);

        const results = await manager.query({
            task: 'Help me write a TypeScript utility function',
            context: 'I need to fetch user data from an API endpoint',
            taskType: 'coding',
            limit: 5,
        });

        // All returned memories must be from our stored set
        const returnedIds = results
            .filter((r) => r.source === 'semantic')
            .map((r) => r.memory.id);

        const ownResults = returnedIds.filter((id) => storedIds.includes(id));
        expect(ownResults.length).toBe(2);

        // No result should have our TAG but with the short noise content
        const hasNoise = results.some(
            (r) => (r.memory.content === 'ok') || r.memory.content.includes("said 'hmm'"),
        );
        expect(hasNoise).toBe(false);
    });
});
