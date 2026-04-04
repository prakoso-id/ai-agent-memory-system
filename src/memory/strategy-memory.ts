import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import type { StrategyMemory } from './types.js';

/**
 * Strategy Memory — stores reusable behavioral and content patterns.
 *
 * Unlike semantic memory (which stores facts) or reflections (which store lessons),
 * strategy memory stores high-level patterns that influence HOW the agent behaves:
 *   - "comparison content performs better"
 *   - "user prefers concise bullet points over long paragraphs"
 *   - "code examples should always include error handling"
 *
 * Each strategy has an effectiveness score (0.0–1.0) that is updated over time
 * based on actual usage outcomes, implementing a simple reinforcement loop.
 */
export class StrategyMemoryService {
    // ====================================================================
    // WRITE
    // ====================================================================

    /** Store a new strategy pattern */
    async store(
        strategy: Omit<StrategyMemory, 'id' | 'usage_count' | 'last_validated' | 'created_at'>,
    ): Promise<StrategyMemory> {
        const id = uuid();
        const now = new Date().toISOString();

        await db.pg.query(
            `INSERT INTO strategy_memories (id, pattern, evidence, effectiveness, domain, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                id,
                strategy.pattern,
                strategy.evidence,
                strategy.effectiveness,
                strategy.domain,
                JSON.stringify(strategy.metadata),
            ],
        );

        return {
            ...strategy,
            id,
            usage_count: 0,
            last_validated: now,
            created_at: now,
        };
    }

    // ====================================================================
    // READ
    // ====================================================================

    /** Retrieve strategies relevant to a context (keyword match + effectiveness ranking) */
    async getRelevant(context: string, limit = 5): Promise<StrategyMemory[]> {
        const { rows } = await db.pg.query(
            `SELECT * FROM strategy_memories
             WHERE pattern ILIKE $1
                OR evidence ILIKE $1
                OR domain ILIKE $1
             ORDER BY effectiveness DESC, usage_count DESC
             LIMIT $2`,
            [`%${context}%`, limit],
        );
        return rows.map(this.rowToStrategy);
    }

    /** Get top strategies by effectiveness, optionally filtered by domain */
    async getTopStrategies(domain?: string, limit = 5): Promise<StrategyMemory[]> {
        const query = domain
            ? `SELECT * FROM strategy_memories WHERE domain = $1 ORDER BY effectiveness DESC LIMIT $2`
            : `SELECT * FROM strategy_memories ORDER BY effectiveness DESC LIMIT $1`;

        const params = domain ? [domain, limit] : [limit];
        const { rows } = await db.pg.query(query, params);
        return rows.map(this.rowToStrategy);
    }

    /** Get a strategy by ID */
    async getById(id: string): Promise<StrategyMemory | null> {
        const { rows } = await db.pg.query(
            'SELECT * FROM strategy_memories WHERE id = $1',
            [id],
        );
        return rows.length > 0 ? this.rowToStrategy(rows[0]) : null;
    }

    /** Count total strategies */
    async count(): Promise<number> {
        const { rows } = await db.pg.query('SELECT COUNT(*)::int AS total FROM strategy_memories');
        return rows[0].total;
    }

    // ====================================================================
    // UPDATE — Reinforcement Loop
    // ====================================================================

    /**
     * Record the outcome of using a strategy.
     *
     * Updates effectiveness using exponential moving average:
     *   new_eff = (1 - α) × old_eff + α × outcome
     * where α = 0.2 (emphasizes recent outcomes without forgetting history).
     */
    async recordOutcome(strategyId: string, effective: boolean): Promise<void> {
        const alpha = 0.2;
        const outcome = effective ? 1.0 : 0.0;

        await db.pg.query(
            `UPDATE strategy_memories
             SET effectiveness = (1.0 - $2::real) * effectiveness + $2::real * $3::real,
                 usage_count = usage_count + 1,
                 last_validated = NOW()
             WHERE id = $1`,
            [strategyId, alpha, outcome],
        );
    }

    // ====================================================================
    // DELETE
    // ====================================================================

    /** Remove strategies that have fallen below a minimum effectiveness */
    async pruneIneffective(minEffectiveness = 0.2, minUsageCount = 5): Promise<number> {
        const result = await db.pg.query(
            `DELETE FROM strategy_memories
             WHERE effectiveness < $1 AND usage_count >= $2`,
            [minEffectiveness, minUsageCount],
        );
        return result.rowCount ?? 0;
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    private rowToStrategy(row: Record<string, unknown>): StrategyMemory {
        return {
            id: row.id as string,
            pattern: row.pattern as string,
            evidence: row.evidence as string,
            effectiveness: row.effectiveness as number,
            domain: row.domain as string,
            usage_count: (row.usage_count as number) ?? 0,
            last_validated: row.last_validated
                ? (row.last_validated as Date).toISOString()
                : (row.created_at as Date).toISOString(),
            created_at: (row.created_at as Date).toISOString(),
            metadata: (row.metadata as Record<string, unknown>) ?? {},
        };
    }
}
