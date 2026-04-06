import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import type { Hypothesis, HypothesisPerspective, MemoryConflict } from './types.js';

/**
 * Hypothesis Manager — stores conflicting memories as competing perspectives.
 *
 * Phase 3: When a conflict is detected between memories A and B on topic T,
 * they are grouped into a Hypothesis with multiple perspectives. Each
 * perspective accumulates evidence and confidence, enabling the agent to:
 *   - Present multiple viewpoints when asked about a contested topic
 *   - Gradually resolve conflicts as more evidence arrives
 *   - Track which perspective is "winning" over time
 *
 * Lifecycle:
 *   open → leaning (one perspective confidence > 0.7) → resolved (confirmed with > 0.8 + 3 evidence)
 *
 * Storage: Hypotheses are stored as JSONB rows in a virtual table implemented
 * on the existing memory_conflicts table + a dedicated hypotheses concept
 * backed by PostgreSQL. We use the memory_conflicts table to link to the
 * hypothesis, but hypotheses themselves are managed via this service.
 *
 * NOTE: Hypotheses are stored inline as JSONB in the evaluation_records table
 * for simplicity. In a future refactor, they could have their own table.
 * For now, we store them directly in PostgreSQL using a simple approach.
 */

// Hypotheses are stored in-memory + persisted via a simple PG JSON approach
// We leverage the memory_conflicts table for link tracking

export class HypothesisManager {
    // In-memory hypothesis store, synced with persistence
    private hypotheses = new Map<string, Hypothesis>();
    private loaded = false;

    // ====================================================================
    // CREATE
    // ====================================================================

