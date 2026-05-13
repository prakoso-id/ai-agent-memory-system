// ============================================================
// AI Agent Memory System â€” Public Contract (v1.0.0)
// ============================================================
//
// This file defines the complete public interface for the
// AI Agent Memory System. Other projects can depend on this
// file to integrate with the memory system â€” either by
// importing types when embedding the library directly, or by
// using these types to construct valid HTTP requests/responses
// when communicating via the REST API.
//
// ============================================================
// USAGE
// ============================================================
//
// Option A â€” Embed the library in a TypeScript/Bun project:
//
//   import { MemoryManager } from 'ai-agent-memory-system';
//   const memory = new MemoryManager(sessionId);
//   const results = await memory.query({ task: 'fix TS error' });
//
// Option B â€” Communicate via REST API (any language):
//
//   POST http://localhost:3001/api/memory/query
//   Authorization: Bearer <API_KEY>
//   Content-Type: application/json
//   Body: { session_id, task, context?, task_type?, limit? }
//
// ============================================================

// ============================================================
// SECTION 1: CORE DATA TYPES
// ============================================================

/** Task context types â€” drives context-aware retrieval scoring */
export type TaskType = 'coding' | 'chat' | 'planning' | 'analysis' | 'general' | 'dnd';

/** Base memory record shared across all memory layers */
export interface BaseMemory {
    id: string;
    content: string;
    timestamp: string;        // ISO 8601
    importance: number;       // 0.0 â€“ 1.0
    usage_count: number;      // incremented on each retrieval or duplicate write
    last_accessed: string;    // ISO 8601 â€” updated on each retrieval
    tags?: string[];          // free-form classification tags (defaults to [])
    source?: string;          // origin: 'episode:<id>', 'api', 'reflection', etc.
    metadata: Record<string, unknown>;
}

// ---- Memory Layer Types ----

export type EventType = 'conversation' | 'task_execution' | 'error' | 'reflection' | 'system';

export interface EpisodicMemory extends BaseMemory {
    eventType: EventType;
    sessionId: string;
    task?: string;
    result?: 'success' | 'failure' | 'partial';
    context?: string;
}

export interface SemanticMemory extends BaseMemory {
    category: string;        // e.g. "user_preference", "project_fact", "general_knowledge"
    source: string;          // required for semantic: where the knowledge came from
    embedding?: number[];    // vector embedding
}

export interface ReflectionMemory extends BaseMemory {
    observation: string;
    rootCause: string;
    lessonLearned: string;
    strategyImprovement: string;
    relatedEpisodeIds: string[];
}

