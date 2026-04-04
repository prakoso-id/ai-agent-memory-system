import { llm } from '../llm/llm-client.js';
import type {
    RetrievedMemory,
    CompressedMemory,
    CompressionTier,
} from './types.js';

/**
 * Context Compressor — hierarchical memory compression pipeline.
 *
 * Three tiers:
 *   raw     → full original content (no compression)
 *   summary → LLM-condensed to key points (~3x reduction)
 *   insight → single-sentence distillation (~6x reduction from raw)
 *
 * The compressor is designed to be called by ContextBuilder when the
 * total token budget doesn't accommodate all retrieved memories at full fidelity.
 * It starts compressing the lowest-scored memories first, escalating the tier
 * as needed until the batch fits the budget.
 */
export class ContextCompressor {
    // ====================================================================
    // TOKEN ESTIMATION
    // ====================================================================

    /**
     * Estimate token count for a text string.
     *
     * Uses a character-based heuristic: 1 token ≈ 4 characters.
     * This is model-agnostic and works well as an upper-bound estimate
     * for English text across GPT/LLaMA/DeepSeek tokenizers.
     */
    estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    // ====================================================================
    // SINGLE MEMORY COMPRESSION
    // ====================================================================

    /**
     * Compress a single memory to the target tier.
     * Returns a CompressedMemory with the specified tier applied.
     *
     * Calling with 'raw' returns the memory as-is (no LLM call).
     */
    async compress(
        memory: RetrievedMemory,
        targetTier: CompressionTier,
    ): Promise<CompressedMemory> {
        const originalContent = memory.memory.content;
        const originalTokens = this.estimateTokens(originalContent);

        if (targetTier === 'raw') {
            return {
                memory,
                tier: 'raw',
                compressedContent: originalContent,
                originalTokens,
                compressedTokens: originalTokens,
            };
        }

        const compressed = await this.compressText(originalContent, targetTier);
        return {
            memory,
            tier: targetTier,
            compressedContent: compressed,
            originalTokens,
            compressedTokens: this.estimateTokens(compressed),
        };
    }

    // ====================================================================
    // BATCH COMPRESSION — Token-Budget Aware
    // ====================================================================

    /**
     * Compress a batch of memories to fit within a token budget.
     *
     * Strategy:
     *   1. Start with all memories at 'raw' tier.
     *   2. If total exceeds budget, compress lowest-scored memories to 'summary'.
     *   3. If still over budget, compress those to 'insight'.
     *   4. If still over budget, drop lowest-scored memories entirely.
     *
     * Returns the compressed batch sorted by original score (descending).
     */
    async compressBatch(
        memories: RetrievedMemory[],
        tokenBudget: number,
    ): Promise<{ memories: CompressedMemory[]; compressionApplied: boolean }> {
        if (memories.length === 0) {
            return { memories: [], compressionApplied: false };
        }

        // Start: all raw
        const items: CompressedMemory[] = memories.map((m) => ({
            memory: m,
            tier: 'raw' as CompressionTier,
            compressedContent: m.memory.content,
            originalTokens: this.estimateTokens(m.memory.content),
            compressedTokens: this.estimateTokens(m.memory.content),
        }));

        let totalTokens = items.reduce((sum, m) => sum + m.compressedTokens, 0);

        if (totalTokens <= tokenBudget) {
            return { memories: items, compressionApplied: false };
        }

        // Phase 1: Compress lowest-scored items to 'summary'
        // Sort by score ascending so we compress least valuable first
        const byScoreAsc = [...items].sort(
            (a, b) => a.memory.score.totalScore - b.memory.score.totalScore,
        );

        for (const item of byScoreAsc) {
            if (totalTokens <= tokenBudget) break;

            const compressed = await this.compressText(item.compressedContent, 'summary');
            const newTokens = this.estimateTokens(compressed);
            totalTokens -= item.compressedTokens;
            item.compressedContent = compressed;
            item.compressedTokens = newTokens;
            item.tier = 'summary';
            totalTokens += newTokens;
        }

        if (totalTokens <= tokenBudget) {
            return { memories: items, compressionApplied: true };
        }

        // Phase 2: Compress summary items to 'insight'
        const summaryItems = byScoreAsc.filter((m) => m.tier === 'summary');
        for (const item of summaryItems) {
            if (totalTokens <= tokenBudget) break;

            const compressed = await this.compressText(item.compressedContent, 'insight');
            const newTokens = this.estimateTokens(compressed);
            totalTokens -= item.compressedTokens;
            item.compressedContent = compressed;
            item.compressedTokens = newTokens;
            item.tier = 'insight';
            totalTokens += newTokens;
        }

        if (totalTokens <= tokenBudget) {
            return { memories: items, compressionApplied: true };
        }

        // Phase 3: Drop lowest-scored items that are already insights
        const kept: CompressedMemory[] = [];
        let keptTokens = 0;

        // Re-sort by score descending (keep highest first)
        items.sort((a, b) => b.memory.score.totalScore - a.memory.score.totalScore);

        for (const item of items) {
            if (keptTokens + item.compressedTokens <= tokenBudget) {
                kept.push(item);
                keptTokens += item.compressedTokens;
            }
        }

        return { memories: kept, compressionApplied: true };
    }

    // ====================================================================
    // PRIVATE — LLM Compression
    // ====================================================================

    private async compressText(text: string, tier: 'summary' | 'insight'): Promise<string> {
        const prompt = tier === 'summary'
            ? `Condense the following text to its key points. Keep important facts, numbers, and names. Remove filler and redundancy. Output only the condensed text, no preamble.\n\nText: ${text}`
            : `Distill the following text into a single concise sentence capturing the core insight. Output only the sentence.\n\nText: ${text}`;

        try {
            const result = await llm.chat(
                [
                    { role: 'system', content: 'You are a precise text compressor. Output only the compressed text.' },
                    { role: 'user', content: prompt },
                ],
                { temperature: 0.2, maxTokens: tier === 'summary' ? 256 : 64 },
            );
            return result.trim();
        } catch (error) {
            console.error(`Compression to ${tier} failed:`, error);
            return text; // Fallback to original on error
        }
    }
}
