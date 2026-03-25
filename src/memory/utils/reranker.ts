import type { RetrievedMemory, TaskType } from '../types.js';
import { scoreTaskRelevance } from './task-relevance.js';

/**
 * Multi-stage memory reranker.
 *
 * Retrieval pipeline:
 *   Stage 1 – Vector (semantic) search      → handled by Qdrant upstream
 *   Stage 2 – Source/type filter            → optional layer restriction
 *   Stage 3 – Composite heuristic rerank    → this module
 *
 * Composite score weights:
 *   0.35 × semantic_similarity   (how close the vector is)
 *   0.25 × recency               (exponential decay over time)
 *   0.20 × importance            (agent-assigned 0–1 score)
 *   0.10 × task_relevance        (tag overlap with task type)
 *   0.10 × usage_popularity      (how often this memory was accessed)
 *
 * The weights deliberately down-weight pure semantic similarity vs. the
 * original 0.4 split, because context (task + importance + recency) often
 * matters more than raw vector distance for agent decision-making.
 */

export interface RerankOptions {
    /** If provided, rerank scores are task-type-aware */
    taskType?: TaskType;
    /** Restrict results to specific memory sources (optional) */
    sourceFilter?: Array<RetrievedMemory['source']>;
    /** Max results to return after reranking */
    limit?: number;
}

/**
 * Rerank a candidate set of retrieved memories.
 *
 * Mutates `score.taskRelevance` and `score.totalScore` on each item,
 * then returns the sorted (and optionally sliced) list.
 */
export function rerank(
    memories: RetrievedMemory[],
    options: RerankOptions = {},
): RetrievedMemory[] {
    // Stage 2 — source filter
    const candidates = options.sourceFilter?.length
        ? memories.filter((m) => options.sourceFilter!.includes(m.source))
        : memories;

    // Stage 3 — composite score recomputation
    for (const item of candidates) {
        const taskRelevance = options.taskType
            ? scoreTaskRelevance(item.memory.tags ?? [], options.taskType)
            : 0.5; // neutral when no task type given

        // Popularity: saturates at usage_count = 20 → 1.0
        const usagePopularity = Math.min(1.0, (item.memory.usage_count ?? 0) / 20);

        item.score.taskRelevance = taskRelevance;
        item.score.totalScore =
            0.35 * item.score.semanticSimilarity +
            0.25 * item.score.recency +
            0.20 * item.score.importance +
            0.10 * taskRelevance +
            0.10 * usagePopularity;
    }

    candidates.sort((a, b) => b.score.totalScore - a.score.totalScore);

    return options.limit ? candidates.slice(0, options.limit) : candidates;
}
