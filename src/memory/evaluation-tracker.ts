import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import type { EvaluationRecord, EvaluationMetrics } from './types.js';

/**
 * Evaluation Tracker — measures retrieval quality over time.
 *
 * Phase 3: After each retrieval + agent response cycle, records:
 *   - Which query was asked
 *   - Which memories were retrieved
 *   - Whether the retrieval was considered successful
 *   - Hit rate (% of retrieved memories that were useful)
 *
 * Aggregate metrics:
 *   - Overall hit rate
 *   - Retrieval success rate
 *   - Per-memory usefulness score
 *   - Trend detection (improving or declining)
 */
export class EvaluationTracker {
    // ====================================================================
    // RECORD
    // ====================================================================

    /**
     * Record an evaluation of a retrieval cycle.
     */
    async recordEvaluation(
        queryId: string,
        queryText: string,
        retrievedMemoryIds: string[],
        success: boolean,
        hitRate: number,
        responseQuality?: number,
    ): Promise<EvaluationRecord> {
        const id = uuid();
        const now = new Date().toISOString();

        await db.pg.query(
            `INSERT INTO evaluation_records
             (id, query_id, query_text, retrieved_memory_ids, success, hit_rate, response_quality)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, queryId, queryText, retrievedMemoryIds, success, hitRate, responseQuality ?? null],
        );

        return {
            id,
            query_id: queryId,
            query_text: queryText,
            retrieved_memory_ids: retrievedMemoryIds,
            success,
            hit_rate: hitRate,
            response_quality: responseQuality,
            created_at: now,
        };
    }

    // ====================================================================
    // METRICS
    // ====================================================================

    /**
     * Compute aggregate metrics for a given time period.
     *
     * @param periodDays  Number of days to look back (default: 7)
     */
    async getMetrics(periodDays = 7): Promise<EvaluationMetrics> {
        const { rows } = await db.pg.query(
            `SELECT
                COUNT(*)::int AS total_queries,
                COALESCE(AVG(hit_rate), 0)::real AS avg_hit_rate,
                COALESCE(AVG(response_quality) FILTER (WHERE response_quality IS NOT NULL), 0)::real AS avg_usefulness,
                COALESCE(
                    COUNT(*) FILTER (WHERE success = true)::real / NULLIF(COUNT(*)::real, 0),
                    0
                )::real AS retrieval_success_rate,
                MIN(created_at) AS period_start,
                MAX(created_at) AS period_end
             FROM evaluation_records
             WHERE query_id NOT LIKE 'hypothesis:%'
               AND created_at > NOW() - INTERVAL '1 day' * $1`,
            [periodDays],
        );

        const r = rows[0];
        return {
            total_queries: r.total_queries as number,
            avg_hit_rate: r.avg_hit_rate as number,
            avg_usefulness: r.avg_usefulness as number,
            retrieval_success_rate: r.retrieval_success_rate as number,
            period_start: r.period_start
                ? (r.period_start as Date).toISOString()
                : new Date().toISOString(),
            period_end: r.period_end
                ? (r.period_end as Date).toISOString()
                : new Date().toISOString(),
        };
    }

    /**
     * Get per-memory usefulness: how often a memory appears in successful retrievals.
     */
    async getMemoryUsefulness(memoryId: string): Promise<number> {
        const { rows } = await db.pg.query(
            `SELECT
                COUNT(*) FILTER (WHERE success = true)::int AS successful,
                COUNT(*)::int AS total
             FROM evaluation_records
             WHERE $1 = ANY(retrieved_memory_ids)
               AND query_id NOT LIKE 'hypothesis:%'`,
            [memoryId],
        );

        const total = rows[0].total as number;
        if (total === 0) return 0;

        return (rows[0].successful as number) / total;
    }

    /**
     * Detect whether retrieval quality is improving or declining.
     *
     * Compares the last `windowDays` with the previous `windowDays`.
     */
    async getTrend(windowDays = 7): Promise<{ improving: boolean; delta: number }> {
        const current = await this.getMetrics(windowDays);
        const previous = await this.getPreviousPeriodMetrics(windowDays);

        if (previous.total_queries === 0 || current.total_queries === 0) {
            return { improving: true, delta: 0 };
        }

        const delta = current.avg_hit_rate - previous.avg_hit_rate;
        return {
            improving: delta >= 0,
            delta: Math.round(delta * 1000) / 1000,
        };
    }

    /** Get metrics for the period before the most recent window */
    private async getPreviousPeriodMetrics(windowDays: number): Promise<EvaluationMetrics> {
        const { rows } = await db.pg.query(
            `SELECT
                COUNT(*)::int AS total_queries,
                COALESCE(AVG(hit_rate), 0)::real AS avg_hit_rate,
                COALESCE(AVG(response_quality) FILTER (WHERE response_quality IS NOT NULL), 0)::real AS avg_usefulness,
                COALESCE(
                    COUNT(*) FILTER (WHERE success = true)::real / NULLIF(COUNT(*)::real, 0),
                    0
                )::real AS retrieval_success_rate,
                MIN(created_at) AS period_start,
                MAX(created_at) AS period_end
             FROM evaluation_records
             WHERE query_id NOT LIKE 'hypothesis:%'
               AND created_at > NOW() - INTERVAL '1 day' * $1
               AND created_at <= NOW() - INTERVAL '1 day' * $2`,
            [windowDays * 2, windowDays],
        );

        const r = rows[0];
        return {
            total_queries: r.total_queries as number,
            avg_hit_rate: r.avg_hit_rate as number,
            avg_usefulness: r.avg_usefulness as number,
            retrieval_success_rate: r.retrieval_success_rate as number,
            period_start: r.period_start
                ? (r.period_start as Date).toISOString()
                : new Date().toISOString(),
            period_end: r.period_end
                ? (r.period_end as Date).toISOString()
                : new Date().toISOString(),
        };
    }

    // ====================================================================
    // STATS
    // ====================================================================

    /** Get recent evaluations for debugging */
    async getRecent(limit = 10): Promise<EvaluationRecord[]> {
        const { rows } = await db.pg.query(
            `SELECT * FROM evaluation_records
             WHERE query_id NOT LIKE 'hypothesis:%'
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit],
        );
        return rows.map(this.rowToRecord);
    }

    /** Count total evaluation records */
    async count(): Promise<number> {
        const { rows } = await db.pg.query(
            `SELECT COUNT(*)::int AS total FROM evaluation_records
             WHERE query_id NOT LIKE 'hypothesis:%'`,
        );
        return rows[0].total;
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    private rowToRecord(row: Record<string, unknown>): EvaluationRecord {
        return {
            id: row.id as string,
            query_id: row.query_id as string,
            query_text: row.query_text as string,
            retrieved_memory_ids: (row.retrieved_memory_ids as string[]) ?? [],
            success: row.success as boolean,
            hit_rate: row.hit_rate as number,
            response_quality: (row.response_quality as number) ?? undefined,
            created_at: (row.created_at as Date).toISOString(),
        };
    }
}
