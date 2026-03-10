import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import type { EpisodicMemory, EventType } from './types.js';

/**
 * Episodic Memory — PostgreSQL-backed event store.
 * Records every significant interaction / task / event the agent experiences.
 */
export class EpisodicMemoryService {
    /** Store a new episode */
    async store(episode: Omit<EpisodicMemory, 'id' | 'timestamp'>): Promise<EpisodicMemory> {
        const id = uuid();
        const now = new Date().toISOString();

        await db.pg.query(
            `INSERT INTO episodic_memories
        (id, event_type, session_id, content, task, result, context, importance, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                id,
                episode.eventType,
                episode.sessionId,
                episode.content,
                episode.task ?? null,
                episode.result ?? null,
                episode.context ?? null,
                episode.importance,
                JSON.stringify(episode.metadata),
            ],
        );

        return { ...episode, id, timestamp: now };
    }

    /** Retrieve episodes by filters */
    async query(filters: {
        sessionId?: string;
        eventType?: EventType;
        limit?: number;
        offset?: number;
        minImportance?: number;
        timeRange?: { from?: string; to?: string };
    }): Promise<EpisodicMemory[]> {
        const conditions: string[] = ['1=1'];
        const params: unknown[] = [];
        let idx = 1;

        if (filters.sessionId) {
            conditions.push(`session_id = $${idx++}`);
            params.push(filters.sessionId);
        }
        if (filters.eventType) {
            conditions.push(`event_type = $${idx++}`);
            params.push(filters.eventType);
        }
        if (filters.minImportance !== undefined) {
            conditions.push(`importance >= $${idx++}`);
            params.push(filters.minImportance);
        }
        if (filters.timeRange?.from) {
            conditions.push(`created_at >= $${idx++}`);
            params.push(filters.timeRange.from);
        }
        if (filters.timeRange?.to) {
            conditions.push(`created_at <= $${idx++}`);
            params.push(filters.timeRange.to);
        }

        const limit = filters.limit ?? 20;
        const offset = filters.offset ?? 0;

        const { rows } = await db.pg.query(
            `SELECT * FROM episodic_memories
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
            [...params, limit, offset],
        );

        return rows.map(this.rowToMemory);
    }

    /** Get the N most recent episodes */
    async getRecent(limit = 10): Promise<EpisodicMemory[]> {
        const { rows } = await db.pg.query(
            `SELECT * FROM episodic_memories ORDER BY created_at DESC LIMIT $1`,
            [limit],
        );
        return rows.map(this.rowToMemory);
    }

    /** Get a single episode by ID */
    async getById(id: string): Promise<EpisodicMemory | null> {
        const { rows } = await db.pg.query(
            `SELECT * FROM episodic_memories WHERE id = $1`,
            [id],
        );
        return rows[0] ? this.rowToMemory(rows[0]) : null;
    }

    /** Update the importance score */
    async updateImportance(id: string, importance: number): Promise<void> {
        await db.pg.query(
            `UPDATE episodic_memories SET importance = $1, updated_at = NOW() WHERE id = $2`,
            [importance, id],
        );
    }

    /** Apply exponential decay to all episodes older than the given age (hours) */
    async applyDecay(decayFactor: number, minAgeHours = 24): Promise<number> {
        const result = await db.pg.query(
            `UPDATE episodic_memories
       SET importance = importance * EXP(-$1 * EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600),
           updated_at = NOW()
       WHERE created_at < NOW() - INTERVAL '1 hour' * $2
         AND importance > 0.01
       RETURNING id`,
            [decayFactor, minAgeHours],
        );
        return result.rowCount ?? 0;
    }

    /** Count total episodes */
    async count(): Promise<number> {
        const { rows } = await db.pg.query(`SELECT COUNT(*)::int AS total FROM episodic_memories`);
        return rows[0].total;
    }

    // ---- Helpers ----

    private rowToMemory(row: Record<string, unknown>): EpisodicMemory {
        return {
            id: row.id as string,
            eventType: row.event_type as EventType,
            sessionId: row.session_id as string,
            content: row.content as string,
            task: (row.task as string) ?? undefined,
            result: (row.result as EpisodicMemory['result']) ?? undefined,
            context: (row.context as string) ?? undefined,
            importance: row.importance as number,
            metadata: (row.metadata as Record<string, unknown>) ?? {},
            timestamp: (row.created_at as Date).toISOString(),
        };
    }
}