export interface KnowledgeNode {
    id: string;
    label: string;           // entity type e.g. "User", "Project", "Technology"
    name: string;
    properties: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface KnowledgeEdge {
    id: string;
    sourceId: string;
    targetId: string;
    relationship: string;    // e.g. "works_on", "uses", "prefers"
    properties: Record<string, unknown>;
    weight: number;
    createdAt: string;
}

// ---- Conversation / Working Memory ----

export interface ConversationMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export interface WorkingMemoryState {
    sessionId: string;
    messages: ConversationMessage[];
    activeContext: Record<string, unknown>;
}

// ---- Retrieval & Scoring ----

export interface MemoryScore {
    memoryId: string;
    semanticSimilarity: number;
    recency: number;
    importance: number;
    taskRelevance: number;   // 0.0 â€“ 1.0 based on tag overlap with task type
    totalScore: number;
}

export interface RetrievalQuery {
    query: string;
    taskType?: TaskType;
    limit?: number;
    minScore?: number;
    filters?: {
        eventType?: EventType;
        category?: string;
        sessionId?: string;
        timeRange?: { from?: string; to?: string };
        tags?: string[];
        source?: Array<'episodic' | 'semantic' | 'reflection' | 'knowledge_graph'>;
    };
}

export interface RetrievedMemory {
    memory: BaseMemory;
    source: 'episodic' | 'semantic' | 'reflection' | 'knowledge_graph';
    score: MemoryScore;
}

// ---- Unified Query Input ----

export interface MemoryQueryInput {
    /** What the agent is currently trying to do */
    task: string;
    /** Free-form context text that enriches the query (e.g. recent conversation) */
    context?: string;
    /** Explicit task type; inferred from `task` if omitted */
    taskType?: TaskType;
    /** Maximum number of results to return (default: system config limit) */
    limit?: number;
}

// ---- Memory Lifecycle ----

export interface ExtractionResult {
    facts: Array<{ content: string; category: string; importance: number; tags?: string[] }>;
    entities: Array<{ name: string; label: string; properties: Record<string, unknown> }>;
    relationships: Array<{ source: string; target: string; relationship: string }>;
}

export interface ConsolidationResult {
    summarized: number;
    decayed: number;
    merged: number;
}

// ---- Adaptive Weights ----

export interface AdaptiveWeights {
    semanticSimilarity: number;
    recency: number;
    importance: number;
    taskRelevance: number;
    usagePopularity: number;
}

// ============================================================
// SECTION 2: PHASE 2 â€” ADAPTIVE LEARNING & CONTEXT OPTIMIZATION
// ============================================================

export interface RetrievalFeedback {
    memory_id: string;
    query: string;
    used: boolean;
    helpful: boolean;
    timestamp: string;
}

export interface StrategyMemory {
    id: string;
    pattern: string;
    evidence: string;
    effectiveness: number;   // 0.0 â€“ 1.0
    domain: string;
    usage_count: number;
    last_validated: string;
    created_at: string;
    metadata: Record<string, unknown>;
}

export interface BehavioralDirective {
    id: string;
    type: 'retrieval_bias' | 'prompt_style' | 'content_preference';
    directive: string;
    weight: number;          // 0.0 â€“ 1.0
    source_reflection_id: string;
    active: boolean;
    created_at: string;
}

export type CompressionTier = 'raw' | 'summary' | 'insight';

export interface CompressedMemory {
    memory: RetrievedMemory;
    tier: CompressionTier;
    compressedContent: string;
    originalTokens: number;
    compressedTokens: number;
}

export interface ContextBuilderOptions {
    query: string;
    max_tokens: number;
    priority: Array<'recent' | 'important' | 'relevant'>;
    taskType?: TaskType;
    include_strategies?: boolean;
    include_directives?: boolean;
}

export interface BuiltContext {
    memories: CompressedMemory[];
    strategies: StrategyMemory[];
    directives: BehavioralDirective[];
    totalTokens: number;
    compressionApplied: boolean;
}

// ============================================================
// SECTION 3: PHASE 3 â€” MEMORY EVOLUTION & EVALUATION
// ============================================================

export type ConflictStatus = 'none' | 'detected' | 'hypothesis' | 'resolved' | 'superseded';

export interface MemoryConflict {
    id: string;
    memory_id_a: string;
    memory_id_b: string;
    conflict_type: 'contradictory' | 'outdated' | 'ambiguous';
    description: string;
    status: ConflictStatus;
    resolution?: string;
    detected_at: string;
    resolved_at?: string;
}

export interface ConfidenceScore {
    overall: number;
    usage_signal: number;
    consistency_signal: number;
    source_reliability: number;
    recency_signal: number;
}

export interface Hypothesis {
    id: string;
    topic: string;
    perspectives: HypothesisPerspective[];
    status: 'open' | 'leaning' | 'resolved';
    resolution?: string;
    created_at: string;
    updated_at: string;
}

export interface HypothesisPerspective {
    memory_id: string;
    stance: string;
    confidence: number;
    evidence_count: number;
}

export interface EvaluationRecord {
    id: string;
    query_id: string;
    query_text: string;
    retrieved_memory_ids: string[];
    success: boolean;
    hit_rate: number;
    response_quality?: number;
    created_at: string;
}

export interface EvaluationMetrics {
    total_queries: number;
    avg_hit_rate: number;
    avg_usefulness: number;
    retrieval_success_rate: number;
    period_start: string;
    period_end: string;
}

export interface PromotionEvent {
    id: string;
    memory_id: string;
    from_layer: 'episodic' | 'semantic';
    to_layer: 'semantic' | 'knowledge_graph';
    reason: string;
    promoted_at: string;
}

// ============================================================
// SECTION 4: PHASE 4 â€” OBSERVABILITY, SCALABILITY & EFFICIENCY
// ============================================================

export type AgentRole = 'coder' | 'pm' | 'qa' | 'analyst' | 'general';

export type RoleImportanceMap = Partial<Record<AgentRole, number>>;

export interface RoleMemoryExtension {
    roles: AgentRole[];
    importance_per_role: RoleImportanceMap;
}

export interface RoleAwareMemory extends SemanticMemory, RoleMemoryExtension {}

export interface RoleQueryInput extends MemoryQueryInput {
    agentRole: AgentRole;
    roleWeight?: number;
}

export interface SemanticCacheEntry {
    queryHash: string;
    embedding: number[];
    response: string;
    queryText: string;
    createdAt: string;
    hitCount: number;
}

export interface CacheHit {
    response: string;
    similarity: number;
    entryId: string;
}

export interface SemanticCacheStats {
    totalEntries: number;
    hitRate: number;
    totalHits: number;
    totalMisses: number;
    avgSimilarityOnHit: number;
}

export interface DashboardMetrics {
    cacheHitRate: number;
    cacheEntries: number;
    avgRetrievalLatencyMs: number;
    conflictFrequency: number;
    promotionRate: number;
    roleDistribution: Partial<Record<AgentRole, number>>;
}

export interface LatencySample {
    queryId: string;
    latencyMs: number;
    source: 'cache' | 'retrieval';
    timestamp: string;
}

// ---- Dashboard Types ----

export interface DashboardGraphNode {
    id: string;
    label: string;
    name: string;
    confidence?: number;
    roles?: AgentRole[];
    conflictStatus?: ConflictStatus;
    importance: number;
    usageCount: number;
    timestamp: string;
}

export interface DashboardGraphEdge {
    id: string;
    source: string;
    target: string;
    relationship: string;
    weight: number;
}

export interface DashboardGraph {
    nodes: DashboardGraphNode[];
    edges: DashboardGraphEdge[];
}

export interface DashboardMemory {
    id: string;
    content: string;
    category: string;
    source: string;
    importance: number;
    confidence: number;
    usageCount: number;
    tags: string[];
    roles: AgentRole[];
    conflictStatus: ConflictStatus;
    archived: boolean;
    timestamp: string;
    lastAccessed: string;
}

export interface MemoryListFilter {
    topic?: string;
    minConfidence?: number;
    maxConfidence?: number;
    conflictStatus?: ConflictStatus;
    agentRole?: AgentRole;
    archived?: boolean;
    limit?: number;
    offset?: number;
}

// ============================================================
// SECTION 5: SERVICE INTERFACES (Programmatic API)
// ============================================================

// --- Memory Statistics ---

export interface MemoryStats extends Record<string, number> {
    episodic: number;
    semantic: number;
    reflections: number;
    graphNodes: number;
    strategies: number;
    conflicts: number;
    evaluations: number;
    promotions: number;
    hypotheses: number;
    interactions: number;
}

// --- IMemoryManager: Full contract for the central orchestrator ---

export interface IMemoryManager {
    // ==========================
    // QUERY API
    // ==========================

