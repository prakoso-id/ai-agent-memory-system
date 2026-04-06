import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import { llm } from '../llm/llm-client.js';
import { config } from '../config/index.js';
import type { MemoryConflict, ConflictStatus, SemanticMemory } from './types.js';

/**
 * Conflict Detector — identifies contradictory, outdated, or ambiguous memories.
 *
 * Phase 3: When a new memory is stored, this module searches for semantically
 * similar existing memories and uses LLM classification to determine whether
 * the new memory conflicts with existing ones.
 *
 * Conflicts are stored in PostgreSQL — never deleted, only status-transitioned:
 *   detected → hypothesis | resolved | superseded
 */
export class ConflictDetector {
    // ====================================================================
    // DETECT
    // ====================================================================

    /**
     * Check a newly stored memory against existing similar memories.
     *
     * Steps:
     *   1. Find semantically similar memories (cosine ≥ threshold)
     *   2. Classify each pair via LLM: supporting | contradictory | updating
     *   3. Store detected conflicts
     *
     * @returns Array of newly detected conflicts (may be empty)
     */
    async detectConflicts(
        newMemory: SemanticMemory,
        similarMemories: Array<SemanticMemory & { score: number }>,
    ): Promise<MemoryConflict[]> {
        const threshold = config.evolution.conflictSimilarityThreshold;
        const candidates = similarMemories.filter(
            (m) => m.score >= threshold && m.id !== newMemory.id,
        );

        if (candidates.length === 0) return [];

        const conflicts: MemoryConflict[] = [];

        for (const existing of candidates) {
            try {
                const classification = await this.classifyPair(newMemory, existing);

                if (classification.type === 'supporting') {
                    // No conflict — skip
                    continue;
                }

                const conflict: MemoryConflict = {
                    id: uuid(),
                    memory_id_a: existing.id,
                    memory_id_b: newMemory.id,
                    conflict_type: classification.type,
                    description: classification.reason,
                    status: 'detected',
                    detected_at: new Date().toISOString(),
                };

                await this.storeConflict(conflict);
                conflicts.push(conflict);

                console.log(
                    `    ⚡ Conflict detected (${classification.type}): ` +
                    `"${existing.content.substring(0, 40)}…" vs "${newMemory.content.substring(0, 40)}…"`,
                );
            } catch (error) {
                console.error('Conflict classification failed for pair:', error);
            }
        }

        return conflicts;
    }

    // ====================================================================
    // CLASSIFY
    // ====================================================================

    /**
     * Use LLM to classify the relationship between two memories.
     */
    private async classifyPair(
        memA: SemanticMemory,
        memB: SemanticMemory,
    ): Promise<{ type: 'supporting' | 'contradictory' | 'outdated' | 'ambiguous'; reason: string }> {
        try {
            const result = await llm.chatJSON<{
                relationship: 'supporting' | 'contradictory' | 'outdated' | 'ambiguous';
                reason: string;
            }>([
                {
                    role: 'system',
                    content: `You are a memory conflict analyzer. Given two memory entries, classify their relationship.

Types:
- "supporting": They reinforce or agree with each other
- "contradictory": They state opposite or incompatible things about the same topic
- "outdated": One is a newer version of the same fact (the older one is now outdated)
- "ambiguous": They partially overlap but it's unclear if they conflict

Be precise. Only classify as "contradictory" if they genuinely contradict each other.`,
                },
                {
                    role: 'user',
                    content: `Classify the relationship between these two memories:

Memory A (existing, stored at ${memA.timestamp}):
"${memA.content}"
Category: ${memA.category}

Memory B (new, stored at ${memB.timestamp}):
"${memB.content}"
Category: ${memB.category}

Respond as JSON:
{
  "relationship": "supporting" | "contradictory" | "outdated" | "ambiguous",
  "reason": "brief explanation of why this classification was chosen"
}`,
                },
            ]);

            return { type: result.relationship, reason: result.reason };
        } catch {
            // Fallback: if LLM fails, mark as ambiguous
            return { type: 'ambiguous', reason: 'LLM classification failed — marked for review' };
        }
    }

    // ====================================================================
    // STORE / READ
    // ====================================================================

    private async storeConflict(conflict: MemoryConflict): Promise<void> {
        await db.pg.query(
            `INSERT INTO memory_conflicts
             (id, memory_id_a, memory_id_b, conflict_type, description, status, detected_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                conflict.id,
                conflict.memory_id_a,
                conflict.memory_id_b,
                conflict.conflict_type,
                conflict.description,
                conflict.status,
                conflict.detected_at,
            ],
        );
    }

    /** Get all conflicts involving a specific memory */
    async getConflictsForMemory(memoryId: string): Promise<MemoryConflict[]> {
        const { rows } = await db.pg.query(
            `SELECT * FROM memory_conflicts
             WHERE memory_id_a = $1 OR memory_id_b = $1
             ORDER BY detected_at DESC`,
            [memoryId],
        );
        return rows.map(this.rowToConflict);
    }

    /** Get all unresolved conflicts */
    async getUnresolvedConflicts(limit = 20): Promise<MemoryConflict[]> {
        const { rows } = await db.pg.query(
            `SELECT * FROM memory_conflicts
             WHERE status IN ('detected', 'hypothesis')
             ORDER BY detected_at DESC
             LIMIT $1`,
            [limit],
        );
        return rows.map(this.rowToConflict);
    }

    /** Count conflicts for a memory (used by confidence scorer) */
    async countConflicts(memoryId: string): Promise<number> {
        const { rows } = await db.pg.query(
            `SELECT COUNT(*)::int AS total FROM memory_conflicts
             WHERE (memory_id_a = $1 OR memory_id_b = $1)
               AND status IN ('detected', 'hypothesis')`,
            [memoryId],
        );
        return rows[0].total;
    }

    /** Resolve a conflict with an explanation */
    async resolveConflict(
        conflictId: string,
        resolution: string,
        status: ConflictStatus = 'resolved',
    ): Promise<void> {
        await db.pg.query(
            `UPDATE memory_conflicts
             SET status = $1, resolution = $2, resolved_at = NOW()
             WHERE id = $3`,
            [status, resolution, conflictId],
        );
    }

    /** Mark a conflict as part of a hypothesis */
    async markAsHypothesis(conflictId: string): Promise<void> {
        await db.pg.query(
            `UPDATE memory_conflicts SET status = 'hypothesis' WHERE id = $1`,
            [conflictId],
        );
    }

    /** Count total conflicts */
    async count(): Promise<number> {
        const { rows } = await db.pg.query(
            'SELECT COUNT(*)::int AS total FROM memory_conflicts',
        );
        return rows[0].total;
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    private rowToConflict(row: Record<string, unknown>): MemoryConflict {
        return {
            id: row.id as string,
            memory_id_a: row.memory_id_a as string,
            memory_id_b: row.memory_id_b as string,
            conflict_type: row.conflict_type as MemoryConflict['conflict_type'],
            description: row.description as string,
            status: row.status as ConflictStatus,
            resolution: (row.resolution as string) ?? undefined,
            detected_at: (row.detected_at as Date).toISOString(),
            resolved_at: row.resolved_at
                ? (row.resolved_at as Date).toISOString()
                : undefined,
        };
    }
}
