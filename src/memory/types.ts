// ============================================================
// Memory System Type Definitions
// ============================================================

/** Task context types — drives context-aware retrieval scoring */
export type TaskType = 'coding' | 'chat' | 'planning' | 'analysis' | 'general';

/** Base memory record shared across all memory types */
export interface BaseMemory {
    id: string;
    content: string;
    timestamp: string;        // ISO 8601
    importance: number;       // 0.0 – 1.0
    usage_count: number;      // incremented on each retrieval or duplicate write
    last_accessed: string;    // ISO 8601 — updated on each retrieval
    tags?: string[];          // free-form classification tags (defaults to [])
    source?: string;          // origin: 'episode:<id>', 'api', 'reflection', etc.
    metadata: Record<string, unknown>;
}

// ---- Episodic Memory ----

export type EventType = 'conversation' | 'task_execution' | 'error' | 'reflection' | 'system';

export interface EpisodicMemory extends BaseMemory {
    eventType: EventType;
    sessionId: string;
    task?: string;
    result?: 'success' | 'failure' | 'partial';
    context?: string;
}

// ---- Semantic Memory ----

export interface SemanticMemory extends BaseMemory {
    category: string;        // e.g. "user_preference", "project_fact", "general_knowledge"
    source: string;          // required for semantic: where the knowledge came from
    embedding?: number[];    // vector embedding
}

// ---- Reflection Memory ----

export interface ReflectionMemory extends BaseMemory {
    observation: string;
    rootCause: string;
    lessonLearned: string;
    strategyImprovement: string;
    relatedEpisodeIds: string[];
}

// ---- Knowledge Graph ----

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

// ---- Retrieval & Scoring ----

export interface MemoryScore {
    memoryId: string;
    semanticSimilarity: number;
    recency: number;
    importance: number;
    taskRelevance: number;   // 0.0 – 1.0 based on tag overlap with task type
    totalScore: number;
}

export interface RetrievalQuery {
    query: string;
    taskType?: TaskType;     // drives context-aware scoring
    limit?: number;
    minScore?: number;
    filters?: {
        eventType?: EventType;
        category?: string;
        sessionId?: string;
        timeRange?: { from?: string; to?: string };
        tags?: string[];
        source?: Array<RetrievedMemory['source']>;  // restrict to specific layers
    };
}

export interface RetrievedMemory {
    memory: BaseMemory;
    source: 'episodic' | 'semantic' | 'reflection' | 'knowledge_graph';
    score: MemoryScore;
}

// ---- Unified Query API ----

/**
 * Input for the unified memory.query() API.
 * Combines task description + optional context for fully context-aware retrieval.
 */
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

// ---- Working Memory (conversation context) ----

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

// ---- Phase 2: Adaptive Learning & Context Optimization ----

/** Retrieval feedback submitted after the agent uses (or ignores) a memory */
export interface RetrievalFeedback {
    memory_id: string;
    query: string;
    used: boolean;
    helpful: boolean;
    timestamp: string;       // ISO 8601
}

/** Reusable pattern / strategy extracted from reflections */
export interface StrategyMemory {
    id: string;
    pattern: string;         // human-readable description ("comparison content performs better")
    evidence: string;        // supporting observations
    effectiveness: number;   // 0.0 – 1.0, updated over time
    domain: string;          // e.g. "content_format", "response_style", "retrieval"
    usage_count: number;
    last_validated: string;  // ISO 8601
    created_at: string;      // ISO 8601
    metadata: Record<string, unknown>;
}

/** Actionable directive derived from reflections */
export interface BehavioralDirective {
    id: string;
    type: 'retrieval_bias' | 'prompt_style' | 'content_preference';
    directive: string;       // "keep responses concise", "prefer code examples"
    weight: number;          // 0.0 – 1.0, how strongly to apply
    source_reflection_id: string;
    active: boolean;
    created_at: string;
}

/** Compression tier for hierarchical context compression */
export type CompressionTier = 'raw' | 'summary' | 'insight';

/** A memory that has been through the compression pipeline */
export interface CompressedMemory {
    memory: RetrievedMemory;
    tier: CompressionTier;
    compressedContent: string;
    originalTokens: number;
    compressedTokens: number;
}

/** Options for the context builder */
export interface ContextBuilderOptions {
    query: string;
    max_tokens: number;
    priority: Array<'recent' | 'important' | 'relevant'>;
    taskType?: TaskType;
    include_strategies?: boolean;
    include_directives?: boolean;
}

/** Result of context building — everything the prompt needs */
export interface BuiltContext {
    memories: CompressedMemory[];
    strategies: StrategyMemory[];
    directives: BehavioralDirective[];
    totalTokens: number;
    compressionApplied: boolean;
}

/** Adaptive reranking weights (can shift over time based on feedback) */
export interface AdaptiveWeights {
    semanticSimilarity: number;
    recency: number;
    importance: number;
    taskRelevance: number;
    usagePopularity: number;
}

// ---- Phase 3: Memory Evolution & Evaluation ----

/** Conflict status for a memory */
export type ConflictStatus = 'none' | 'detected' | 'hypothesis' | 'resolved' | 'superseded';

/** A detected conflict between two memories */
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

/** Confidence score components for a single memory */
export interface ConfidenceScore {
    overall: number;            // 0.0 – 1.0 composite
    usage_signal: number;       // from retrieval frequency
    consistency_signal: number; // inverse of conflict count
    source_reliability: number; // from source trust tier
    recency_signal: number;     // time decay on confidence
}

/** A hypothesis holding multiple perspectives on a conflicting topic */
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

/** Evaluation record for a single retrieval query */
export interface EvaluationRecord {
    id: string;
    query_id: string;
    query_text: string;
    retrieved_memory_ids: string[];
    success: boolean;
    hit_rate: number;            // % of retrieved memories marked useful
    response_quality?: number;   // optional 0-1 quality score
    created_at: string;
}

/** Aggregate evaluation metrics over a time period */
export interface EvaluationMetrics {
    total_queries: number;
    avg_hit_rate: number;
    avg_usefulness: number;
    retrieval_success_rate: number;
    period_start: string;
    period_end: string;
}

/** Audit record for a memory promotion event */
export interface PromotionEvent {
    id: string;
    memory_id: string;
    from_layer: 'episodic' | 'semantic';
    to_layer: 'semantic' | 'knowledge_graph';
    reason: string;
    promoted_at: string;
}
