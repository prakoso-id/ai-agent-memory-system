import { llm } from '../llm/llm-client.js';
import { config } from '../config/index.js';
import { db } from '../database/connections.js';
import { EpisodicMemoryService } from './episodic-memory.js';
import { SemanticMemoryService } from './semantic-memory.js';
import type { ConsolidationResult } from './types.js';

/**
 * Memory Consolidation — handles decay, summarization, and merging of old memories.
 */
export class MemoryConsolidation {
    constructor(
        private episodic: EpisodicMemoryService,
        private semantic: SemanticMemoryService,
    ) { }

    /** Run a full consolidation cycle */
    async consolidate(): Promise<ConsolidationResult> {
        console.log('🧹 Running memory consolidation...');

        const [decayed, summarized, merged] = await Promise.all([
            this.applyDecay(),
            this.summarizeClusters(),
            this.mergeRedundant(),
        ]);

        // Phase 3: semantic decay + stale archival
        let semanticDecayed = 0;
        let archived = 0;
        try {
            semanticDecayed = await this.applySemanticDecay(config.agent.memoryDecayFactor, 3);
            archived = await this.archiveStaleMemories(
                config.evolution.staleArchiveDays,
                0.05,
            );
        } catch (err) {
            console.error('  ❌ Phase 3 consolidation step failed:', err);
        }

        console.log(
            `  📉 Decayed: ${decayed} | 📝 Summarized: ${summarized} | 🔀 Merged: ${merged}` +
            `${semanticDecayed > 0 ? ` | 🌀 Semantic-decayed: ${semanticDecayed}` : ''}` +
            `${archived > 0 ? ` | 📦 Archived: ${archived}` : ''}`,
        );
        return { decayed, summarized, merged };
    }

    /** Apply exponential decay to old episodic memories */
    private async applyDecay(): Promise<number> {
        return this.episodic.applyDecay(config.agent.memoryDecayFactor, 24);
    }

    /** Summarize clusters of related semantic memories */
    private async summarizeClusters(): Promise<number> {
        // Find all semantic memories and look for clusters that can be summarized
        const categories = ['user_preference', 'project_fact', 'technical_detail'];
        let summarized = 0;

        for (const category of categories) {
            const memories = await this.semantic.search('', {
                category,
                limit: 50,
                minScore: 0,
            });

            // Only summarize if we have many memories in a category
            if (memories.length < 10) continue;

            // Group highly similar memories (score > 0.85)
            const clusters = this.findClusters(
                memories.map((m) => ({ id: m.id, content: m.content, importance: m.importance })),
            );

            for (const cluster of clusters) {
                if (cluster.length < 3) continue;

                try {
                    const summary = await this.summarizeCluster(cluster.map((c) => c.content));

                    // Store the summary as a new memory
                    await this.semantic.store({
                        content: summary,
                        category,
                        source: 'consolidation',
                        importance: Math.max(...cluster.map((c) => c.importance)),
                        metadata: { consolidatedFrom: cluster.map((c) => c.id) },
                    });

                    // Remove the originals
                    for (const item of cluster) {
                        await this.semantic.delete(item.id);
                    }

                    summarized += cluster.length;
                } catch (error) {
                    console.error('Cluster summarization failed:', error);
                }
            }
        }

        return summarized;
    }

    /** Merge redundant semantic memories */
    private async mergeRedundant(): Promise<number> {
        // Search for highly similar pairs and merge them
        let merged = 0;

        const recent = await this.semantic.search('knowledge facts preferences', {
            limit: 30,
            minScore: 0,
        });

        const seen = new Set<string>();

        for (let i = 0; i < recent.length; i++) {
            if (seen.has(recent[i]!.id)) continue;

            // Search for near-duplicates of this memory
            const duplicates = await this.semantic.search(recent[i]!.content, {
                limit: 5,
                minScore: 0.9,
            });

            const toMerge = duplicates.filter(
                (d) => d.id !== recent[i]!.id && !seen.has(d.id),
            );

            if (toMerge.length > 0) {
                // Keep the one with highest importance, delete the rest
                const all = [recent[i]!, ...toMerge].sort((a, b) => b.importance - a.importance);
                for (let j = 1; j < all.length; j++) {
                    await this.semantic.delete(all[j]!.id);
                    seen.add(all[j]!.id);
                    merged++;
                }
            }
        }

        return merged;
    }

    // ---- Helpers ----

