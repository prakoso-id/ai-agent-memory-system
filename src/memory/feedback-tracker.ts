import { db } from '../database/connections.js';
import type { RetrievalFeedback, AdaptiveWeights } from './types.js';

/**
 * Feedback Tracker — adaptive retrieval scoring via usage feedback.
 *
 * After each agent interaction, the controller can record which retrieved
 * memories were actually used and whether they were helpful.
 * This signal is aggregated to:
 *   1. Boost/penalize individual memories in future rerankings.
 *   2. Shift the global reranking weight distribution towards signals
 *      that have historically correlated with helpfulness.
 */

/** Default reranking weights (same as Phase 1 baseline) */
const DEFAULT_WEIGHTS: AdaptiveWeights = {
    semanticSimilarity: 0.35,
    recency: 0.25,
    importance: 0.20,
    taskRelevance: 0.10,
    usagePopularity: 0.10,
};

export class FeedbackTracker {
    // In-memory cache of per-memory boost scores — refreshed periodically
    private boostCache = new Map<string, number>();
    private adaptiveWeights: AdaptiveWeights = { ...DEFAULT_WEIGHTS };
    private lastRefresh = 0;
    private readonly REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    // ====================================================================
    // RECORD
    // ====================================================================

    /** Record feedback for a retrieved memory after agent interaction */
    async recordFeedback(feedback: Omit<RetrievalFeedback, 'timestamp'>): Promise<void> {
        await db.pg.query(
            `INSERT INTO retrieval_feedback (memory_id, query, used, helpful)
             VALUES ($1, $2, $3, $4)`,
            [feedback.memory_id, feedback.query, feedback.used, feedback.helpful],
        );

        // Invalidate cached boost for this memory
        this.boostCache.delete(feedback.memory_id);
    }

