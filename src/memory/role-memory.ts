import { db } from '../database/connections.js';
import { llm } from '../llm/llm-client.js';
import { config } from '../config/index.js';
import { rerank } from './utils/reranker.js';
import type {
    AgentRole,
    RoleAwareMemory,
    RoleImportanceMap,
    RoleQueryInput,
    RetrievedMemory,
    MemoryScore,
} from './types.js';

/**
 * Role-Based Memory Partitioning — Phase 4 / Enhancement 2.
 *
 * Enables multiple AI agents (coder, pm, qa, analyst, general) to share the
 * same Qdrant semantic-memory collection while seeing role-filtered,
 * role-relevance-ranked views of the data.
 *
 * Schema additions to Qdrant payload:
 *   roles:               string[]                 — which roles can see this memory
 *   importance_per_role: Record<AgentRole, number> — per-role importance override
 *
 * Retrieval pipeline:
 *   1. Qdrant vector search (role payload filter applied server-side)
 *   2. Role-relevance score computed from importance_per_role
 *   3. Composite rerank with role dimension injected
 *
 * Neo4j schema additions (applied in initializeDatabase):
 *   (:Entity)-[:RELEVANT_TO {importance: float}]->(:Role {name: AgentRole})
 */
export class RoleMemoryService {
    private readonly collection = config.qdrant.collection;
    private readonly roleWeight = config.roles.roleRelevanceWeight;
    private readonly minImportance = config.roles.minRoleImportance;

    // =====================================================================
    // WRITE — store a memory with role metadata
    // =====================================================================

    /**
     * Annotate an existing Qdrant point with role-partition metadata.
     *
     * Call this after `SemanticMemoryService.store()` returns successfully to
     * attach the role fields without re-embedding.
     */
    async attachRoles(
        memoryId: string,
        roles: AgentRole[],
        importancePerRole: RoleImportanceMap,
    ): Promise<void> {
        await db.qdrant.setPayload(this.collection, {
            payload: {
                roles: roles.length > 0 ? roles : [], // empty = visible to all
                importance_per_role: importancePerRole,
            },
            points: [memoryId],
        });
        console.log(
            `  🏷️  [RoleMemory] Attached roles [${roles.join(', ')}] to ${memoryId.substring(0, 8)}`,
        );
    }

    /**
     * Store a brand-new memory that already carries role annotations.
     * Returns the Qdrant point ID, or null if filtered by importance.
     */
    async store(
        memory: Omit<RoleAwareMemory, 'id' | 'timestamp' | 'embedding' | 'usage_count' | 'last_accessed'>,
    ): Promise<string | null> {
        if (memory.importance < 0.15) return null;

        const embedding = await llm.embed(memory.content);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await db.qdrant.upsert(this.collection, {
            wait: true,
            points: [
                {
                    id,
                    vector: embedding,
                    payload: {
                        content:            memory.content,
                        category:           memory.category,
                        source:             memory.source,
                        importance:         memory.importance,
                        usage_count:        0,
                        last_accessed:      now,
                        tags:               memory.tags ?? [],
                        timestamp:          now,
                        metadata:           memory.metadata,
                        confidence:         0.5,
                        decay_factor:       1.0,
                        conflict_group:     null,
                        archived:           false,
                        // Phase 4 role fields
                        roles:              memory.roles ?? [],
                        importance_per_role: memory.importance_per_role ?? {},
                    },
                },
            ],
        });

        console.log(`  ✅ [RoleMemory] Stored ${id.substring(0, 8)} visible to [${memory.roles?.join(', ') || 'all'}]`);
        return id;
    }

    // =====================================================================
    // READ — role-scoped retrieval
    // =====================================================================