    /** Simple content-based clustering */
    private findClusters(
        items: Array<{ id: string; content: string; importance: number }>,
    ): Array<typeof items> {
        // Simple grouping: items that share 3+ common keywords
        const clusters: Array<typeof items> = [];
        const assigned = new Set<string>();

        for (const item of items) {
            if (assigned.has(item.id)) continue;
            const keywords = this.extractKeywords(item.content);
            const cluster = [item];
            assigned.add(item.id);

            for (const other of items) {
                if (assigned.has(other.id)) continue;
                const otherKeywords = this.extractKeywords(other.content);
                const overlap = keywords.filter((k) => otherKeywords.includes(k)).length;
                if (overlap >= 3) {
                    cluster.push(other);
                    assigned.add(other.id);
                }
            }

            clusters.push(cluster);
        }

        return clusters;
    }

    private extractKeywords(text: string): string[] {
        const stopwords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'for', 'and', 'or', 'but', 'with', 'on', 'at', 'by', 'as', 'it', 'its', 'that', 'this', 'from']);
        return text
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 2 && !stopwords.has(w));
    }

    private async summarizeCluster(contents: string[]): Promise<string> {
        const result = await llm.chat([
            {
                role: 'system',
                content: 'You are a knowledge summarizer. Condense multiple related facts into a single comprehensive summary.',
            },
            {
                role: 'user',
                content: `Summarize these related pieces of knowledge into a single, concise fact:\n\n${contents.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nProvide a single paragraph summary that captures all key information.`,
            },
        ], { temperature: 0.3 });

        return result;
    }

    // ====================================================================
    // PHASE 3: SEMANTIC DECAY & ARCHIVAL
    // ====================================================================

    /**
     * Apply decay to semantic memories by reducing their decay_factor.
     *
     * High-confidence memories decay slower:
     *   new_decay = old_decay × exp(-rate × age_days / (1 + confidence))
     *
     * Only affects memories older than minAgeDays.
     */
    async applySemanticDecay(decayRate: number, minAgeDays: number): Promise<number> {
        // Get memories older than the threshold
        const cutoff = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000).toISOString();
        let decayed = 0;

        try {
            // Scroll through Qdrant to find old memories
            const scrollResult = await db.qdrant.scroll(config.qdrant.collection, {
                filter: {
                    must: [
                        { key: 'archived', match: { value: false } },
                    ],
                },
                limit: 100,
                with_payload: true,
                with_vector: false,
            });

            for (const point of scrollResult.points) {
                const timestamp = point.payload!.timestamp as string;
                const currentDecay = (point.payload!.decay_factor as number) ?? 1.0;
                const confidence = (point.payload!.confidence as number) ?? 0.5;

                if (timestamp < cutoff && currentDecay > 0.1) {
                    const ageDays = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
                    // Higher confidence = slower decay
                    const adjustedRate = decayRate / (1 + confidence);
                    const newDecay = currentDecay * Math.exp(-adjustedRate * ageDays);

                    await this.semantic.updateDecayFactor(
                        point.id as string,
                        Math.max(0.01, newDecay),
                    );
                    decayed++;
                }
            }
        } catch (error) {
            console.error('Semantic decay failed:', error);
        }

        return decayed;
    }

    /**
     * Archive stale, unused memories.
     *
     * A memory is stale if:
     *   - importance < minImportance
     *   - usage_count = 0
     *   - age > maxAgeDays
     */
    async archiveStaleMemories(maxAgeDays: number, minImportance: number): Promise<number> {
        const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
        let archived = 0;

        try {
            const scrollResult = await db.qdrant.scroll(config.qdrant.collection, {
                filter: {
                    must: [
                        { key: 'archived', match: { value: false } },
                    ],
                },
                limit: 100,
                with_payload: true,
                with_vector: false,
            });

            for (const point of scrollResult.points) {
                const timestamp = point.payload!.timestamp as string;
                const importance = (point.payload!.importance as number) ?? 0;
                const usageCount = (point.payload!.usage_count as number) ?? 0;

                if (timestamp < cutoff && importance < minImportance && usageCount === 0) {
                    await this.semantic.archive(point.id as string);
                    archived++;
                    console.log(
                        `    📦 Archived stale memory: "${(point.payload!.content as string)?.substring(0, 50)}..."`,
                    );
                }
            }
        } catch (error) {
            console.error('Stale memory archival failed:', error);
        }

        return archived;
    }
}