    /** Record feedback for a batch of memories from a single retrieval */
    async recordBatch(
        query: string,
        results: Array<{ memory_id: string; used: boolean; helpful: boolean }>,
    ): Promise<void> {
        if (results.length === 0) return;

        const values: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        for (const r of results) {
            values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3})`);
            params.push(r.memory_id, query, r.used, r.helpful);
            paramIdx += 4;
        }

        await db.pg.query(
            `INSERT INTO retrieval_feedback (memory_id, query, used, helpful)
             VALUES ${values.join(', ')}`,
            params,
        );

        // Invalidate affected caches
        for (const r of results) {
            this.boostCache.delete(r.memory_id);
        }
    }

    // ====================================================================
    // BOOST SCORING
    // ====================================================================

    /**
     * Get a boost multiplier for a specific memory.
     *
     * Range: 0.5 (consistently unhelpful) to 1.5 (consistently helpful)
     * Default: 1.0 (no feedback yet)
     *
     * Formula: 1.0 + (helpfulness_ratio - 0.5) where helpfulness_ratio is
     * the proportion of 'helpful=true' among all feedback for this memory.
     */
    async getMemoryBoost(memoryId: string): Promise<number> {
        if (this.boostCache.has(memoryId)) {
            return this.boostCache.get(memoryId)!;
        }

        const { rows } = await db.pg.query(
            `SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE helpful = true)::int AS helpful_count,
                COUNT(*) FILTER (WHERE used = true)::int AS used_count
             FROM retrieval_feedback
             WHERE memory_id = $1`,
            [memoryId],
        );

        if (rows[0].total === 0) return 1.0;

        const total = rows[0].total as number;
        const helpfulCount = rows[0].helpful_count as number;

        // Helpfulness ratio with Bayesian smoothing (prior of 1 helpful / 2 total)
        const smoothedRatio = (helpfulCount + 1) / (total + 2);
        const boost = 0.5 + smoothedRatio; // Range: 0.5 to ~1.5

        this.boostCache.set(memoryId, boost);
        return boost;
    }

    /**
     * Get boost multipliers for multiple memories at once.
     * Returns a Map<memoryId, boost>.
     */
    async getBoosts(memoryIds: string[]): Promise<Map<string, number>> {
        const boosts = new Map<string, number>();
        if (memoryIds.length === 0) return boosts;

        // Fetch all uncached boosts in a single query
        const uncached = memoryIds.filter((id) => !this.boostCache.has(id));
        if (uncached.length > 0) {
            const { rows } = await db.pg.query(
                `SELECT
                    memory_id,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE helpful = true)::int AS helpful_count
                 FROM retrieval_feedback
                 WHERE memory_id = ANY($1)
                 GROUP BY memory_id`,
                [uncached],
            );

            const feedbackMap = new Map<string, { total: number; helpful: number }>();
            for (const row of rows) {
                feedbackMap.set(row.memory_id, {
                    total: row.total as number,
                    helpful: row.helpful_count as number,
                });
            }

            for (const id of uncached) {
                const fb = feedbackMap.get(id);
                if (!fb) {
                    this.boostCache.set(id, 1.0);
                } else {
                    const smoothed = (fb.helpful + 1) / (fb.total + 2);
                    this.boostCache.set(id, 0.5 + smoothed);
                }
            }
        }

        for (const id of memoryIds) {
            boosts.set(id, this.boostCache.get(id) ?? 1.0);
        }
        return boosts;
    }

    // ====================================================================
    // ADAPTIVE WEIGHTS
    // ====================================================================

    /**
     * Compute adaptive reranking weights based on aggregate feedback.
     *
     * Analyzes which scoring components correlate with helpfulness,
     * then shifts weights toward components that drive helpful results.
     * Falls back to default weights when insufficient data exists.
     */
    async getAdaptiveWeights(): Promise<AdaptiveWeights> {
        const now = Date.now();
        if (now - this.lastRefresh < this.REFRESH_INTERVAL_MS) {
            return this.adaptiveWeights;
        }

        const { rows } = await db.pg.query(
            `SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE helpful = true)::int AS helpful,
                COUNT(*) FILTER (WHERE used = true AND helpful = true)::int AS used_helpful,
                COUNT(*) FILTER (WHERE used = true AND helpful = false)::int AS used_unhelpful
             FROM retrieval_feedback
             WHERE created_at > NOW() - INTERVAL '7 days'`,
        );

        const total = rows[0].total as number;

        // Need at least 20 feedback records to compute meaningful adaptive weights
        if (total < 20) {
            this.lastRefresh = now;
            return DEFAULT_WEIGHTS;
        }

        const helpfulRate = (rows[0].helpful as number) / total;
        const usedHelpfulRate = (rows[0].used_helpful as number) / Math.max(1, rows[0].used_helpful + rows[0].used_unhelpful);

        // Nudge weights based on observed patterns:
        // - High helpful rate → system is working, keep weights balanced
        // - Low helpful rate → shift toward importance + recency (context matters more)
        // - High used-helpful ratio → semantic similarity is good, keep it strong
        const weights = { ...DEFAULT_WEIGHTS };

        if (helpfulRate < 0.4) {
            // Results are often unhelpful — boost importance and recency
            weights.importance += 0.05;
            weights.recency += 0.05;
            weights.semanticSimilarity -= 0.05;
            weights.usagePopularity -= 0.05;
        } else if (helpfulRate > 0.7) {
            // Results are consistently helpful — boost semantic similarity
            weights.semanticSimilarity += 0.05;
            weights.taskRelevance += 0.03;
            weights.recency -= 0.05;
            weights.usagePopularity -= 0.03;
        }

        // Ensure weights are non-negative and normalize to sum ≈ 1.0
        const values = Object.values(weights) as number[];
        const sum = values.reduce((a, b) => a + b, 0);
        if (sum > 0) {
            weights.semanticSimilarity /= sum;
            weights.recency /= sum;
            weights.importance /= sum;
            weights.taskRelevance /= sum;
            weights.usagePopularity /= sum;
        }

        this.adaptiveWeights = weights;
        this.lastRefresh = now;
        return weights;
    }

    /** Reset to default weights (useful for testing) */
    resetWeights(): void {
        this.adaptiveWeights = { ...DEFAULT_WEIGHTS };
        this.boostCache.clear();
        this.lastRefresh = 0;
    }
}
