import type { RetrievedMemory, TaskType, AdaptiveWeights } from '../types.js';
import { scoreTaskRelevance } from './task-relevance.js';

/**
 * Multi-stage memory reranker.
 *
 * Retrieval pipeline:
 *   Stage 1 – Vector (semantic) search      → handled by Qdrant upstream
 *   Stage 2 – Source/type filter            → optional layer restriction
 *   Stage 3 – Composite heuristic rerank    → this module
 *
 * Phase 2 additions:
 *   • Adaptive weights — shift weight distribution based on retrieval feedback
 *   • Per-memory feedback boosts — individual score multiplier from past helpfulness
 *
 * Phase 3 additions:
 *   • Per-memory confidence boosts — scales score from 0.5× (low) to 1.25× (high)
 *
 * Phase 4 additions:
 *   • Role relevance boosts — per-memory multiplier derived from importance_per_role
 *     (supplied via feedbackBoosts from RoleMemoryService, or via confidenceBoosts)
 *   • Both feedbackBoosts and confidenceBoosts are applied multiplicatively after
 *     the composite score so that role context and confidence always influence ranking
 *
 * Default composite score weights:
 *   0.35 × semantic_similarity
 *   0.25 × recency
 *   0.20 × importance
 *   0.10 × task_relevance
 *   0.10 × usage_popularity
 */

/** Default weights — used when no adaptive weights are provided */
const DEFAULT_WEIGHTS: AdaptiveWeights = {
    semanticSimilarity: 0.35,
    recency: 0.25,
    importance: 0.20,
    taskRelevance: 0.10,
    usagePopularity: 0.10,
};

export interface RerankOptions {
    /** If provided, rerank scores are task-type-aware */
    taskType?: TaskType;
    /** Restrict results to specific memory sources (optional) */
    sourceFilter?: Array<RetrievedMemory['source']>;
    /** Max results to return after reranking */
    limit?: number;
    /** Adaptive weights from feedback tracker (overrides defaults) */
    adaptiveWeights?: AdaptiveWeights;
    /**
     * Per-memory boost multipliers.
     * Phase 2: helpfulness feedback boost.
     * Phase 4: role-relevance boost (importance_per_role[role] / global_importance).
     * Values are capped to [0.5, 2.0] by callers.
     */
    feedbackBoosts?: Map<string, number>;
    /**
     * Per-memory confidence multipliers from confidence scorer (Phase 3).
     * Scales final score from 0.5× (confidence=0) to 1.25× (confidence=1).
     * Must now be supplied by MemoryManager.retrieve() alongside feedbackBoosts.
     */
    confidenceBoosts?: Map<string, number>;
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

    // Use adaptive weights if provided, otherwise defaults
    const w = options.adaptiveWeights ?? DEFAULT_WEIGHTS;

    // Stage 3 — composite score recomputation
    for (const item of candidates) {
        const taskRelevance = options.taskType
            ? scoreTaskRelevance(item.memory.tags ?? [], options.taskType)
            : 0.5; // neutral when no task type given

        // Popularity: saturates at usage_count = 20 → 1.0
        const usagePopularity = Math.min(1.0, (item.memory.usage_count ?? 0) / 20);

        item.score.taskRelevance = taskRelevance;
        item.score.totalScore =
            w.semanticSimilarity * item.score.semanticSimilarity +
            w.recency * item.score.recency +
            w.importance * item.score.importance +
            w.taskRelevance * taskRelevance +
            w.usagePopularity * usagePopularity;

        // Apply per-memory feedback boost (Phase 2 / Phase 4 role boost)
        if (options.feedbackBoosts) {
            const boost = options.feedbackBoosts.get(item.score.memoryId) ?? 1.0;
            item.score.totalScore *= boost;
        }

        // Apply per-memory confidence boost (Phase 3 — now wired from MemoryManager)
        if (options.confidenceBoosts) {
            const confidence = options.confidenceBoosts.get(item.score.memoryId) ?? 0.5;
            // Confidence scales from 0.5× (low confidence) to 1.25× (high confidence)
            item.score.totalScore *= (0.5 + confidence * 0.75);
        }
    }

    candidates.sort((a, b) => b.score.totalScore - a.score.totalScore);

    return options.limit ? candidates.slice(0, options.limit) : candidates;
}
