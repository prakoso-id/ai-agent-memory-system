import { llm } from '../llm/llm-client.js';
import { config } from '../config/index.js';
import { WorkingMemory } from './working-memory.js';
import { EpisodicMemoryService } from './episodic-memory.js';
import { SemanticMemoryService } from './semantic-memory.js';
import { KnowledgeGraphService } from './knowledge-graph.js';
import { ReflectionMemoryService } from './reflection-memory.js';
import { StrategyMemoryService } from './strategy-memory.js';
import { FeedbackTracker } from './feedback-tracker.js';
import { ConflictDetector } from './conflict-detector.js';
import { ConfidenceScorer } from './confidence-scorer.js';
import { HypothesisManager } from './hypothesis-manager.js';
import { EvaluationTracker } from './evaluation-tracker.js';
import { MemoryPromoter } from './memory-promoter.js';
import { MemoryExtraction } from './memory-extraction.js';
import { MemoryConsolidation } from './memory-consolidation.js';
import { rerank } from './utils/reranker.js';
import { inferTaskType } from './utils/task-relevance.js';
// Phase 4
import { SemanticCache } from './semantic-cache.js';
import { RoleMemoryService } from './role-memory.js';
import { observabilityService } from './observability-service.js';
import type {
    ConversationMessage,
    RetrievedMemory,
    RetrievalQuery,
    MemoryQueryInput,
    MemoryScore,
    TaskType,
    RoleQueryInput,
    DashboardMetrics,
} from './types.js';

/**
 * Memory Manager â€” central orchestrator for the entire memory system.
 *
 * Manages the full memory lifecycle:
 *   interaction â†’ episodic â†’ extraction â†’ semantic + knowledge graph â†’ reflection â†’ consolidation
 *
 * Phase 1 additions:
 *   â€¢ query()     â€” unified, context-aware memory query API
 *   â€¢ retrieve()  â€” now accepts taskType for context-aware scoring
 *   â€¢ Multi-stage retrieval pipeline:
 *       1. Vector search (Qdrant)
 *       2. Optional source/tag filter
 *       3. Composite rerank (semantic Â· recency Â· importance Â· taskRelevance Â· popularity)
 *
 * Phase 2 additions:
 *   â€¢ FeedbackTracker  â€” adaptive scoring via retrieval feedback
 *   â€¢ StrategyMemory   â€” reusable pattern storage
 *   â€¢ Adaptive rerank  â€” weights shift based on accumulated feedback signal
 *
 * Phase 4 additions:
 *   â€¢ SemanticCache    â€” Redis-backed LLM call deduplication (Enhancement 3)
 *   â€¢ RoleMemoryService â€” role-scoped retrieval (Enhancement 2)
 *   â€¢ ObservabilityService â€” latency tracking, advisory generation (Enhancement 1)
 *   â€¢ cachedQuery()    â€” query() wrapped with semantic cache
 *   â€¢ roleQuery()      â€” role-scoped retrieval
 *   â€¢ getDashboardMetrics() â€” full metrics snapshot for dashboard
 *   â€¢ FIXED: confidenceBoosts now properly wired into rerank() (Phase 3 gap closed)
 */
export class MemoryManager {
    public working: WorkingMemory;
    public episodic: EpisodicMemoryService;
    public semantic: SemanticMemoryService;
    public knowledgeGraph: KnowledgeGraphService;
    public reflection: ReflectionMemoryService;
    public strategies: StrategyMemoryService;
    public feedback: FeedbackTracker;
    public extraction: MemoryExtraction;
    public consolidation: MemoryConsolidation;
    // Phase 3
    public conflicts: ConflictDetector;
    public confidence: ConfidenceScorer;
    public hypotheses: HypothesisManager;
    public evaluations: EvaluationTracker;
    public promoter: MemoryPromoter;
    // Phase 4
    public cache: SemanticCache;
    public roles: RoleMemoryService;
    public observability = observabilityService;

    private interactionCount = 0;

