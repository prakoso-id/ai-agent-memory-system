import { SessionManager } from '../session-manager.js';
import { corsHeaders } from '../middleware.js';
import { db } from '../../database/connections.js';
import { config } from '../../config/index.js';
import type {
    AgentRole,
    MemoryListFilter,
    DashboardGraph,
    DashboardGraphNode,
    DashboardGraphEdge,
    DashboardMemory,
    ConflictStatus,
} from '../../memory/types.js';

/**
 * Dashboard API Routes â€” Dashboard Backend.
 *
 * GET  /api/dashboard/metrics           â€” Metrics snapshot
 * GET  /api/dashboard/advisories        â€” Self-healing improvement suggestions
 * GET  /api/dashboard/graph             â€” Dashboard graph (nodes + edges from Neo4j)
 * GET  /api/dashboard/memories          â€” Paginated memory list with filters
 * PATCH /api/dashboard/memories/:id     â€” Update importance / archive / role importance
 * DELETE /api/dashboard/memories/:id    â€” Hard-delete a memory (semantic + graph)
 * GET  /api/dashboard/cache/stats       â€” Semantic cache stats
 * DELETE /api/dashboard/cache           â€” Flush semantic cache
 * DELETE /api/dashboard/cache/:id       â€” Invalidate a single cache entry
 * GET  /api/dashboard/roles/:role/memories â€” Role-scoped memory list
 */
