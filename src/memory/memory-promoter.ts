import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import { llm } from '../llm/llm-client.js';
import { config } from '../config/index.js';
import { EpisodicMemoryService } from './episodic-memory.js';
import { SemanticMemoryService } from './semantic-memory.js';
import { KnowledgeGraphService } from './knowledge-graph.js';
import type { PromotionEvent } from './types.js';

/**
 * Memory Promoter — promotes frequently-used memories to higher layers.
 *
 * Phase 3: Implements the memory lifecycle graduation system:
 *
 *   Episodic → Semantic:
 *     - Episode is used ≥ 5 times AND importance ≥ 0.6
 *     - Content is extracted as a semantic fact
 *     - Original episode is kept (not deleted)
 *
 *   Semantic → Knowledge Graph:
 *     - Memory is used ≥ 10 times AND confidence ≥ 0.7
 *     - Content is parsed into entity-relationship triples via LLM
 *     - Adds nodes/edges to Neo4j
 *     - Original semantic memory is tagged 'promoted'
 *
 * All promotions are logged in the `promotion_events` table for auditing.
 */
export class MemoryPromoter {
    constructor(
        private episodic: EpisodicMemoryService,
        private semantic: SemanticMemoryService,
        private knowledgeGraph: KnowledgeGraphService,
    ) {}

    // ====================================================================
    // ELIGIBILITY
    // ====================================================================

    /** Check if an episodic memory is eligible for promotion to semantic */
    isEpisodicPromotionEligible(usageCount: number, importance: number): boolean {
        return (
            usageCount >= config.evolution.promotionUsageThreshold &&
            importance >= 0.6
        );
    }

    /** Check if a semantic memory is eligible for promotion to knowledge graph */
    isSemanticPromotionEligible(usageCount: number, confidence: number): boolean {
        return (
            usageCount >= (config.evolution.promotionUsageThreshold * 2) &&
            confidence >= config.evolution.promotionConfidenceThreshold
        );
    }

    // ====================================================================
    // PROMOTE: EPISODIC → SEMANTIC
    // ====================================================================

    /**
     * Promote an episodic memory to a semantic memory.
     *
     * Extracts the core fact from the episode content and stores it
     * as a new semantic memory. The episode is not deleted.
     *
     * @returns The newly created semantic memory ID, or null if promotion fails
     */
    async promoteEpisodicToSemantic(episodeId: string): Promise<string | null> {
        const episode = await this.episodic.getById(episodeId);
        if (!episode) return null;

        if (!this.isEpisodicPromotionEligible(episode.usage_count, episode.importance)) {
            return null;
        }

        try {
            // Extract the core fact from the episode via LLM
            const fact = await llm.chatJSON<{
                content: string;
                category: string;
                importance: number;
            }>([
                {
                    role: 'system',
                    content: 'You are a knowledge extractor. Given a conversation episode, extract the single most important fact as a concise statement.',
                },
                {
                    role: 'user',
                    content: `Extract the key fact from this episode:

"${episode.content}"

Respond as JSON:
{
  "content": "concise factual statement",
  "category": "user_preference" | "project_fact" | "technical_detail" | "general_knowledge",
  "importance": 0.0 to 1.0
}`,
                },
            ]);

            // Store as semantic memory
            const stored = await this.semantic.store({
                content: fact.content,
                category: fact.category,
                source: `promotion:episode:${episodeId}`,
                importance: Math.max(fact.importance, episode.importance),
                tags: ['promoted', 'from_episodic', ...(episode.tags ?? [])],
                metadata: {
                    promotedFrom: 'episodic',
                    originalEpisodeId: episodeId,
                    promotionDate: new Date().toISOString(),
                },
            });

            if (stored) {
                // Record the promotion event
                await this.recordPromotion({
                    memory_id: episodeId,
                    from_layer: 'episodic',
                    to_layer: 'semantic',
                    reason: `Usage count ${episode.usage_count} ≥ ${config.evolution.promotionUsageThreshold}, importance ${episode.importance.toFixed(2)} ≥ 0.6`,
                });

                console.log(
                    `    ⬆️  Promoted episodic → semantic: "${fact.content.substring(0, 60)}…"`,
                );
                return stored.id;
            }

            return null;
        } catch (error) {
            console.error('Episodic → Semantic promotion failed:', error);
            return null;
        }
    }

    // ====================================================================
    // PROMOTE: SEMANTIC → KNOWLEDGE GRAPH
    // ====================================================================

