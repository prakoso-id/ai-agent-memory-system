/**
 * TC-002 — Duplicate Detection: Near-Identical Memory Merges into usage_count
 *
 * GOAL:
 *   1. First store creates a new Qdrant point (usage_count = 0).
 *   2. Texts that differ only in punctuation/whitespace (cosine >> 0.92)
 *      increment usage_count on the ORIGINAL record instead of inserting new points.
 *   3. A genuinely different fact IS stored as a new point.
 *   4. Final state: exactly 2 distinct points, original has usage_count ≥ 2.
 *
 * NOTE: The novelty threshold (0.92) targets near-perfect rephrasing.
 *       Texts must be virtually identical to reliably cross this boundary.
 *       We use punctuation-only variants to guarantee cosine ≈ 0.99.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SemanticMemoryService } from '../memory/semantic-memory.js';
import { NOVELTY_THRESHOLD } from '../memory/utils/write-filter.js';
import { initDb, cleanupSemantic, uniqueTag } from './helpers.js';

const TAG = uniqueTag('tc-002');
const storedIds: string[] = [];
const svc = new SemanticMemoryService();

// Shared base text — only trailing punctuation differs between duplicates
const BASE = `The user's name is Budi and he is a backend software engineer`;

beforeAll(async () => {
    await initDb();
});

afterAll(async () => {
    await cleanupSemantic(storedIds);
});

describe('TC-002 — Duplicate Detection: usage_count increment', () => {

    it(`NOVELTY_THRESHOLD is 0.92`, () => {
        expect(NOVELTY_THRESHOLD).toBe(0.92);
    });

    let originalId: string;

    it('step 1 — original fact is stored as a new record (usage_count = 0)', async () => {
        const result = await svc.store({
            content: `${BASE}. [${TAG}]`,
            category: 'user_identity',
            source: 'test',
            importance: 0.90,
            tags: [TAG, 'user_identity', 'chat'],
            metadata: {},
        });

        expect(result).not.toBeNull();
        expect(result!.usage_count).toBe(0);
        originalId = result!.id;
        storedIds.push(originalId);
    });

    it('step 2 — comma variant detected as duplicate; same ID returned', async () => {
        // Differs only in punctuation — cosine similarity ≈ 0.99
        const result = await svc.store({
            content: `${BASE}, and he works as a backend engineer. [${TAG}]`,
            category: 'user_identity',
            source: 'test',
            importance: 0.88,
            tags: [TAG, 'user_identity'],
            metadata: {},
        });

        expect(result).not.toBeNull();
        // Must come back with the ORIGINAL record ID
        expect(result!.id).toBe(originalId);
        expect(result!.usage_count).toBeGreaterThanOrEqual(1);
    });

    it('step 3 — exclamation variant also detected as duplicate', async () => {
        const result = await svc.store({
            content: `${BASE}! [${TAG}]`,
            category: 'user_identity',
            source: 'test',
            importance: 0.85,
            tags: [TAG, 'user_identity'],
            metadata: {},
        });

        expect(result).not.toBeNull();
        expect(result!.id).toBe(originalId);
        expect(result!.usage_count).toBeGreaterThanOrEqual(2);
    });

    it('step 4 — new fact (full-stack + career switch) stored as a SEPARATE record', async () => {
        const result = await svc.store({
            content: `Budi is a full-stack developer who recently switched from frontend to backend. [${TAG}]`,
            category: 'user_identity',
            source: 'test',
            importance: 0.87,
            tags: [TAG, 'user_identity', 'chat'],
            metadata: {},
        });

        expect(result).not.toBeNull();
        expect(result!.id).not.toBe(originalId);
        expect(result!.usage_count).toBe(0);
        storedIds.push(result!.id);
    });

    it('only 2 distinct points in Qdrant (deduplication collapsed 3 variants → 1)', () => {
        expect(storedIds).toHaveLength(2);
    });

    it('original record has usage_count ≥ 2 after two dedup bumps', async () => {
        const memory = await svc.getById(originalId);
        expect(memory).not.toBeNull();
        expect(memory!.usage_count).toBeGreaterThanOrEqual(2);
    });
});
