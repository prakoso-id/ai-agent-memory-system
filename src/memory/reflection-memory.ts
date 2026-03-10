import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import type { ReflectionMemory } from './types.js';

/**
 * Reflection Memory — PostgreSQL-backed lessons store.
 * Stores observations, root causes, lessons, and strategies from past tasks.
 */
export class ReflectionMemoryService {
    /** Store a new reflection */
    async store(reflection: Omit<ReflectionMemory, 'id' | 'timestamp'>): Promise<ReflectionMemory> {
        const id = uuid();
        const now = new Date().toISOString();

        await db.pg.query(
            `INSERT INTO reflection_memories
        (id, content, observation, root_cause, lesson_learned, strategy_improvement,
         related_episode_ids, importance, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                id,
                reflection.content,
                reflection.observation,
                reflection.rootCause,
                reflection.lessonLearned,
                reflection.strategyImprovement,
                reflection.relatedEpisodeIds,
                reflection.importance,
                JSON.stringify(reflection.metadata),
            ],
        );

        return { ...reflection, id, timestamp: now };
    }

    /** Get reflections relevant to a given topic */
    async getRelevant(topic: string, limit = 5): Promise<ReflectionMemory[]> {
        const { rows } = await db.pg.query(
            `SELECT * FROM reflection_memories
       WHERE content ILIKE $1
          OR observation ILIKE $1
          OR lesson_learned ILIKE $1
       ORDER BY importance DESC, created_at DESC
       LIMIT $2`,
            [`%${topic}%`, limit],
        );
        return rows.map(this.rowToReflection);
    }

    /** Get the most recent reflections */
    async getRecent(limit = 10): Promise<ReflectionMemory[]> {
        const { rows } = await db.pg.query(
            `SELECT * FROM reflection_memories ORDER BY created_at DESC LIMIT $1`,
            [limit],
        );
        return rows.map(this.rowToReflection);
    }

    /** Get strategies learned for a specific topic */
    async getStrategies(topic: string, limit = 5): Promise<string[]> {
        const { rows } = await db.pg.query(
            `SELECT strategy_improvement FROM reflection_memories
       WHERE content ILIKE $1
          OR lesson_learned ILIKE $1
       ORDER BY importance DESC, created_at DESC
       LIMIT $2`,
            [`%${topic}%`, limit],
        );
        return rows.map((r: Record<string, unknown>) => r.strategy_improvement as string);
    }

    /** Count total reflections */
    async count(): Promise<number> {
        const { rows } = await db.pg.query(`SELECT COUNT(*)::int AS total FROM reflection_memories`);
        return rows[0].total;
    }

    // ---- Helpers ----

    private rowToReflection(row: Record<string, unknown>): ReflectionMemory {
        return {
            id: row.id as string,
            content: row.content as string,
            observation: row.observation as string,
            rootCause: row.root_cause as string,
            lessonLearned: row.lesson_learned as string,
            strategyImprovement: row.strategy_improvement as string,
            relatedEpisodeIds: (row.related_episode_ids as string[]) ?? [],
            importance: row.importance as number,
            metadata: (row.metadata as Record<string, unknown>) ?? {},
            timestamp: (row.created_at as Date).toISOString(),
        };
    }
}