    /** Unified memory query â€” primary entry point for agent memory access */
    query(input: MemoryQueryInput): Promise<RetrievedMemory[]>;

    /** Multi-stage retrieval pipeline (lower-level) */
    retrieve(query: RetrievalQuery): Promise<RetrievedMemory[]>;

    /** Semantic-cache-aware query (Phase 4) â€” checks cache before retrieval */
    cachedQuery(
        input: MemoryQueryInput,
        llmCall?: () => Promise<string>,
    ): Promise<{ memories: RetrievedMemory[]; llmResponse?: string; cacheHit: boolean }>;

    /** Role-scoped retrieval (Phase 4) â€” filters by agent role */
    roleQuery(input: RoleQueryInput): Promise<RetrievedMemory[]>;

    // ==========================
    // MEMORY LIFECYCLE
    // ==========================

    /** Process a complete interaction through the memory pipeline */
    processInteraction(
        userMessage: string,
        assistantResponse: string,
        taskResult?: 'success' | 'failure' | 'partial',
    ): Promise<void>;

    // ==========================
    // FEEDBACK
    // ==========================

    /** Record retrieval feedback for a set of memories */
    recordFeedback(
        query: string,
        results: Array<{ memory_id: string; used: boolean; helpful: boolean }>,
    ): Promise<void>;

    // ==========================
    // STATS & OBSERVABILITY
    // ==========================

    /** Get memory counts per layer */
    getStats(): Promise<MemoryStats>;

