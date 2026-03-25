import { db } from '../../database/connections.js';

/**
 * Write-filter utilities for memory storage.
 *
 * Two gates are applied before a memory reaches the store:
 *   1. Importance threshold — noise below 0.15 is dropped.
 *   2. Novelty detection    — near-duplicates (cosine ≥ 0.92) are collapsed
 *                             into the existing record (usage_count bump) rather
 *                             than creating a new entry.
 */

/** Memories below this importance are not worth persisting. */
export const IMPORTANCE_THRESHOLD = 0.15;

/**
 * Cosine similarity above which two memories are considered duplicates.
 * 0.92 is tight enough to catch re-phrasings without merging genuinely
 * different facts that happen to share vocabulary.
 */
export const NOVELTY_THRESHOLD = 0.92;

/**
 * Returns true when the importance score clears the storage threshold.
 * Call this *before* embedding to skip the LLM call entirely for cheap noise.
 */
export function passesImportanceFilter(importance: number): boolean {
    return importance >= IMPORTANCE_THRESHOLD;
}

/**
 * Searches the given Qdrant collection for an existing point whose embedding
 * is nearly identical to `embedding`.
 *
 * @returns The ID of the duplicate if found, or `null` if the content is novel.
 */
export async function findDuplicateId(
    embedding: number[],
    collection: string,
    threshold = NOVELTY_THRESHOLD,
): Promise<string | null> {
    const results = await db.qdrant.search(collection, {
        vector: embedding,
        limit: 1,
        score_threshold: threshold,
        with_payload: false,
    });
    return results.length > 0 ? (results[0]!.id as string) : null;
}