    constructor(sessionId?: string) {
        this.working = new WorkingMemory(sessionId);
        this.episodic = new EpisodicMemoryService();
        this.semantic = new SemanticMemoryService();
        this.knowledgeGraph = new KnowledgeGraphService();
        this.reflection = new ReflectionMemoryService();
        this.strategies = new StrategyMemoryService();
        this.feedback = new FeedbackTracker();
        this.extraction = new MemoryExtraction();
        this.consolidation = new MemoryConsolidation(this.episodic, this.semantic);
        // Phase 3
        this.conflicts = new ConflictDetector();
        this.confidence = new ConfidenceScorer(this.conflicts);
        this.hypotheses = new HypothesisManager();
        this.evaluations = new EvaluationTracker();
        this.promoter = new MemoryPromoter(this.episodic, this.semantic, this.knowledgeGraph);
        // Phase 4
        this.cache = new SemanticCache();
        this.roles = new RoleMemoryService();
    }

    // ====================================================================
    // UNIFIED QUERY API  (Phase 1)
    // ====================================================================

    /**
     * Unified memory query â€” the primary entry-point for agent memory access.
     *
     * Automatically:
     *   â€¢ Infers task type when not provided
     *   â€¢ Enriches the query with optional context
     *   â€¢ Runs the full multi-stage retrieval pipeline
     *
     * @example
     * const memories = await memory.query({
     *   task: 'fix TypeScript compilation error',
     *   context: 'tsconfig strict mode is enabled',
     *   limit: 5,
     * });
     */
    async query(input: MemoryQueryInput): Promise<RetrievedMemory[]> {
        const taskType: TaskType = input.taskType ?? inferTaskType(input.task);

        // Combine task + context into a richer query string
        const queryText = input.context
            ? `${input.task}\n\nContext: ${input.context}`
            : input.task;

        console.log(`  ðŸ§  memory.query() taskType="${taskType}" task="${input.task.substring(0, 60)}"`);

        return this.retrieve({
            query: queryText,
            taskType,
            limit: input.limit,
        });
    }

    // ====================================================================
    // Phase 4: CACHED QUERY + ROLE QUERY
    // ====================================================================

    /**
     * Semantic-cache-aware query (Phase 4 / Enhancement 3).
     *
     * Checks the semantic cache before invoking the full retrieval pipeline.
     * On a cache hit the serialised memory list is returned immediately â€”
     * no embedding or Qdrant call needed for the query itself.
     *
     * The cache stores the *serialised JSON* of the RetrievedMemory[] array so
     * that cached and live results share the same shape.
     *
     * @param input   Standard MemoryQueryInput
     * @param llmCall Optional LLM call to cache alongside the memory results.
     *                Pass null if you only want to cache retrieval, not generation.
     */
    async cachedQuery(
        input: MemoryQueryInput,
        llmCall?: () => Promise<string>,
    ): Promise<{ memories: RetrievedMemory[]; llmResponse?: string; cacheHit: boolean }> {
        const start = Date.now();
        const queryText = input.context ? `${input.task}\n\n${input.context}` : input.task;

        // Try cache first (only when an LLM call is involved)
        if (llmCall) {
            const hit = await this.cache.get(queryText);
            if (hit) {
                let memories: RetrievedMemory[] = [];
                let llmResponse: string = hit.response;

                // Response format: JSON prefix separated from natural-language by sentinel
                const sentinelIdx = hit.response.indexOf('\n---MEMORIES---\n');
                if (sentinelIdx !== -1) {
                    llmResponse  = hit.response.substring(0, sentinelIdx);
                    const memJson = hit.response.substring(sentinelIdx + 16);
                    try { memories = JSON.parse(memJson); } catch { /* use empty */ }
                }

                await this.observability.recordLatency({ queryId: queryText.substring(0, 40), latencyMs: Date.now() - start, source: 'cache' });
                this.observability.logEvent({ type: 'cache_hit', data: { similarity: hit.similarity, latencyMs: Date.now() - start } });

                return { memories, llmResponse, cacheHit: true };
            }
        }

        // Cache miss â€” run standard retrieval
        const memories = await this.query(input);
        let llmResponse: string | undefined;

        if (llmCall) {
            llmResponse = await llmCall();
            // Store combined payload so both memories and LLM response survive together
            const combined = `${llmResponse}\n---MEMORIES---\n${JSON.stringify(memories)}`;
            await this.cache.set(queryText, combined);
        }

        await this.observability.recordLatency({ queryId: queryText.substring(0, 40), latencyMs: Date.now() - start, source: 'retrieval' });
        this.observability.logEvent({ type: 'cache_miss', data: { latencyMs: Date.now() - start } });

        return { memories, llmResponse, cacheHit: false };
    }