export function dashboardRoutes(sessions: SessionManager) {

    /**
     * Helper: resolve a MemoryManager from request.
     * Routes that need a session accept ?session_id= or body.session_id.
     * Global dashboard routes (graph, memories) use the first available session.
     */
    function resolveManager(req: Request, sessionId?: string) {
        const targetId = sessionId ?? sessions.listSessions()[0]?.sessionId;
        if (!targetId) return null;
        return sessions.getSession(targetId)?.getMemoryManager() ?? null;
    }

    return {
        // ==================================================================
        // METRICS & ADVISORIES
        // ==================================================================

        /** GET /api/dashboard/metrics?session_id= */
        async getMetrics(req: Request): Promise<Response> {
            const url = new URL(req.url);
            const mm  = resolveManager(req, url.searchParams.get('session_id') ?? undefined);
            if (!mm) {
                return Response.json({ error: 'No active session' }, { status: 404, headers: corsHeaders(req) });
            }

            try {
                const metrics = await mm.getDashboardMetrics();
                return Response.json({ metrics }, { headers: corsHeaders(req) });
            } catch (err) {
                console.error('[Dashboard] getMetrics error:', err);
                return Response.json({ error: 'Failed to compute metrics' }, { status: 500, headers: corsHeaders(req) });
            }
        },

        /** GET /api/dashboard/advisories?session_id= */
        async getAdvisories(req: Request): Promise<Response> {
            const url = new URL(req.url);
            const mm  = resolveManager(req, url.searchParams.get('session_id') ?? undefined);
            if (!mm) {
                return Response.json({ error: 'No active session' }, { status: 404, headers: corsHeaders(req) });
            }

            try {
                const advisories = await mm.getAdvisories();
                return Response.json({ advisories }, { headers: corsHeaders(req) });
            } catch (err) {
                return Response.json({ error: 'Failed to generate advisories' }, { status: 500, headers: corsHeaders(req) });
            }
        },

        // ==================================================================
        // GRAPH VISUALISATION
        // ==================================================================

        /**
         * GET /api/dashboard/graph?q=&limit=
         *
         * Returns Neo4j nodes and relationships in a dashboard-friendly shape.
         * Merges per-node Qdrant metadata (confidence, roles, importance) if available.
         */
        async getGraph(req: Request): Promise<Response> {
            const url   = new URL(req.url);
            const query = url.searchParams.get('q') ?? '';
            const limit = parseInt(url.searchParams.get('limit') ?? '80');

            try {
                // Fetch from Neo4j via existing KnowledgeGraphService
                const mm = resolveManager(req);
                let neoNodes: any[] = [];
                let neoRels:  any[] = [];

                if (mm) {
                    neoNodes = await mm.knowledgeGraph.query(query || 'knowledge', limit);
                    // Collect relationships for all returned nodes
                    const relSet = new Map<string, DashboardGraphEdge>();
                    for (const n of neoNodes.slice(0, 30)) {
                        const related = await mm.knowledgeGraph.getRelated(n.name);
                        for (const r of related) {
                            const edgeId = `${n.id}-${r.edge.relationship}-${r.node.id}`;
                            relSet.set(edgeId, {
                                id:           edgeId,
                                source:       n.id,
                                target:       r.node.id,
                                relationship: r.edge.relationship,
                                weight:       r.edge.weight,
                            });
                        }
                    }
                    neoRels = Array.from(relSet.values());
                }

                const nodes: DashboardGraphNode[] = neoNodes.map((n) => ({
                    id:          n.id,
                    label:       n.label,
                    name:        n.name,
                    importance:  (n.properties?.importance as number) ?? 0.5,
                    usageCount:  (n.properties?.usage_count as number) ?? 0,
                    timestamp:   n.createdAt,
                }));

                const graph: DashboardGraph = { nodes, edges: neoRels };
                return Response.json(graph, { headers: corsHeaders(req) });
            } catch (err) {
                console.error('[Dashboard] getGraph error:', err);
                return Response.json({ nodes: [], edges: [] }, { headers: corsHeaders(req) });
            }
        },

        // ==================================================================
        // MEMORY LIST / FILTER
        // ==================================================================

        /**
         * GET /api/dashboard/memories
         *
         * Query params (all optional):
         *   topic, min_confidence, max_confidence, conflict_status,
         *   agent_role, archived, limit, offset, session_id
         */
        async listMemories(req: Request): Promise<Response> {
            const url = new URL(req.url);
            const filter: MemoryListFilter = {
                topic:          url.searchParams.get('topic') ?? undefined,
                minConfidence:  url.searchParams.has('min_confidence') ? parseFloat(url.searchParams.get('min_confidence')!) : undefined,
                maxConfidence:  url.searchParams.has('max_confidence') ? parseFloat(url.searchParams.get('max_confidence')!) : undefined,
                conflictStatus: url.searchParams.get('conflict_status') as ConflictStatus ?? undefined,
                agentRole:      url.searchParams.get('agent_role') as AgentRole ?? undefined,
                archived:       url.searchParams.has('archived') ? url.searchParams.get('archived') === 'true' : undefined,
                limit:          parseInt(url.searchParams.get('limit') ?? '50'),
                offset:         parseInt(url.searchParams.get('offset') ?? '0'),
            };

            try {
                // Build Qdrant scroll filter from MemoryListFilter
                const must: unknown[] = [];

                // Archived filter (default: exclude archived)
                must.push({ key: 'archived', match: { value: filter.archived ?? false } });

                if (filter.topic) {
                    // Loose text match via tag OR category
                    must.push({
                        should: [
                            { key: 'tags',     match: { value: filter.topic } },
                            { key: 'category', match: { value: filter.topic } },
                        ],
                    });
                }

                if (filter.agentRole) {
                    must.push({ key: 'roles', match: { value: filter.agentRole } });
                }

                if (filter.conflictStatus) {
                    if (filter.conflictStatus === 'none') {
                        must.push({ is_empty: { key: 'conflict_group' } });
                    } else {
                        must.push({ is_not_empty: { key: 'conflict_group' } });
                    }
                }

                const result = await db.qdrant.scroll(config.qdrant.collection, {
                    filter:     { must } as any,
                    limit:      filter.limit,
                    offset:     filter.offset,
                    with_payload: true,
                    with_vector: false,
                });

                let memories: DashboardMemory[] = result.points.map((p) => {
                    const pl = p.payload!;
                    return {
                        id:             p.id as string,
                        content:        pl.content as string,
                        category:       pl.category as string,
                        source:         pl.source as string,
                        importance:     pl.importance as number,
                        confidence:     (pl.confidence as number) ?? 0.5,
                        usageCount:     (pl.usage_count as number) ?? 0,
                        tags:           (pl.tags as string[]) ?? [],
                        roles:          (pl.roles as AgentRole[]) ?? [],
                        conflictStatus: (pl.conflict_group ? 'detected' : 'none') as ConflictStatus,
                        archived:       (pl.archived as boolean) ?? false,
                        timestamp:      pl.timestamp as string,
                        lastAccessed:   (pl.last_accessed as string) ?? (pl.timestamp as string),
                    };
                });

                // Apply post-scroll filters Qdrant can't express natively
                if (filter.minConfidence !== undefined) {
                    memories = memories.filter((m) => m.confidence >= filter.minConfidence!);
                }
                if (filter.maxConfidence !== undefined) {
                    memories = memories.filter((m) => m.confidence <= filter.maxConfidence!);
                }

                return Response.json(
                    { memories, total: memories.length, limit: filter.limit, offset: filter.offset },
                    { headers: corsHeaders(req) },
                );
            } catch (err) {
                console.error('[Dashboard] listMemories error:', err);
                return Response.json({ error: 'Failed to fetch memories' }, { status: 500, headers: corsHeaders(req) });
            }
        },

        /**
         * PATCH /api/dashboard/memories/:id
         *
         * Body (all optional):
         *   importance, archived, role_importance: { role: AgentRole, value: number }
         */
        async updateMemory(req: Request, id: string): Promise<Response> {
            const body = await req.json() as {
                session_id?: string;
                importance?: number;
                archived?: boolean;
                role_importance?: { role: AgentRole; value: number };
            };

            try {
                const payload: Record<string, unknown> = {};
                if (body.importance !== undefined)  payload.importance = Math.max(0, Math.min(1, body.importance));
                if (body.archived !== undefined)     payload.archived   = body.archived;

                if (Object.keys(payload).length > 0) {
                    await db.qdrant.setPayload(config.qdrant.collection, { payload, points: [id] });
                }

                if (body.role_importance) {
                    const mm = resolveManager(req, body.session_id);
                    if (mm) {
                        await mm.roles.updateRoleImportance(id, body.role_importance.role, body.role_importance.value);
                    }
                }

                return Response.json({ updated: true, id }, { headers: corsHeaders(req) });
            } catch (err) {
                console.error('[Dashboard] updateMemory error:', err);
                return Response.json({ error: 'Update failed' }, { status: 500, headers: corsHeaders(req) });
            }
        },

        /**
         * DELETE /api/dashboard/memories/:id
         *
         * Hard deletion from Qdrant (semantic layer).
         * Note: Neo4j nodes are managed through the knowledge graph lifecycle
         * and are not hard-deleted here to preserve graph integrity.
         */
        async deleteMemory(req: Request, id: string): Promise<Response> {
            try {
                await db.qdrant.delete(config.qdrant.collection, { points: [id] });
                return Response.json({ deleted: true, id }, { headers: corsHeaders(req) });
            } catch (err) {
                return Response.json({ error: 'Delete failed' }, { status: 500, headers: corsHeaders(req) });
            }
        },

        // ==================================================================
        // SEMANTIC CACHE MANAGEMENT
        // ==================================================================

        /** GET /api/dashboard/cache/stats */
        async getCacheStats(req: Request): Promise<Response> {
            const mm = resolveManager(req);
            if (!mm) return Response.json({ error: 'No session' }, { status: 404, headers: corsHeaders(req) });
            const stats = await mm.cache.getStats();
            return Response.json({ cache: stats }, { headers: corsHeaders(req) });
        },

        /** DELETE /api/dashboard/cache â€” flush entire cache */
        async flushCache(req: Request): Promise<Response> {
            const mm = resolveManager(req);
            if (!mm) return Response.json({ error: 'No session' }, { status: 404, headers: corsHeaders(req) });
            await mm.cache.flush();
            return Response.json({ flushed: true }, { headers: corsHeaders(req) });
        },

        /** DELETE /api/dashboard/cache/:entryId â€” invalidate single entry */
        async invalidateCacheEntry(req: Request, entryId: string): Promise<Response> {
            const mm = resolveManager(req);
            if (!mm) return Response.json({ error: 'No session' }, { status: 404, headers: corsHeaders(req) });
            await mm.cache.invalidate(entryId);
            return Response.json({ invalidated: true, entryId }, { headers: corsHeaders(req) });
        },

        // ==================================================================
        // ROLE-BASED QUERIES
        // ==================================================================

        /**
         * GET /api/dashboard/roles/:role/memories?session_id=&limit=
         *
         * Returns memories visible and relevant to a specific agent role.
         */
        async getRoleMemories(req: Request, role: string): Promise<Response> {
            const validRoles: AgentRole[] = ['coder', 'pm', 'qa', 'analyst', 'general'];
            if (!validRoles.includes(role as AgentRole)) {
                return Response.json(
                    { error: `Invalid role. Valid roles: ${validRoles.join(', ')}` },
                    { status: 400, headers: corsHeaders(req) },
                );
            }

            const url   = new URL(req.url);
            const limit = parseInt(url.searchParams.get('limit') ?? '50');
            const mm    = resolveManager(req, url.searchParams.get('session_id') ?? undefined);
            if (!mm) return Response.json({ error: 'No session' }, { status: 404, headers: corsHeaders(req) });

            try {
                const memories = await mm.roles.listByRole(role as AgentRole, limit);
                return Response.json({ role, memories, total: memories.length }, { headers: corsHeaders(req) });
            } catch (err) {
                return Response.json({ error: 'Role memory fetch failed' }, { status: 500, headers: corsHeaders(req) });
            }
        },
    };
}
