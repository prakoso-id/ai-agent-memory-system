import { llm } from '../llm/llm-client.js';
import { config } from '../config/index.js';
import { WorkingMemory } from './working-memory.js';
import { EpisodicMemoryService } from './episodic-memory.js';
import { SemanticMemoryService } from './semantic-memory.js';
import { KnowledgeGraphService } from './knowledge-graph.js';
import { ReflectionMemoryService } from './reflection-memory.js';
import { MemoryExtraction } from './memory-extraction.js';
import { MemoryConsolidation } from './memory-consolidation.js';
import type {
    ConversationMessage,
    RetrievedMemory,
    RetrievalQuery,
    MemoryScore,
} from './types.js';

/**
 * Memory Manager — central orchestrator for the entire memory system.
 *
 * Manages the full memory lifecycle:
 *   interaction → episodic → extraction → semantic + knowledge graph → reflection → consolidation
 *
 * Provides unified retrieval with weighted scoring:
 *   score = 0.4 × semantic_similarity + 0.3 × recency + 0.3 × importance
 */
export class MemoryManager {
    public working: WorkingMemory;
    public episodic: EpisodicMemoryService;
    public semantic: SemanticMemoryService;
    public knowledgeGraph: KnowledgeGraphService;
    public reflection: ReflectionMemoryService;
    public extraction: MemoryExtraction;
    public consolidation: MemoryConsolidation;

    private interactionCount = 0;

    constructor(sessionId?: string) {
        this.working = new WorkingMemory(sessionId);
        this.episodic = new EpisodicMemoryService();
        this.semantic = new SemanticMemoryService();
        this.knowledgeGraph = new KnowledgeGraphService();
        this.reflection = new ReflectionMemoryService();
        this.extraction = new MemoryExtraction();
        this.consolidation = new MemoryConsolidation(this.episodic, this.semantic);
    }

    // ====================================================================
    // MEMORY LIFECYCLE
    // ====================================================================

    /**
     * Process a complete interaction through the memory pipeline.
     * Call this after each user ↔ agent exchange.
     * Each step has individual error handling so one failure doesn't block others.
     */
    async processInteraction(
        userMessage: string,
        assistantResponse: string,
        taskResult?: 'success' | 'failure' | 'partial',
    ): Promise<void> {
        this.interactionCount++;
        console.log(`  📥 Processing interaction #${this.interactionCount}...`);

        // 1. Store in working memory
        try {
            await this.working.addMessage('user', userMessage);
            await this.working.addMessage('assistant', assistantResponse);
            console.log('    ✅ [1/6] Working memory updated');
        } catch (err) {
            console.error('    ❌ [1/6] Working memory failed:', err);
        }

        // 2. Store as episodic memory
        let episodeId = 'unknown';
        try {
            const episode = await this.episodic.store({
                eventType: 'conversation',
                sessionId: this.working.getSessionId(),
                content: `User: ${userMessage}\nAssistant: ${assistantResponse}`,
                result: taskResult,
                importance: 0.5,
                metadata: { interactionNumber: this.interactionCount },
            });
            episodeId = episode.id;
            console.log(`    ✅ [2/6] Episodic memory stored (id: ${episodeId.substring(0, 8)}...)`);
        } catch (err) {
            console.error('    ❌ [2/6] Episodic memory failed:', err);
        }

        // 3. Extract knowledge via LLM
        let extracted: { facts: any[]; entities: any[]; relationships: any[] } = {
            facts: [], entities: [], relationships: [],
        };
        try {
            const messages: ConversationMessage[] = [
                { role: 'user', content: userMessage, timestamp: new Date().toISOString() },
                { role: 'assistant', content: assistantResponse, timestamp: new Date().toISOString() },
            ];
            extracted = await this.extraction.extract(messages);
            console.log(`    ✅ [3/6] Extraction complete: ${extracted.facts.length} facts, ${extracted.entities.length} entities, ${extracted.relationships.length} relationships`);
        } catch (err) {
            console.error('    ❌ [3/6] Knowledge extraction failed:', err);
        }

        // 4. Store extracted facts in semantic memory (Qdrant)
        try {
            for (const fact of extracted.facts) {
                await this.semantic.store({
                    content: fact.content,
                    category: fact.category,
                    source: `episode:${episodeId}`,
                    importance: fact.importance,
                    metadata: { episodeId },
                });
            }
            if (extracted.facts.length > 0) {
                console.log(`    ✅ [4/6] ${extracted.facts.length} facts stored in semantic memory`);
            } else {
                console.log('    ⚪ [4/6] No facts to store in semantic memory');
            }
        } catch (err) {
            console.error('    ❌ [4/6] Semantic memory storage failed:', err);
        }

        // 5. Store entities and relationships in knowledge graph (Neo4j)
        try {
            for (const entity of extracted.entities) {
                await this.knowledgeGraph.addNode({
                    name: entity.name,
                    label: entity.label,
                    properties: entity.properties,
                });
            }
            for (const rel of extracted.relationships) {
                await this.knowledgeGraph.addEdge({
                    sourceId: rel.source,
                    targetId: rel.target,
                    relationship: rel.relationship,
                    properties: {},
                    weight: 1,
                });
            }
            if (extracted.entities.length > 0 || extracted.relationships.length > 0) {
                console.log(`    ✅ [5/6] Knowledge graph updated (${extracted.entities.length} nodes, ${extracted.relationships.length} edges)`);
            } else {
                console.log('    ⚪ [5/6] No graph updates');
            }
        } catch (err) {
            console.error('    ❌ [5/6] Knowledge graph update failed:', err);
        }

        // 6. Score the episode's importance using LLM
        try {
            const importance = await this.extraction.scoreImportance(
                `${userMessage} → ${assistantResponse}`,
            );
            await this.episodic.updateImportance(episodeId, importance);
            console.log(`    ✅ [6/6] Importance scored: ${importance.toFixed(2)}`);
        } catch (err) {
            console.error('    ❌ [6/6] Importance scoring failed:', err);
        }

        // 7. Consolidation (every 10 interactions)
        if (this.interactionCount % 10 === 0) {
            try {
                await this.consolidation.consolidate();
            } catch (err) {
                console.error('    ❌ Consolidation failed:', err);
            }
        }

        console.log('  📥 Interaction processing complete.\n');
    }