    /** Get full Phase 4 metrics snapshot */
    getDashboardMetrics(): Promise<DashboardMetrics>;

    /** Get self-healing improvement advisories */
    getAdvisories(): Promise<string[]>;
}

// --- IAgentController: High-level orchestration contract ---

export interface IAgentController {
    /** Process a user message and return the agent's response (non-streaming) */
    chat(userMessage: string): Promise<string>;

    /** Stream a chat response with context metadata */
    chatStream(userMessage: string): AsyncGenerator<
        | { type: 'context'; memoryCount: number; strategyCount: number; directiveCount: number; compressed: boolean }
        | { type: 'token'; content: string }
        | { type: 'done'; fullResponse: string }
    >;

    /** Get memory system statistics */
    getStats(): Promise<MemoryStats>;

    /** Force a memory consolidation cycle */
    consolidate(): Promise<void>;

    /** Record feedback on retrieved memories */
    recordFeedback(
        query: string,
        feedback: Array<{ memory_id: string; used: boolean; helpful: boolean }>,
    ): Promise<void>;

    /** Get the underlying memory manager for direct API access */
    getMemoryManager(): IMemoryManager;

    /** Get the context builder for direct API access */
    getContextBuilder(): IContextBuilder;
}

// --- ISessionManager: Multi-agent session pool contract ---

export interface ISessionManager {
    /** Create a new session, optionally with a specific ID */
    createSession(sessionId?: string): { agent: IAgentController; sessionId: string };

    /** Get an existing session, or create one if it doesn't exist */
    getOrCreate(sessionId?: string): { agent: IAgentController; sessionId: string };

    /** Get an existing session */
    getSession(sessionId: string): IAgentController | undefined;

    /** List all active sessions */
    listSessions(): SessionInfo[];

    /** Delete a session */
    deleteSession(sessionId: string): boolean;

