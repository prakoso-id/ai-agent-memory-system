/**
 * Shared test helpers.
 * - initDb()         : idempotent DB init (safe to call from multiple test files)
 * - uniqueTag()      : generate an isolated tag so each test cleans up its own data
 * - cleanupSemantic(): delete Qdrant points by ID after each test
 * - cleanupEpisodic(): delete PostgreSQL rows by session_id after each test
 */

import { db } from '../database/connections.js';
import { initializeDatabase } from '../database/init.js';
import { config } from '../config/index.js';
import { v4 as uuid } from 'uuid';

// ── DB initialisation ────────────────────────────────────────────────────────

let _initialized = false;

export async function initDb(): Promise<void> {
    if (_initialized) return;
    await initializeDatabase();
    _initialized = true;
}

// ── Unique identifiers ───────────────────────────────────────────────────────

/**
 * Returns a tag like "tc-001-<short-uuid>" so each test suite can clean up
 * only its own memories without touching other tests' data.
 */
export function uniqueTag(prefix: string): string {
    return `${prefix}-${uuid().substring(0, 8)}`;
}

// ── Cleanup helpers ──────────────────────────────────────────────────────────

/**
 * Delete Qdrant points by ID.
 * Call this in `afterAll` after collecting stored IDs during the test.
 */
export async function cleanupSemantic(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
        await db.qdrant.delete(config.qdrant.collection, { points: ids });
    } catch {
        // best-effort: don't fail the test report on cleanup errors
    }
}

/**
 * Delete episodic_memories rows by session_id.
 * Pass the unique session_id you used in the test.
 */
export async function cleanupEpisodic(sessionId: string): Promise<void> {
    try {
        await db.pg.query(
            `DELETE FROM episodic_memories WHERE session_id = $1`,
            [sessionId],
        );
    } catch {
        // best-effort
    }
}

/**
 * Delete reflection_memories rows whose metadata contains a given test tag.
 * Unused directly but available for future reflection tests.
 */
export async function cleanupReflection(sessionId: string): Promise<void> {
    try {
        await db.pg.query(
            `DELETE FROM reflection_memories WHERE metadata->>'testSession' = $1`,
            [sessionId],
        );
    } catch {
        // best-effort
    }
}

// ── Small assertion helper ───────────────────────────────────────────────────

/**
 * Assert that array `arr` is sorted descending by `key`.
 * Returns the sorted copy so callers can still inspect it.
 */
export function assertDescendingBy<T>(arr: T[], key: keyof T): void {
    for (let i = 0; i < arr.length - 1; i++) {
        const a = arr[i]![key] as number;
        const b = arr[i + 1]![key] as number;
        if (a < b) {
            throw new Error(
                `Expected descending order by "${String(key)}" at index ${i}: ` +
                `${a} < ${b}`,
            );
        }
    }
}

// ── Phase 2 cleanup helpers ─────────────────────────────────────────────────

/** Delete retrieval_feedback rows by memory IDs. */
export async function cleanupFeedback(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;
    try {
        await db.pg.query(
            `DELETE FROM retrieval_feedback WHERE memory_id = ANY($1)`,
            [memoryIds],
        );
    } catch {
        // best-effort
    }
}

/** Delete strategy_memories rows by IDs. */
export async function cleanupStrategies(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
        await db.pg.query(
            `DELETE FROM strategy_memories WHERE id = ANY($1::uuid[])`,
            [ids],
        );
    } catch {
        // best-effort
    }
}

/** Delete behavioral_directives rows by IDs. */
export async function cleanupDirectives(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
        await db.pg.query(
            `DELETE FROM behavioral_directives WHERE id = ANY($1::uuid[])`,
            [ids],
        );
    } catch {
        // best-effort
    }
}