    // ====================================================================
    // UNIFIED RETRIEVAL
    // ====================================================================

    /**
     * Retrieve the most relevant memories across all layers.
     * Uses weighted scoring: 0.4 similarity + 0.3 recency + 0.3 importance
     */
    async retrieve(query: RetrievalQuery): Promise<RetrievedMemory[]> {
        const limit = query.limit ?? config.agent.memoryRetrievalLimit;
        const results: RetrievedMemory[] = [];

        // 1. Semantic search (main source)
        try {
            const semanticResults = await this.semantic.search(query.query, {
                limit: limit * 2,
                minScore: query.minScore ?? 0.05,
                category: query.filters?.category,
            });

            for (const mem of semanticResults) {
                const recency = this.calculateRecency(mem.timestamp);
                const score: MemoryScore = {
                    memoryId: mem.id,
                    semanticSimilarity: mem.score,
                    recency,
                    importance: mem.importance,
                    totalScore: 0.4 * mem.score + 0.3 * recency + 0.3 * mem.importance,
                };
                results.push({ memory: mem, source: 'semantic', score });
            }
        } catch (error) {
            console.error('Semantic retrieval failed:', error);
        }

        // 2. Reflection memories
        try {
            const reflections = await this.reflection.getRelevant(query.query, 3);
            for (const ref of reflections) {
                const recency = this.calculateRecency(ref.timestamp);
                const similarity = 0.6; // approximate for text-match based retrieval
                const score: MemoryScore = {
                    memoryId: ref.id,
                    semanticSimilarity: similarity,
                    recency,
                    importance: ref.importance,
                    totalScore: 0.4 * similarity + 0.3 * recency + 0.3 * ref.importance,
                };
                results.push({ memory: ref, source: 'reflection', score });
            }
        } catch (error) {
            console.error('Reflection retrieval failed:', error);
        }

        // 3. Knowledge graph context
        try {
            const nodes = await this.knowledgeGraph.query(query.query);
            for (const node of nodes.slice(0, 3)) {
                const related = await this.knowledgeGraph.getRelated(node.name);
                const graphContext = related
                    .map((r) => `${node.name} ${r.edge.relationship} ${r.node.name}`)
                    .join('. ');

                if (graphContext) {
                    const recency = this.calculateRecency(node.createdAt);
                    const score: MemoryScore = {
                        memoryId: node.id,
                        semanticSimilarity: 0.5,
                        recency,
                        importance: 0.7,
                        totalScore: 0.4 * 0.5 + 0.3 * recency + 0.3 * 0.7,
                    };
                    results.push({
                        memory: {
                            id: node.id,
                            content: graphContext,
                            timestamp: node.createdAt,
                            importance: 0.7,
                            metadata: { type: 'knowledge_graph', nodeName: node.name },
                        },
                        source: 'knowledge_graph',
                        score,
                    });
                }
            }
        } catch (error) {
            console.error('Knowledge graph retrieval failed:', error);
        }

        // Sort by total score and return top-k
        results.sort((a, b) => b.score.totalScore - a.score.totalScore);
        return results.slice(0, limit);
    }

    // ====================================================================
    // STATS
    // ====================================================================

    async getStats(): Promise<Record<string, number>> {
        const [episodicCount, semanticCount, reflectionCount, graphNodeCount] =
            await Promise.all([
                this.episodic.count(),
                this.semantic.count(),
                this.reflection.count(),
                this.knowledgeGraph.nodeCount(),
            ]);

        return {
            episodic: episodicCount,
            semantic: semanticCount,
            reflections: reflectionCount,
            graphNodes: graphNodeCount,
            interactions: this.interactionCount,
        };
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    /** Calculate recency score (1.0 = now, decays over hours) */
    private calculateRecency(timestamp: string): number {
        const ageMs = Date.now() - new Date(timestamp).getTime();
        const ageHours = ageMs / (1000 * 60 * 60);
        // Exponential decay: half-life of ~48 hours
        return Math.exp(-0.014 * ageHours);
    }
}