    /** Track an interaction for a session */
    trackInteraction(sessionId: string): void;
}

export interface SessionInfo {
    sessionId: string;
    createdAt: string;
    lastActivity: string;
    interactionCount: number;
}

// --- IContextBuilder: Token-aware context assembly contract ---

export interface IContextBuilder {
    /** Build a token-budgeted context for the agent */
    buildContext(options: ContextBuilderOptions): Promise<BuiltContext>;
}

// ============================================================
// SECTION 6: REST API CONTRACT
// ============================================================

// --- Base ---
export const REST_API_BASE = 'http://localhost:3001';
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type AuthHeader = { Authorization: string }; // "Bearer <API_KEY>"

// --- Health ---

export interface HealthResponse {
    status: 'ok';
    uptime: number;
    timestamp: string;
}

// --- Sessions ---

export interface CreateSessionRequest {
    session_id?: string;
}

export interface CreateSessionResponse {
    session_id: string;
    created_at: string;
}

export interface SessionListResponse {
    sessions: SessionInfo[];
}

export interface SessionDetailResponse {
    session: SessionInfo;
    stats: MemoryStats;
}

// --- Chat ---

export interface ChatRequest {
    session_id: string;
    message: string;
}

/** SSE stream event types emitted during streaming chat */
export type ChatStreamEvent =
    | { type: 'context'; memoryCount: number; strategyCount: number; directiveCount: number; compressed: boolean }
    | { type: 'token'; content: string }
    | { type: 'done'; fullResponse: string };

// --- Memory ---

export interface StoreMemoryRequest {
    session_id: string;
    content: string;
    category?: string;
    importance?: number;
    tags?: string[];
}

export interface StoreMemoryResponse {
    id: string;
    content: string;
    category: string;
    importance: number;
    timestamp: string;
}

export interface SearchMemoryRequest {
    session_id: string;
    query: string;
    limit?: number;
    min_score?: number;
    task_type?: TaskType;
}

export interface SearchMemoryResponse {
    results: RetrievedMemory[];
}

export interface MemoryQueryRequest {
    session_id: string;
    task: string;
    context?: string;
    task_type?: TaskType;
    limit?: number;
}

export interface MemoryQueryResponse {
    results: RetrievedMemory[];
}

export interface MemoryStatsRequest {
    session_id: string;
}

export interface MemoryStatsResponse {
    stats: MemoryStats;
}

export interface GraphQueryRequest {
    session_id: string;
    q?: string;
}

export interface GraphQueryResponse {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
}

// --- Phase 4 Observability ---

export interface DashboardMetricsResponse {
    metrics: DashboardMetrics;
}

export interface DashboardAdvisoriesResponse {
    advisories: string[];
}

export interface DashboardGraphQueryParams {
    q?: string;
    limit?: number;
}

export interface DashboardGraphResponse {
    graph: DashboardGraph;
}

export interface DashboardMemoryListParams extends MemoryListFilter {}

export interface DashboardMemoryListResponse {
    memories: DashboardMemory[];
    total: number;
}

export interface DashboardMemoryUpdateRequest {
    importance?: number;
    archive?: boolean;
    role_weight?: RoleImportanceMap;
}

export interface DashboardMemoryUpdateResponse {
    id: string;
    updated: boolean;
}

export interface DashboardCacheStatsResponse {
    stats: SemanticCacheStats;
}

export interface DashboardCacheInvalidateResponse {
    flushed: boolean;
}

export interface DashboardRoleMemoriesParams {
    session_id: string;
    limit?: number;
}

export interface DashboardRoleMemoriesResponse {
    role: AgentRole;
    memories: RoleAwareMemory[];
}

// ============================================================
// SECTION 7: REST API ENDPOINT MAP
// ============================================================

/**
 * Complete REST API endpoint map for the memory system.
 *
 * Base URL: http://localhost:3001
 * Auth:     Authorization: Bearer <API_KEY>  (except /api/health)
 */
export const REST_API = {
    health: {
        method: 'GET',
        path: '/api/health',
        auth: false,
        response: {} as HealthResponse,
    },

    // Sessions
    sessions: {
        create:  { method: 'POST',   path: '/api/sessions',                body: {} as CreateSessionRequest,    response: {} as CreateSessionResponse },
        list:    { method: 'GET',    path: '/api/sessions',                                                     response: {} as SessionListResponse },
        get:     { method: 'GET',    path: '/api/sessions/:id',                                                 response: {} as SessionDetailResponse },
        delete:  { method: 'DELETE', path: '/api/sessions/:id',                                                 response: {} as { deleted: boolean } },
    },

    // Chat
    chat: {
        stream:  { method: 'POST', path: '/api/chat',      body: {} as ChatRequest, response: 'SSE stream of ChatStreamEvent' as const },
        sync:    { method: 'POST', path: '/api/chat/sync',  body: {} as ChatRequest, response: {} as { response: string } },
    },

    // Memory
    memory: {
        store:   { method: 'POST', path: '/api/memory/store',  body: {} as StoreMemoryRequest,   response: {} as StoreMemoryResponse },
        search:  { method: 'POST', path: '/api/memory/search', body: {} as SearchMemoryRequest,  response: {} as SearchMemoryResponse },
        query:   { method: 'POST', path: '/api/memory/query',  body: {} as MemoryQueryRequest,   response: {} as MemoryQueryResponse },
        stats:   { method: 'GET',  path: '/api/memory/stats',  query: {} as MemoryStatsRequest,  response: {} as MemoryStatsResponse },
        graph:   { method: 'GET',  path: '/api/memory/graph',  query: {} as GraphQueryRequest,   response: {} as GraphQueryResponse },
    },

    // Phase 4 Observability
    dashboard: {
        metrics:     { method: 'GET',    path: '/api/dashboard/metrics',                                       response: {} as DashboardMetricsResponse },
        advisories:  { method: 'GET',    path: '/api/dashboard/advisories',                                    response: {} as DashboardAdvisoriesResponse },
        graph:       { method: 'GET',    path: '/api/dashboard/graph',          query: {} as DashboardGraphQueryParams,     response: {} as DashboardGraphResponse },
        memories:    { method: 'GET',    path: '/api/dashboard/memories',       query: {} as DashboardMemoryListParams,    response: {} as DashboardMemoryListResponse },
        updateMemory:{ method: 'PATCH',  path: '/api/dashboard/memories/:id',   body: {} as DashboardMemoryUpdateRequest,  response: {} as DashboardMemoryUpdateResponse },
        deleteMemory:{ method: 'DELETE', path: '/api/dashboard/memories/:id',                                         response: {} as { deleted: boolean } },
        cacheStats:  { method: 'GET',    path: '/api/dashboard/cache/stats',                                        response: {} as DashboardCacheStatsResponse },
        flushCache:  { method: 'DELETE', path: '/api/dashboard/cache',                                               response: {} as DashboardCacheInvalidateResponse },
        invalidateCacheEntry: { method: 'DELETE', path: '/api/dashboard/cache/:id',                                  response: {} as { invalidated: string } },
        roleMemories:{ method: 'GET',    path: '/api/dashboard/roles/:role/memories', query: {} as DashboardRoleMemoriesParams, response: {} as DashboardRoleMemoriesResponse },
    },

} as const;

// ============================================================
// SECTION 8: CONFIGURATION INTERFACE
// ============================================================

/**
 * Configuration interface for the memory system.
 * Maps to environment variables defined in .env.example.
 */
export interface IMemorySystemConfig {
    llm: {
        provider: string;                              // 'lmstudio' | 'openrouter'
        baseUrl: string;                               // e.g. 'http://localhost:1234/v1'
        apiKey: string;
        model: string;                                 // e.g. 'deepseek-r1'
        embeddingModel: string;                        // e.g. 'nomic-embed-text'
    };
    redis: {
        url: string;                                   // e.g. 'redis://localhost:6379'
    };
    postgres: {
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
    };
    qdrant: {
        url: string;                                   // e.g. 'http://localhost:6333'
        collection: string;                            // e.g. 'semantic_memory'
    };
    neo4j: {
        uri: string;                                   // e.g. 'bolt://localhost:7687'
        user: string;
        password: string;
    };
    agent: {
        memoryRetrievalLimit: number;                  // default 7
        memoryDecayFactor: number;                     // default 0.01
        workingMemoryTTL: number;                      // default 3600 (seconds)
    };
    contextBuilder: {
        defaultMaxTokens: number;                      // default 2048
        compressionThreshold: number;                  // default 0.7
    };
    evolution: {
        conflictSimilarityThreshold: number;           // default 0.75
        confidenceDecayRate: number;                   // default 0.005
        staleArchiveDays: number;                      // default 30
        promotionUsageThreshold: number;               // default 5
        promotionConfidenceThreshold: number;          // default 0.7
    };
    server: {
        port: number;                                  // default 3001
        corsOrigins: string[];
        apiKeys: string[];
    };
    semanticCache: {
        similarityThreshold: number;                   // default 0.95
        ttlSeconds: number;                            // default 3600
        keyPrefix: string;                             // default 'sc:'
        indexKey: string;                              // default 'sc:index'
        maxEntries: number;                            // default 500
        enabled: boolean;                              // default true
    };
    roles: {
        defaultRole: AgentRole;                        // default 'general'
        roleRelevanceWeight: number;                   // default 0.15
        minRoleImportance: number;                     // default 0.1
    };
}

// ============================================================
// SECTION 9: INTEGRATION QUICK-START
// ============================================================

/**
 * MINIMAL INTEGRATION EXAMPLE
 *
 * --- Embedding (same Bun/TS project) ---
 *
 *   import { MemoryManager } from 'ai-agent-memory-system';
 *
 *   const memory = new MemoryManager('my-session');
 *
 *   // Store an interaction
 *   await memory.processInteraction(userMsg, assistantMsg, 'success');
 *
 *   // Retrieve memories
 *   const memories = await memory.query({
 *     task: 'fix TypeScript compilation error',
 *     context: 'tsconfig strict mode is enabled',
 *   });
 *
 *   // Record feedback
 *   await memory.recordFeedback('fix TS error', [
 *     { memory_id: 'abc', used: true,  helpful: true  },
 *     { memory_id: 'def', used: false, helpful: false },
 *   ]);
 *
 * --- REST API (any language) ---
 *
 *   POST /api/sessions   { session_id: "my-session" }
 *
 *   POST /api/chat/sync  { session_id: "my-session", message: "Hello" }
 *   POST /api/memory/query { session_id: "my-session", task: "fix bug", context: "..." }
 *   POST /api/memory/store { session_id: "my-session", content: "User prefers TypeScript" }
 *   POST /api/memory/search { session_id: "my-session", query: "TypeScript setup" }
 *
 *   GET /api/memory/stats?session_id=my-session
 *   GET /api/memory/graph?session_id=my-session&q=TypeScript
 */

export {};
