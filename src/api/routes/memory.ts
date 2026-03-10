import { SessionManager } from '../session-manager.js';
import { corsHeaders } from '../middleware.js';

/**
 * Memory API route handlers.
 * POST /api/memory/store   — Store a fact/memory directly
 * POST /api/memory/search  — Semantic similarity search
 * GET  /api/memory/stats   — Memory layer counts
 * GET  /api/memory/graph   — Knowledge graph query
 */
export function memoryRoutes(sessions: SessionManager) {
    return {
        /** Store a fact directly into semantic memory */
        async store(req: Request): Promise<Response> {
            const body = await req.json() as {
                session_id: string;
                content: string;
                category?: string;
                importance?: number;
            };

            if (!body.session_id || !body.content) {
                return Response.json(
                    { error: 'session_id and content are required' },
                    { status: 400, headers: corsHeaders(req) },
                );
            }

            const agent = sessions.getSession(body.session_id);
            if (!agent) {
                return Response.json(
                    { error: `Session ${body.session_id} not found` },
                    { status: 404, headers: corsHeaders(req) },
                );
            }

            const memory = await agent.getMemoryManager().semantic.store({
                content: body.content,
                category: body.category ?? 'general_knowledge',
                source: 'api',
                importance: body.importance ?? 0.7,
                metadata: { source: 'direct_api' },
            });

            return Response.json(
                { stored: true, id: memory.id },
                { headers: corsHeaders(req) },
            );
        },

        /** Semantic search across memories */
        async search(req: Request): Promise<Response> {
            const body = await req.json() as {
                session_id: string;
                query: string;
                limit?: number;
                min_score?: number;
            };

            if (!body.session_id || !body.query) {
                return Response.json(
                    { error: 'session_id and query are required' },
                    { status: 400, headers: corsHeaders(req) },
                );
            }

            const agent = sessions.getSession(body.session_id);
            if (!agent) {
                return Response.json(
                    { error: `Session ${body.session_id} not found` },
                    { status: 404, headers: corsHeaders(req) },
                );
            }

            const results = await agent.getMemoryManager().retrieve({
                query: body.query,
                limit: body.limit,
                minScore: body.min_score,
            });

            return Response.json(
                {
                    query: body.query,
                    count: results.length,
                    results: results.map((r) => ({
                        source: r.source,
                        content: r.memory.content,
                        score: r.score.totalScore,
                        importance: r.memory.importance,
                        timestamp: r.memory.timestamp,
                    })),
                },
                { headers: corsHeaders(req) },
            );
        },

        /** Get memory statistics for a session */
        async stats(req: Request): Promise<Response> {
            const url = new URL(req.url);
            const sessionId = url.searchParams.get('session_id');

            if (!sessionId) {
                return Response.json(
                    { error: 'session_id query parameter is required' },
                    { status: 400, headers: corsHeaders(req) },
                );
            }

            const agent = sessions.getSession(sessionId);
            if (!agent) {
                return Response.json(
                    { error: `Session ${sessionId} not found` },
                    { status: 404, headers: corsHeaders(req) },
                );
            }

            const stats = await agent.getStats();
            return Response.json(stats, { headers: corsHeaders(req) });
        },

        /** Query the knowledge graph */
        async graph(req: Request): Promise<Response> {
            const url = new URL(req.url);
            const sessionId = url.searchParams.get('session_id');
            const query = url.searchParams.get('q');

            if (!sessionId || !query) {
                return Response.json(
                    { error: 'session_id and q query parameters are required' },
                    { status: 400, headers: corsHeaders(req) },
                );
            }

            const agent = sessions.getSession(sessionId);
            if (!agent) {
                return Response.json(
                    { error: `Session ${sessionId} not found` },
                    { status: 404, headers: corsHeaders(req) },
                );
            }

            const nodes = await agent.getMemoryManager().knowledgeGraph.query(query);
            return Response.json(
                {
                    query,
                    count: nodes.length,
                    nodes: nodes.map((n) => ({
                        id: n.id,
                        name: n.name,
                        label: n.label,
                        properties: n.properties,
                    })),
                },
                { headers: corsHeaders(req) },
            );
        },
    };
}