    /**
     * Create a hypothesis from a detected conflict.
     *
     * Extracts the topic from the conflict description and creates two
     * competing perspectives — one for each memory involved.
     */
    async createFromConflict(
        conflict: MemoryConflict,
        memoryAContent: string,
        memoryBContent: string,
    ): Promise<Hypothesis> {
        // Build topic from the conflict description
        const topic = this.extractTopic(memoryAContent, memoryBContent, conflict.description);

        const hypothesis: Hypothesis = {
            id: uuid(),
            topic,
            perspectives: [
                {
                    memory_id: conflict.memory_id_a,
                    stance: memoryAContent,
                    confidence: 0.5,
                    evidence_count: 1,
                },
                {
                    memory_id: conflict.memory_id_b,
                    stance: memoryBContent,
                    confidence: 0.5,
                    evidence_count: 1,
                },
            ],
            status: 'open',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        // Persist
        await this.persist(hypothesis);
        this.hypotheses.set(hypothesis.id, hypothesis);

        // Link the conflict to this hypothesis (best-effort: conflict.id may not be a real UUID in tests)
        try {
            await db.pg.query(
                `UPDATE memory_conflicts SET status = 'hypothesis' WHERE id = $1`,
                [conflict.id],
            );
        } catch { /* best-effort */ }

        console.log(`    🔬 Hypothesis created: "${topic}" with ${hypothesis.perspectives.length} perspectives`);

        return hypothesis;
    }

    // ====================================================================
    // EVIDENCE
    // ====================================================================

    /**
     * Add supporting evidence to a perspective within a hypothesis.
     *
     * @param hypothesisId  The hypothesis to update
     * @param memoryId      The new memory that provides evidence
     * @param perspectiveIndex  Which perspective this evidence supports (0 or 1)
     * @param confidenceBoost   How much to boost the perspective's confidence
     */
    async addEvidence(
        hypothesisId: string,
        memoryId: string,
        perspectiveIndex: number,
        confidenceBoost: number = 0.1,
    ): Promise<Hypothesis | null> {
        await this.ensureLoaded();
        const hypothesis = this.hypotheses.get(hypothesisId);
        if (!hypothesis) return null;

        const perspective = hypothesis.perspectives[perspectiveIndex];
        if (!perspective) return null;

        // Update the perspective
        perspective.evidence_count += 1;
        perspective.confidence = Math.min(1.0, perspective.confidence + confidenceBoost);
        hypothesis.updated_at = new Date().toISOString();

        // Check for status transitions
        this.updateStatus(hypothesis);

        // Persist
        await this.persist(hypothesis);
        this.hypotheses.set(hypothesis.id, hypothesis);

        return hypothesis;
    }

    // ====================================================================
    // READ
    // ====================================================================

    /** Get all active (non-resolved) hypotheses, optionally filtered by topic */
    async getActiveHypotheses(topic?: string): Promise<Hypothesis[]> {
        await this.ensureLoaded();
        const all = Array.from(this.hypotheses.values())
            .filter((h) => h.status !== 'resolved');

        if (topic) {
            const topicLower = topic.toLowerCase();
            return all.filter((h) => h.topic.toLowerCase().includes(topicLower));
        }
        return all;
    }

    /** Get a specific hypothesis by ID */
    async getById(id: string): Promise<Hypothesis | null> {
        await this.ensureLoaded();
        return this.hypotheses.get(id) ?? null;
    }

    /** Get hypotheses involving a specific memory */
    async getForMemory(memoryId: string): Promise<Hypothesis[]> {
        await this.ensureLoaded();
        return Array.from(this.hypotheses.values()).filter((h) =>
            h.perspectives.some((p) => p.memory_id === memoryId),
        );
    }

    /** Count total hypotheses */
    async count(): Promise<number> {
        await this.ensureLoaded();
        return this.hypotheses.size;
    }

    // ====================================================================
    // RESOLVE
    // ====================================================================

    /** Manually resolve a hypothesis with a final answer */
    async resolveHypothesis(id: string, resolution: string): Promise<void> {
        await this.ensureLoaded();
        const hypothesis = this.hypotheses.get(id);
        if (!hypothesis) return;

        hypothesis.status = 'resolved';
        hypothesis.resolution = resolution;
        hypothesis.updated_at = new Date().toISOString();

        await this.persist(hypothesis);
        this.hypotheses.set(id, hypothesis);
    }

    // ====================================================================
    // STATUS TRANSITIONS
    // ====================================================================

    /**
     * Update hypothesis status based on perspective confidence levels.
     *
     * Rules:
     *   - If any perspective has confidence > 0.7 → 'leaning'
     *   - If any perspective has confidence > 0.8 AND evidence >= 3 → 'resolved'
     */
    private updateStatus(hypothesis: Hypothesis): void {
        const dominant = hypothesis.perspectives.reduce((a, b) =>
            a.confidence > b.confidence ? a : b,
        );

        if (dominant.confidence >= 0.8 && dominant.evidence_count >= 3) {
            hypothesis.status = 'resolved';
            hypothesis.resolution = `Evidence supports: "${dominant.stance.substring(0, 100)}"`;
        } else if (dominant.confidence >= 0.7) {
            hypothesis.status = 'leaning';
        }
    }

    // ====================================================================
    // PERSISTENCE
    // ====================================================================

    /** Persist a hypothesis to PostgreSQL (upsert pattern using evaluation_records with special query_id) */
    private async persist(hypothesis: Hypothesis): Promise<void> {
        const key = `hypothesis:${hypothesis.id}`;
        const data = JSON.stringify(hypothesis);

        await db.pg.query(
            `INSERT INTO evaluation_records (id, query_id, query_text, retrieved_memory_ids, success, hit_rate)
             VALUES ($1, $2, $3, $4, false, 0)
             ON CONFLICT (id) DO UPDATE SET query_text = $3`,
            [hypothesis.id, key, data, hypothesis.perspectives.map((p) => p.memory_id)],
        );
    }

    /** Load all hypotheses from persistence */
    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;

        try {
            const { rows } = await db.pg.query(
                `SELECT query_text FROM evaluation_records WHERE query_id LIKE 'hypothesis:%'`,
            );

            for (const row of rows) {
                try {
                    const hypothesis = JSON.parse(row.query_text as string) as Hypothesis;
                    this.hypotheses.set(hypothesis.id, hypothesis);
                } catch {
                    // Skip malformed entries
                }
            }
        } catch {
            // Table may not exist yet on first run
        }

        this.loaded = true;
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    /** Extract a concise topic from two conflicting memory contents */
    private extractTopic(contentA: string, contentB: string, description: string): string {
        // Use the shorter description if available, otherwise build from content
        if (description && description.length > 10 && description.length < 200) {
            return description;
        }

        // Find common words between the two contents
        const wordsA = new Set(contentA.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
        const wordsB = new Set(contentB.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
        const common = [...wordsA].filter((w) => wordsB.has(w)).slice(0, 5);

        return common.length > 0
            ? `Conflicting views on: ${common.join(', ')}`
            : `Conflict between memories`;
    }
}
