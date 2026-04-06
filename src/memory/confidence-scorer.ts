import { db } from '../database/connections.js';
import { config } from '../config/index.js';
import { ConflictDetector } from './conflict-detector.js';
import type { ConfidenceScore } from './types.js';

/**
 * Confidence Scorer — computes and maintains confidence scores for memories.
 *
 * Phase 3: Each memory has a composite confidence score derived from 4 signals:
 *
 *   confidence = w₁ × usage_signal
 *              + w₂ × consistency_signal
 *              + w₃ × source_reliability
 *              + w₄ × recency_signal
 *
 * Default weights: w₁=0.30, w₂=0.25, w₃=0.25, w₄=0.20
 *
 * Signals:
 *   usage_signal       = min(1.0, usage_count / 15)
 *   consistency_signal = 1.0 - conflict_count / (conflict_count + 3)
 *   source_reliability = tier lookup (0.3 → 1.0)
 *   recency_signal     = exp(-decay_rate × age_hours)
 */

const WEIGHTS = {
    usage: 0.30,
    consistency: 0.25,
    sourceReliability: 0.25,
    recency: 0.20,
};

/** Source trust tiers — higher = more reliable */
const SOURCE_TRUST: Record<string, number> = {
    api: 1.0,           // directly stored via API
    direct: 1.0,        // user explicitly stated
    reflection: 0.8,    // agent's own reflection
    consolidation: 0.7, // merged/summarized
    episode: 0.6,       // extracted from conversation
    unknown: 0.3,       // no source info
};

export class ConfidenceScorer {
    constructor(private conflicts: ConflictDetector) {}

    // ====================================================================
    // COMPUTE
    // ====================================================================

    /**
     * Compute the confidence score for a memory.
     *
     * @param memoryId    Qdrant point ID
     * @param usageCount  Number of times the memory has been retrieved
     * @param source      Source string (e.g., 'episode:abc', 'api', 'reflection')
     * @param timestamp   ISO 8601 creation timestamp
     */
    async computeConfidence(
        memoryId: string,
        usageCount: number,
        source: string,
        timestamp: string,
    ): Promise<ConfidenceScore> {
        // Signal 1: Usage frequency (saturates at 15)
        const usageSignal = Math.min(1.0, usageCount / 15);

        // Signal 2: Consistency (inverse of conflict count, Bayesian smoothed)
        const conflictCount = await this.conflicts.countConflicts(memoryId);
        const consistencySignal = 1.0 - conflictCount / (conflictCount + 3);

        // Signal 3: Source reliability
        const sourceReliability = this.getSourceReliability(source);

        // Signal 4: Recency decay
        const ageMs = Date.now() - new Date(timestamp).getTime();
        const ageHours = ageMs / (1000 * 60 * 60);
        const recencySignal = Math.exp(-config.evolution.confidenceDecayRate * ageHours);

        // Composite score
        const overall =
            WEIGHTS.usage * usageSignal +
            WEIGHTS.consistency * consistencySignal +
            WEIGHTS.sourceReliability * sourceReliability +
            WEIGHTS.recency * recencySignal;

        return {
            overall: Math.max(0, Math.min(1, overall)),
            usage_signal: usageSignal,
            consistency_signal: consistencySignal,
            source_reliability: sourceReliability,
            recency_signal: recencySignal,
        };
    }

    /**
     * Compute initial confidence for a freshly stored memory.
     * No conflicts yet, no usage yet — relies on source + recency.
     */
    computeInitialConfidence(source: string): number {
        const sourceReliability = this.getSourceReliability(source);
        // Fresh memory: usage=0, no conflicts, full recency
        const initial =
            WEIGHTS.usage * 0 +            // no usage yet
            WEIGHTS.consistency * 1.0 +     // no conflicts
            WEIGHTS.sourceReliability * sourceReliability +
            WEIGHTS.recency * 1.0;          // just created

        return Math.max(0, Math.min(1, initial));
    }

    /**
     * Adjust confidence after retrieval feedback.
     * Positive feedback nudges confidence up, negative nudges down.
     */
    adjustAfterFeedback(currentConfidence: number, helpful: boolean): number {
        const delta = helpful ? 0.05 : -0.03;
        return Math.max(0, Math.min(1, currentConfidence + delta));
    }

    // ====================================================================
    // SOURCE RELIABILITY
    // ====================================================================

    /**
     * Map a source string to a trust score.
     *
     * Source strings look like: 'episode:<id>', 'api', 'reflection', 'consolidation'
     * We extract the prefix before ':' if present.
     */
    getSourceReliability(source: string): number {
        if (!source) return SOURCE_TRUST.unknown!;

        const prefix = source.includes(':') ? source.split(':')[0]! : source;
        return SOURCE_TRUST[prefix.toLowerCase()] ?? SOURCE_TRUST.unknown!;
    }

    // ====================================================================
    // BATCH OPERATIONS
    // ====================================================================

    /**
     * Batch-recompute confidence for a set of memory IDs.
     * Useful for periodic recalculation during consolidation.
     *
     * @returns Map of memoryId → new confidence score
     */
    async batchRecompute(
        memories: Array<{
            id: string;
            usage_count: number;
            source: string;
            timestamp: string;
        }>,
    ): Promise<Map<string, number>> {
        const results = new Map<string, number>();

        for (const mem of memories) {
            const score = await this.computeConfidence(
                mem.id,
                mem.usage_count,
                mem.source,
                mem.timestamp,
            );
            results.set(mem.id, score.overall);
        }

        return results;
    }

    /** Get the confidence threshold below which memories are considered low-confidence */
    getConfidenceThreshold(): number {
        return 0.25;
    }
}