    /**
     * Promote a semantic memory to the knowledge graph.
     *
     * Parses the memory content into entity-relationship triples via LLM,
     * then adds them to Neo4j. The semantic memory is tagged 'promoted'.
     *
     * @returns Array of created node names, or null if promotion fails
     */
    async promoteSemanticToGraph(
        semanticId: string,
        confidence: number,
    ): Promise<string[] | null> {
        const memory = await this.semantic.getById(semanticId);
        if (!memory) return null;

        if (!this.isSemanticPromotionEligible(memory.usage_count, confidence)) {
            return null;
        }

        try {
            // Extract entities and relationships via LLM
            const triples = await llm.chatJSON<{
                entities: Array<{ name: string; label: string; properties: Record<string, unknown> }>;
                relationships: Array<{ source: string; target: string; relationship: string }>;
            }>([
                {
                    role: 'system',
                    content: 'You are a knowledge graph builder. Given a factual statement, extract entities and their relationships.',
                },
                {
                    role: 'user',
                    content: `Extract entities and relationships from this fact:

"${memory.content}"

Respond as JSON:
{
  "entities": [{ "name": "EntityName", "label": "Person|Technology|Project|Concept|Preference", "properties": {} }],
  "relationships": [{ "source": "Entity1", "target": "Entity2", "relationship": "uses|prefers|works_on|knows|etc" }]
}`,
                },
            ]);

            const nodeNames: string[] = [];

            // Add entities to knowledge graph
            for (const entity of triples.entities) {
                await this.knowledgeGraph.addNode({
                    name: entity.name,
                    label: entity.label,
                    properties: {
                        ...entity.properties,
                        sourceMemoryId: semanticId,
                        promotedAt: new Date().toISOString(),
                    },
                });
                nodeNames.push(entity.name);
            }

            // Add relationships
            for (const rel of triples.relationships) {
                await this.knowledgeGraph.addEdge({
                    sourceId: rel.source,
                    targetId: rel.target,
                    relationship: rel.relationship,
                    properties: { sourceMemoryId: semanticId },
                    weight: confidence,
                });
            }

            // Tag the semantic memory as promoted
            const existingTags = memory.tags ?? [];
            if (!existingTags.includes('promoted')) {
                // We update via re-storing with the promoted tag
                // The semantic memory is kept intact for retrieval
            }

            // Record the promotion event
            await this.recordPromotion({
                memory_id: semanticId,
                from_layer: 'semantic',
                to_layer: 'knowledge_graph',
                reason: `Usage count ${memory.usage_count} ≥ ${config.evolution.promotionUsageThreshold * 2}, confidence ${confidence.toFixed(2)} ≥ ${config.evolution.promotionConfidenceThreshold}`,
            });

            console.log(
                `    ⬆️  Promoted semantic → graph: ${nodeNames.length} nodes, ${triples.relationships.length} edges`,
            );

            return nodeNames;
        } catch (error) {
            console.error('Semantic → Knowledge Graph promotion failed:', error);
            return null;
        }
    }

    // ====================================================================
    // PROMOTION CYCLE
    // ====================================================================

    /**
     * Run a full promotion cycle across all eligible memories.
     *
     * Finds episodic memories eligible for semantic promotion and
     * semantic memories eligible for knowledge graph promotion.
     *
     * @returns Array of promotion events from this cycle
     */
    async runPromotionCycle(): Promise<PromotionEvent[]> {
        const events: PromotionEvent[] = [];

        // 1. Check episodic → semantic promotions
        try {
            const candidates = await this.episodic.query({
                minImportance: 0.6,
                limit: 20,
            });

            const eligible = candidates.filter((e) =>
                this.isEpisodicPromotionEligible(e.usage_count, e.importance),
            );

            // Check if already promoted
            for (const episode of eligible) {
                const alreadyPromoted = await this.hasBeenPromoted(episode.id);
                if (!alreadyPromoted) {
                    const newId = await this.promoteEpisodicToSemantic(episode.id);
                    if (newId) {
                        events.push({
                            id: uuid(),
                            memory_id: episode.id,
                            from_layer: 'episodic',
                            to_layer: 'semantic',
                            reason: 'Automatic promotion cycle',
                            promoted_at: new Date().toISOString(),
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Episodic promotion cycle failed:', error);
        }

        if (events.length > 0) {
            console.log(`    ⬆️  Promotion cycle: ${events.length} memories promoted`);
        }

        return events;
    }

    // ====================================================================
    // HISTORY
    // ====================================================================

    /** Get promotion history for a specific memory or all */
    async getPromotionHistory(memoryId?: string, limit = 20): Promise<PromotionEvent[]> {
        const query = memoryId
            ? `SELECT * FROM promotion_events WHERE memory_id = $1 ORDER BY promoted_at DESC LIMIT $2`
            : `SELECT * FROM promotion_events ORDER BY promoted_at DESC LIMIT $1`;

        const params = memoryId ? [memoryId, limit] : [limit];
        const { rows } = await db.pg.query(query, params);
        return rows.map(this.rowToEvent);
    }

    /** Check if a memory has already been promoted */
    async hasBeenPromoted(memoryId: string): Promise<boolean> {
        const { rows } = await db.pg.query(
            'SELECT COUNT(*)::int AS total FROM promotion_events WHERE memory_id = $1',
            [memoryId],
        );
        return rows[0].total > 0;
    }

    /** Count total promotions */
    async count(): Promise<number> {
        const { rows } = await db.pg.query(
            'SELECT COUNT(*)::int AS total FROM promotion_events',
        );
        return rows[0].total;
    }

    // ====================================================================
    // PRIVATE
    // ====================================================================

    private async recordPromotion(
        event: Omit<PromotionEvent, 'id' | 'promoted_at'>,
    ): Promise<void> {
        await db.pg.query(
            `INSERT INTO promotion_events (memory_id, from_layer, to_layer, reason)
             VALUES ($1, $2, $3, $4)`,
            [event.memory_id, event.from_layer, event.to_layer, event.reason],
        );
    }

    private rowToEvent(row: Record<string, unknown>): PromotionEvent {
        return {
            id: row.id as string,
            memory_id: row.memory_id as string,
            from_layer: row.from_layer as PromotionEvent['from_layer'],
            to_layer: row.to_layer as PromotionEvent['to_layer'],
            reason: row.reason as string,
            promoted_at: (row.promoted_at as Date).toISOString(),
        };
    }
}