    /**
     * Retrieve memories relevant to a given agent role.
     *
     * Applies:
     *   • Qdrant server-side filter: roles array is empty (global) OR contains agentRole
     *   • Role-relevance score: importance_per_role[agentRole] ?? global importance
     *   • Composite rerank with roleRelevance injected as an extra scoring axis
     */
    async query(input: RoleQueryInput): Promise<RetrievedMemory[]> {
        const { agentRole, task, context, limit = config.agent.memoryRetrievalLimit } = input;

        const queryText = context ? `${task}\n\nContext: ${context}` : task;
        const queryEmbedding = await llm.embed(queryText);

        // Qdrant filter: include memories with no role restriction (roles=[])
        // OR where roles array contains the agent's role
        const roleFilter = {
            should: [
                { key: 'roles', match: { value: agentRole } },
                { is_empty: { key: 'roles' } },
            ] as unknown[],
        };
        const archiveFilter = { key: 'archived', match: { value: false } };
        const combinedFilter = {
            must: [archiveFilter],
            should: roleFilter.should,
        };

        const results = await db.qdrant.search(this.collection, {
            vector: queryEmbedding,
            limit: limit * 3,           // over-fetch for reranking
            score_threshold: 0.05,
            filter: combinedFilter as any,
            with_payload: true,
        });

        console.log(
            `  🔍 [RoleMemory] role=${agentRole} query="${task.substring(0, 50)}" → ${results.length} candidates`,
        );

        const candidates: RetrievedMemory[] = results.map((r) => {
            const payload    = r.payload!;
            const importancePerRole: RoleImportanceMap = (payload.importance_per_role as RoleImportanceMap) ?? {};
            const roleImportance = importancePerRole[agentRole] ?? (payload.importance as number);

            const recency = Math.exp(-0.014 * ((Date.now() - new Date(payload.timestamp as string).getTime()) / 3_600_000));
            const score: MemoryScore = {
                memoryId:          r.id as string,
                semanticSimilarity: r.score,
                recency,
                importance:        roleImportance,  // role-adjusted importance
                taskRelevance:     0,               // filled by reranker
                totalScore:        0,
            };

            return {
                memory: {
                    id:           r.id as string,
                    content:      payload.content as string,
                    timestamp:    payload.timestamp as string,
                    importance:   roleImportance,
                    usage_count:  (payload.usage_count as number) ?? 0,
                    last_accessed:(payload.last_accessed as string) ?? (payload.timestamp as string),
                    tags:         (payload.tags as string[]) ?? [],
                    source:       payload.source as string,
                    metadata:     (payload.metadata as Record<string, unknown>) ?? {},
                },
                source: 'semantic' as const,
                score,
            };
        });

        // Inject role-relevance boosts before composite rerank
        const roleBoosts = new Map<string, number>(
            candidates.map((c) => {
                const payload    = results.find((r) => r.id === c.score.memoryId)?.payload;
                const roleImp: RoleImportanceMap = (payload?.importance_per_role as RoleImportanceMap) ?? {};
                const base       = roleImp[agentRole] ?? (payload?.importance as number ?? 0.5);
                // Boost = role_importance / global_importance (relative relevance)
                const global     = (payload?.importance as number) ?? 0.5;
                const boost      = global > 0 ? base / global : 1.0;
                return [c.score.memoryId, Math.max(0.5, Math.min(2.0, boost))];  // cap 0.5–2.0
            }),
        );

        return rerank(candidates, {
            taskType:     input.taskType,
            limit,
            feedbackBoosts: roleBoosts,   // reuse feedbackBoosts slot for role boosts
        });
    }

    // =====================================================================
    // MANAGEMENT
    // =====================================================================

    /**
     * Update the importance of a memory for a specific role.
     * Used by the dashboard "Adjust importance score" action.
     */
    async updateRoleImportance(
        memoryId: string,
        agentRole: AgentRole,
        importance: number,
    ): Promise<void> {
        const points = await db.qdrant.retrieve(this.collection, {
            ids: [memoryId],
            with_payload: true,
            with_vector: false,
        });
        if (points.length === 0) throw new Error(`Memory ${memoryId} not found`);

        const existing = (points[0]!.payload!.importance_per_role as RoleImportanceMap) ?? {};
        const updated  = { ...existing, [agentRole]: Math.max(0, Math.min(1, importance)) };

        await db.qdrant.setPayload(this.collection, {
            payload: { importance_per_role: updated },
            points: [memoryId],
        });
        console.log(
            `  ✏️  [RoleMemory] Updated importance for role=${agentRole} on ${memoryId.substring(0, 8)} → ${importance.toFixed(2)}`,
        );
    }

    /**
     * List all memories accessible to a given role, with optional filter.
     * Primarily used by the dashboard list/filter view.
     */
    async listByRole(agentRole: AgentRole, limit = 50): Promise<RoleAwareMemory[]> {
        const roleFilter = {
            should: [
                { key: 'roles', match: { value: agentRole } },
                { is_empty: { key: 'roles' } },
            ],
        };
        const archiveFilter = { key: 'archived', match: { value: false } };

        // Scroll API for full collection scans (no vector needed)
        const result = await db.qdrant.scroll(this.collection, {
            filter: { must: [archiveFilter], should: roleFilter.should } as any,
            limit,
            with_payload: true,
            with_vector: false,
        });

        return result.points.map((p) => {
            const pl = p.payload!;
            return {
                id:                  p.id as string,
                content:             pl.content as string,
                category:            pl.category as string,
                source:              pl.source as string,
                importance:          pl.importance as number,
                usage_count:         (pl.usage_count as number) ?? 0,
                last_accessed:       (pl.last_accessed as string) ?? (pl.timestamp as string),
                tags:                (pl.tags as string[]) ?? [],
                timestamp:           pl.timestamp as string,
                metadata:            (pl.metadata as Record<string, unknown>) ?? {},
                roles:               (pl.roles as AgentRole[]) ?? [],
                importance_per_role: (pl.importance_per_role as RoleImportanceMap) ?? {},
            };
        });
    }

    /**
     * Return distribution of memories across roles (for the dashboard metrics panel).
     * Each role count = number of memories that include that role in their roles[].
     */
    async getRoleDistribution(): Promise<Partial<Record<AgentRole, number>>> {
        const allRoles: AgentRole[] = ['coder', 'pm', 'qa', 'analyst', 'general'];
        const dist: Partial<Record<AgentRole, number>> = {};

        for (const role of allRoles) {
            const result = await db.qdrant.count(this.collection, {
                filter: {
                    must: [
                        { key: 'archived', match: { value: false } },
                        { key: 'roles', match: { value: role } },
                    ],
                } as any,
                exact: false,   // approximate is fine for metrics
            });
            dist[role] = result.count;
        }

        return dist;
    }
}
