import { config } from '../config/index.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { ContextCompressor } from '../memory/context-compression.js';
import { StrategyMemoryService } from '../memory/strategy-memory.js';
import { BehaviorEngine } from '../reflection/behavior-engine.js';
import type {
    ContextBuilderOptions,
    BuiltContext,
    CompressedMemory,
    RetrievedMemory,
    TaskType,
} from '../memory/types.js';
import { inferTaskType } from '../memory/utils/task-relevance.js';

/**
 * Context Builder — orchestrates the full context assembly pipeline.
 *
 * This is the main consumer-facing API for Phase 2. Instead of raw memory
 * injection, it produces a token-budgeted, priority-sorted, optionally
 * compressed context that the prompt builder can directly consume.
 *
 * Pipeline:
 *   1. Retrieve memories via MemoryManager (with adaptive scoring)
 *   2. Sort by caller's priority weighting
 *   3. Optionally fetch relevant strategies
 *   4. Optionally inject behavioral directives
 *   5. Compress to fit max_tokens budget
 *   6. Return structured BuiltContext
 */
export class ContextBuilder {
    private compressor: ContextCompressor;

    constructor(
        private memory: MemoryManager,
        private strategies: StrategyMemoryService,
        private behavior: BehaviorEngine,
    ) {
        this.compressor = new ContextCompressor();
    }

    // ====================================================================
    // MAIN API
    // ====================================================================

    /**
     * Build a token-budgeted context for the agent.
     *
     * @example
     * const ctx = await contextBuilder.buildContext({
     *   query: 'fix TypeScript error in auth handler',
     *   max_tokens: 2048,
     *   priority: ['relevant', 'important', 'recent'],
     *   include_strategies: true,
     * });
     */
    async buildContext(options: ContextBuilderOptions): Promise<BuiltContext> {
        const maxTokens = options.max_tokens || config.contextBuilder.defaultMaxTokens;
        const taskType: TaskType = options.taskType ?? inferTaskType(options.query);

        console.log(`  📦 Building context: max_tokens=${maxTokens} priority=[${options.priority.join(',')}]`);

        // 1. Retrieve memories (leverages adaptive scoring from MemoryManager)
        let enrichedQuery = options.query;

        // Apply retrieval bias from behavioral directives
        if (options.include_directives !== false) {
            const biasContext = await this.behavior.getRetrievalBiasContext();
            if (biasContext) {
                enrichedQuery += `\n\nRetrieval context: ${biasContext}`;
            }
        }

        const memories = await this.memory.retrieve({
            query: enrichedQuery,
            taskType,
            limit: 15, // Over-fetch to allow for priority sorting + compression
        });

        // 2. Sort by priority weighting
        const sorted = this.applyPrioritySorting(memories, options.priority);

        // 3. Allocate token budget across context components
        let memoryBudget = maxTokens;
        let strategyBudget = 0;
        let directiveBudget = 0;

        if (options.include_strategies) {
            strategyBudget = Math.floor(maxTokens * 0.15); // 15% for strategies
            memoryBudget -= strategyBudget;
        }
        if (options.include_directives !== false) {
            directiveBudget = Math.floor(maxTokens * 0.10); // 10% for directives
            memoryBudget -= directiveBudget;
        }

        // 4. Compress memories to fit budget
        const { memories: compressed, compressionApplied } =
            await this.compressor.compressBatch(sorted, memoryBudget);

        // 5. Fetch strategies (if requested)
        const strategies = options.include_strategies
            ? await this.strategies.getRelevant(options.query, 3)
            : [];

        // Trim strategies to budget
        const trimmedStrategies = this.trimToTokenBudget(
            strategies,
            strategyBudget,
            (s) => s.pattern + ' ' + s.evidence,
        );

        // 6. Fetch behavioral directives
        const directives = options.include_directives !== false
            ? await this.behavior.getActiveDirectives()
            : [];

        // Trim directives to budget
        const trimmedDirectives = this.trimToTokenBudget(
            directives,
            directiveBudget,
            (d) => d.directive,
        );

        // 7. Calculate total tokens
        const totalTokens =
            compressed.reduce((sum, m) => sum + m.compressedTokens, 0) +
            this.compressor.estimateTokens(trimmedStrategies.map((s) => s.pattern).join(' ')) +
            this.compressor.estimateTokens(trimmedDirectives.map((d) => d.directive).join(' '));

        console.log(
            `  📦 Context built: ${compressed.length} memories` +
            `${compressionApplied ? ' (compressed)' : ''}, ` +
            `${trimmedStrategies.length} strategies, ` +
            `${trimmedDirectives.length} directives, ` +
            `~${totalTokens} tokens`,
        );

        return {
            memories: compressed,
            strategies: trimmedStrategies,
            directives: trimmedDirectives,
            totalTokens,
            compressionApplied,
        };
    }

    // ====================================================================
    // PRIORITY SORTING
    // ====================================================================

    /**
     * Re-sort memories based on the caller's priority order.
     *
     * Each priority is assigned a decreasing weight:
     *   first item  → 3x multiplier
     *   second item → 2x multiplier
     *   third item  → 1x multiplier
     *
     * This overlay is applied on top of the composite score from the reranker.
     */
    private applyPrioritySorting(
        memories: RetrievedMemory[],
        priorities: Array<'recent' | 'important' | 'relevant'>,
    ): RetrievedMemory[] {
        if (priorities.length === 0) return memories;

        const priorityWeight = (priority: string, index: number): number => {
            const base = priorities.length - index; // 3, 2, 1 for a 3-item list
            return base;
        };

        // Compute a priority-adjusted score for each memory
        const scored = memories.map((m) => {
            let priorityScore = 0;

            for (let i = 0; i < priorities.length; i++) {
                const weight = priorityWeight(priorities[i]!, i);
                switch (priorities[i]) {
                    case 'recent':
                        priorityScore += weight * m.score.recency;
                        break;
                    case 'important':
                        priorityScore += weight * m.score.importance;
                        break;
                    case 'relevant':
                        priorityScore += weight * m.score.semanticSimilarity;
                        break;
                }
            }

            return { memory: m, adjustedScore: m.score.totalScore * 0.5 + priorityScore * 0.5 };
        });

        scored.sort((a, b) => b.adjustedScore - a.adjustedScore);
        return scored.map((s) => s.memory);
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    /**
     * Trim a list of items to fit within a token budget.
     * Uses a text extractor function to estimate each item's token cost.
     */
    private trimToTokenBudget<T>(
        items: T[],
        budget: number,
        textExtractor: (item: T) => string,
    ): T[] {
        if (budget <= 0) return [];

        const result: T[] = [];
        let usedTokens = 0;

        for (const item of items) {
            const tokens = this.compressor.estimateTokens(textExtractor(item));
            if (usedTokens + tokens <= budget) {
                result.push(item);
                usedTokens += tokens;
            } else {
                break;
            }
        }

        return result;
    }
}
