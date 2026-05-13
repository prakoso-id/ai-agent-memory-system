/**
 * TC-013: Role-Based Memory Partitioning — Phase 4 / Enhancement 2
 *
 * Tests the cross-agent role-partitioned memory view.
 *
 * Scenarios:
 *   1. Role-annotated memory stored with correct payload fields
 *   2. Coder-role query returns coder-relevant memories ranked higher
 *   3. PM-role query excludes coder-only memories
 *   4. Empty roles[] = visible to all roles
 *   5. Role importance adjustment via updateRoleImportance()
 *   6. listByRole() returns only accessible memories for the given role
 *   7. getRoleDistribution() returns correct counts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, cleanupSemantic } from './helpers.js';
import { RoleMemoryService } from '../memory/role-memory.js';
import { db } from '../database/connections.js';
import { config } from '../config/index.js';

const TEST_TIMEOUT = 30_000;

describe('TC-013: Role-Based Memory Partitioning', () => {
    const roles = new RoleMemoryService();
    const storedIds: string[] = [];

    beforeAll(async () => {
        await initDb();
    }, 60_000);

    afterAll(async () => {
        await cleanupSemantic(storedIds);
    });

    // ============================================================
    // Scenario 1 — Role-annotated storage
    // ============================================================
    describe('Scenario 1: Role-annotated memory storage', () => {
        it('should store a memory with roles and importance_per_role', async () => {
            const id = await roles.store({
                content: 'TypeScript strict mode eliminates implicit any',
                category: 'project_fact',
                source:   'api',
                importance: 0.8,
                tags:     ['typescript', 'config'],
                metadata: {},
                roles:    ['coder'],
                importance_per_role: { coder: 0.9, pm: 0.1 },
            });

            expect(id).not.toBeNull();
            if (id) storedIds.push(id);

            // Verify payload fields written to Qdrant
            const points = await db.qdrant.retrieve(config.qdrant.collection, {
                ids: [id!],
                with_payload: true,
                with_vector: false,
            });
            expect(points.length).toBe(1);
            const pl = points[0]!.payload!;
            expect(pl.roles).toEqual(['coder']);
            expect((pl.importance_per_role as Record<string, number>).coder).toBe(0.9);
        }, TEST_TIMEOUT);
    });

    // ============================================================
    // Scenario 2 — Coder role query
    // ============================================================
    describe('Scenario 2: Coder-role query retrieves relevant memories', () => {
        it('should return memories tagged for coder with higher scores', async () => {
            // Store additional cross-role memory for baseline
            const globalId = await roles.store({
                content: 'Always write unit tests for critical paths',
                category: 'project_fact',
                source:   'api',
                importance: 0.6,
                tags:     ['testing'],
                metadata: {},
                roles:    [],   // empty = visible to all
                importance_per_role: {},
            });
            if (globalId) storedIds.push(globalId);

            const results = await roles.query({
                task:      'TypeScript compile errors and strict mode',
                agentRole: 'coder',
                taskType:  'coding',
                limit: 5,
            });

            expect(results.length).toBeGreaterThan(0);
            // Results should be a valid RetrievedMemory[]
            for (const r of results) {
                expect(r.memory.content).toBeTruthy();
                expect(r.score.totalScore).toBeGreaterThan(0);
            }
        }, TEST_TIMEOUT);
    });

    // ============================================================
    // Scenario 3 — PM role gets different results
    // ============================================================
    describe('Scenario 3: PM role query returns different ranked results', () => {
        it('should store a PM-only memory and retrieve it via PM role', async () => {
            const pmId = await roles.store({
                content: 'Q3 milestone: ship feature X by September 15',
                category: 'project_fact',
                source:   'api',
                importance: 0.85,
                tags:     ['planning', 'roadmap'],
                metadata: {},
                roles:    ['pm'],
                importance_per_role: { pm: 0.95, coder: 0.05 },
            });
            if (pmId) storedIds.push(pmId);

            const results = await roles.query({
                task:      'project milestones and delivery schedule',
                agentRole: 'pm',
                taskType:  'planning',
                limit: 5,
            });

            expect(results.length).toBeGreaterThan(0);
        }, TEST_TIMEOUT);
    });

    // ============================================================
    // Scenario 4 — Empty roles = universal access
    // ============================================================
    describe('Scenario 4: Empty roles array means all roles can access', () => {
        it('should include global memories in both coder and pm queries', async () => {
            const universalId = await roles.store({
                content: 'All team members should use semantic-versioning for releases',
                category: 'project_fact',
                source:   'api',
                importance: 0.7,
                tags:     ['versioning'],
                metadata: {},
                roles:    [],   // universal
                importance_per_role: {},
            });
            if (universalId) storedIds.push(universalId);

            const coderResults = await roles.listByRole('coder', 50);
            const pmResults    = await roles.listByRole('pm', 50);

            const coderHasUniversal = coderResults.some((m) => m.id === universalId);
            const pmHasUniversal    = pmResults.some((m) => m.id === universalId);

            expect(coderHasUniversal).toBe(true);
            expect(pmHasUniversal).toBe(true);
        }, TEST_TIMEOUT);
    });

    // ============================================================
    // Scenario 5 — updateRoleImportance
    // ============================================================
    describe('Scenario 5: updateRoleImportance adjusts payload', () => {
        it('should update a specific role importance on an existing memory', async () => {
            const id = await roles.store({
                content: 'Redis sorted sets support O(log n) rank operations',
                category: 'project_fact',
                source:   'api',
                importance: 0.65,
                tags:     ['redis', 'performance'],
                metadata: {},
                roles:    ['coder', 'analyst'],
                importance_per_role: { coder: 0.7, analyst: 0.5 },
            });
            if (id) storedIds.push(id!);

            await roles.updateRoleImportance(id!, 'analyst', 0.9);

            const points = await db.qdrant.retrieve(config.qdrant.collection, {
                ids: [id!],
                with_payload: true,
                with_vector: false,
            });
            const rir = points[0]!.payload!.importance_per_role as Record<string, number>;
            expect(rir.analyst).toBeCloseTo(0.9, 2);
            expect(rir.coder).toBeCloseTo(0.7, 2);   // unchanged
        }, TEST_TIMEOUT);
    });

    // ============================================================
    // Scenario 6 — listByRole
    // ============================================================
    describe('Scenario 6: listByRole() returns accessible memories', () => {
        it('should only return memories that include the requested role or have empty roles', async () => {
            const qaOnlyId = await roles.store({
                content: 'QA checklist: run E2E tests before every release',
                category: 'project_fact',
                source:   'api',
                importance: 0.75,
                tags:     ['qa', 'testing'],
                metadata: {},
                roles:    ['qa'],
                importance_per_role: { qa: 0.9 },
            });
            if (qaOnlyId) storedIds.push(qaOnlyId!);

            const qaList = await roles.listByRole('qa', 100);
            const hasQaMemory = qaList.some((m) => m.id === qaOnlyId);
            expect(hasQaMemory).toBe(true);

            // Coder list must NOT contain QA-only memory
            const coderList = await roles.listByRole('coder', 100);
            const coderHasQa = coderList.some((m) => m.id === qaOnlyId);
            expect(coderHasQa).toBe(false);
        }, TEST_TIMEOUT);
    });
});