    /**
     * Role-scoped retrieval (Phase 4 / Enhancement 2).
     *
     * Delegates to RoleMemoryService which applies:
     *   â€¢ Qdrant server-side role filter
     *   â€¢ Per-role importance weighting in the rerank step
     */
    async roleQuery(input: RoleQueryInput): Promise<RetrievedMemory[]> {
        const start = Date.now();
        this.observability.logEvent({ type: 'role_query', data: { role: input.agentRole, task: input.task.substring(0, 60) } });

        const results = await this.roles.query(input);

        await this.observability.recordLatency({
            queryId: input.task.substring(0, 40),
            latencyMs: Date.now() - start,
            source: 'retrieval',
        });

        return results;
    }

    // ====================================================================
    // MEMORY LIFECYCLE
    // ====================================================================

    /**
     * Process a complete interaction through the memory pipeline.
     * Call this after each user â†” agent exchange.
     * Each step has individual error handling so one failure doesn't block others.
     */
    async processInteraction(
        userMessage: string,
        assistantResponse: string,
        taskResult?: 'success' | 'failure' | 'partial',
    ): Promise<void> {
        this.interactionCount++;
        console.log(`  ðŸ“¥ Processing interaction #${this.interactionCount}...`);

        // 1. Store in working memory
        try {
            await this.working.addMessage('user', userMessage);
            await this.working.addMessage('assistant', assistantResponse);
            console.log('    âœ… [1/6] Working memory updated');
        } catch (err) {
            console.error('    âŒ [1/6] Working memory failed:', err);
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
                tags: [],
                metadata: { interactionNumber: this.interactionCount },
            });
            episodeId = episode.id;
            console.log(`    âœ… [2/6] Episodic memory stored (id: ${episodeId.substring(0, 8)}...)`);
        } catch (err) {
            console.error('    âŒ [2/6] Episodic memory failed:', err);
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
            console.log(
                `    âœ… [3/6] Extraction complete: ${extracted.facts.length} facts, ` +
                `${extracted.entities.length} entities, ${extracted.relationships.length} rels`,
            );
        } catch (err) {
            console.error('    âŒ [3/6] Knowledge extraction failed:', err);
        }

        // 4. Store extracted facts in semantic memory (filtered by importance + novelty)
        let storedFacts = 0;
        let skippedFacts = 0;
        try {
            for (const fact of extracted.facts) {
                const result = await this.semantic.store({
                    content: fact.content,
                    category: fact.category,
                    source: `episode:${episodeId}`,
                    importance: fact.importance,
                    tags: fact.tags ?? [fact.category],
                    metadata: { episodeId },
                });
                result ? storedFacts++ : skippedFacts++;
            }
            console.log(
                `    âœ… [4/6] Semantic memory: ${storedFacts} stored, ${skippedFacts} filtered`,
            );
        } catch (err) {
            console.error('    âŒ [4/6] Semantic memory storage failed:', err);
        }

        // 4b. Phase 3: Conflict detection on newly stored facts
        try {
            for (const fact of extracted.facts) {
                if (fact.importance < 0.15) continue; // skip low-importance
                const similar = await this.semantic.search(fact.content, {
                    limit: 5,
                    minScore: config.evolution.conflictSimilarityThreshold,
                });
                if (similar.length > 1) {
                    const newMem = similar.find((s) => s.content === fact.content) ?? similar[0]!;
                    const others = similar.filter((s) => s.id !== newMem.id);
                    const detected = await this.conflicts.detectConflicts(newMem, others);

                    // Create hypotheses for contradictory conflicts
                    for (const conflict of detected) {
                        if (conflict.conflict_type === 'contradictory') {
                            const memA = others.find((s) => s.id === conflict.memory_id_a);
                            if (memA) {
                                await this.hypotheses.createFromConflict(
                                    conflict,
                                    memA.content,
                                    newMem.content,
                                );
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error('    âŒ [4b] Conflict detection failed:', err);
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
                console.log(
                    `    âœ… [5/6] Knowledge graph: ${extracted.entities.length} nodes, ` +
                    `${extracted.relationships.length} edges`,
                );
            } else {
                console.log('    âšª [5/6] No graph updates');
            }
        } catch (err) {
            console.error('    âŒ [5/6] Knowledge graph update failed:', err);
        }

        // 6. Score the episode's importance using LLM
        try {
            const importance = await this.extraction.scoreImportance(
                `${userMessage} â†’ ${assistantResponse}`,
            );
            await this.episodic.updateImportance(episodeId, importance);
            console.log(`    âœ… [6/6] Importance scored: ${importance.toFixed(2)}`);
        } catch (err) {
            console.error('    âŒ [6/6] Importance scoring failed:', err);
        }

        // 7. Consolidation + Promotion (every 10 interactions)
        if (this.interactionCount % 10 === 0) {
            try {
                await this.consolidation.consolidate();
            } catch (err) {
                console.error('    âŒ Consolidation failed:', err);
            }

            // Phase 3: Run promotion cycle
            try {
                await this.promoter.runPromotionCycle();
            } catch (err) {
                console.error('    âŒ Promotion cycle failed:', err);
            }
        }

        console.log('  ðŸ“¥ Interaction processing complete.\n');
    }

    // ====================================================================
    // UNIFIED RETRIEVAL (multi-stage pipeline)
    // ====================================================================

    /**
     * Retrieve the most relevant memories across all layers.
     *
     * Stage 1 â€” vector search per layer (semantic / reflection / knowledge graph)
     * Stage 2 â€” optional source filter  (via query.filters.source)
     * Stage 3 â€” composite rerank        (semantic Â· recency Â· importance Â· taskRelevance Â· popularity)
     * Stage 4 â€” feedback boost          (Phase 2: per-memory helpfulness multiplier)
     */
    async retrieve(query: RetrievalQuery): Promise<RetrievedMemory[]> {
        const limit = query.limit ?? config.agent.memoryRetrievalLimit;
        const taskType: TaskType = query.taskType ?? 'general';
        const candidates: RetrievedMemory[] = [];

        // Stage 1 â€” collect candidates from all layers

        // 1a. Semantic search (primary vector source)
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
                    taskRelevance: 0,   // filled by reranker
                    totalScore: 0,      // filled by reranker
                };
                candidates.push({ memory: mem, source: 'semantic', score });
            }
        } catch (error) {
            console.error('Semantic retrieval failed:', error);
        }

        // 1b. Reflection memories
        try {
            const reflections = await this.reflection.getRelevant(query.query, 3);
            for (const ref of reflections) {
                const recency = this.calculateRecency(ref.timestamp);
                const score: MemoryScore = {
                    memoryId: ref.id,
                    semanticSimilarity: 0.6,
                    recency,
                    importance: ref.importance,
                    taskRelevance: 0,
                    totalScore: 0,
                };
                candidates.push({ memory: ref, source: 'reflection', score });
            }
        } catch (error) {
            console.error('Reflection retrieval failed:', error);
        }

        // 1c. Knowledge graph context
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
                        taskRelevance: 0,
                        totalScore: 0,
                    };
                    candidates.push({
                        memory: {
                            id: node.id,
                            content: graphContext,
                            timestamp: node.createdAt,
                            importance: 0.7,
                            usage_count: 0,
                            last_accessed: node.updatedAt,
                            tags: ['knowledge_graph', node.label?.toLowerCase() ?? ''],
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

        // Phase 2 â€” fetch adaptive weights and per-memory boosts
        let feedbackBoosts: Map<string, number> | undefined;
        let adaptiveWeights;

        try {
            const memoryIds = candidates.map((c) => c.score.memoryId);
            [feedbackBoosts, adaptiveWeights] = await Promise.all([
                this.feedback.getBoosts(memoryIds),
                this.feedback.getAdaptiveWeights(),
            ]);
        } catch (error) {
            console.error('Feedback retrieval failed (using defaults):', error);
        }

        // Phase 3 fix â€” build confidence boosts map so scores reflect memory reliability
        let confidenceBoosts: Map<string, number> | undefined;
        try {
            const semanticCandidates = candidates.filter((c) => c.source === 'semantic');
            if (semanticCandidates.length > 0) {
                confidenceBoosts = new Map<string, number>();
                await Promise.all(
                    semanticCandidates.map(async (c) => {
                        const score = await this.confidence.computeConfidence(
                            c.memory.id,
                            c.memory.usage_count,
                            (c.memory.source as string) ?? 'unknown',
                            c.memory.timestamp,
                        );
                        confidenceBoosts!.set(c.score.memoryId, score.overall);
                    }),
                );
            }
        } catch (error) {
            console.error('Confidence scoring failed (skipping boosts):', error);
        }

        // Stages 2, 3, 4 â€” filter + composite rerank + feedback boost + confidence boost
        return rerank(candidates, {
            taskType,
            sourceFilter: query.filters?.source,
            limit,
            adaptiveWeights,
            feedbackBoosts,
            confidenceBoosts,   // Phase 3 gap now closed
        });
    }

    // ====================================================================
    // FEEDBACK (Phase 2)
    // ====================================================================

    /**
     * Record retrieval feedback for a set of memories.
     * Call after each interaction with the results of which memories were used.
     */
    async recordFeedback(
        query: string,
        results: Array<{ memory_id: string; used: boolean; helpful: boolean }>,
    ): Promise<void> {
        try {
            await this.feedback.recordBatch(query, results);
        } catch (error) {
            console.error('Feedback recording failed:', error);
        }
    }

    // ====================================================================
    // STATS
    // ====================================================================

    async getStats(): Promise<Record<string, number>> {
        const [episodicCount, semanticCount, reflectionCount, graphNodeCount, strategyCount,
               conflictCount, evaluationCount, promotionCount, hypothesisCount] =
            await Promise.all([
                this.episodic.count(),
                this.semantic.count(),
                this.reflection.count(),
                this.knowledgeGraph.nodeCount(),
                this.strategies.count(),
                this.conflicts.count(),
                this.evaluations.count(),
                this.promoter.count(),
                this.hypotheses.count(),
            ]);

        return {
            episodic: episodicCount,
            semantic: semanticCount,
            reflections: reflectionCount,
            graphNodes: graphNodeCount,
            strategies: strategyCount,
            conflicts: conflictCount,
            evaluations: evaluationCount,
            promotions: promotionCount,
            hypotheses: hypothesisCount,
            interactions: this.interactionCount,
        };
    }

    // ====================================================================
    // Phase 4: OBSERVABILITY METRICS
    // ====================================================================

    /**
     * Return the full Phase 4 metrics snapshot for the dashboard.
     * Aggregates cache stats, latency, conflict frequency, promotion rate,
     * and role distribution into a single payload.
     */
    async getDashboardMetrics(): Promise<DashboardMetrics> {
        const [stats, cacheStats, roleDistribution] = await Promise.all([
            this.getStats(),
            this.cache.getStats(),
            this.roles.getRoleDistribution(),
        ]);

        return this.observability.getMetrics({
            conflictCount:    stats.conflicts,
            semanticCount:    stats.semantic,
            promotionCount:   stats.promotions,
            episodicCount:    stats.episodic,
            roleDistribution,
            cacheEntries:     cacheStats.totalEntries,
        });
    }

    /**
     * Return self-healing improvement advisories based on current metrics.
     */
    async getAdvisories(): Promise<string[]> {
        const metrics = await this.getDashboardMetrics();
        return this.observability.generateAdvisories(metrics);
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    /** Calculate recency score (1.0 = now, exponential decay, ~48h half-life) */
    private calculateRecency(timestamp: string): number {
        const ageMs = Date.now() - new Date(timestamp).getTime();
        const ageHours = ageMs / (1000 * 60 * 60);
        return Math.exp(-0.014 * ageHours);
    }
}
