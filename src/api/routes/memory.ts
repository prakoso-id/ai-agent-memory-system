import { SessionManager } from '../session-manager.js';
import { corsHeaders, extractApiKey } from '../middleware.js';
import { z } from 'zod';
import type { TaskType } from '../../memory/types.js';

const MAX_BODY_BYTES = 512 * 1024; // 512 KB

function checkBodySize(req: Request): Response | null {
    const contentLength = parseInt(req.headers.get('Content-Length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
        return Response.json({ error: 'Request body too large (max 512 KB)' }, { status: 413 });
    }
    return null;
}

// Shared validator for session_id in bodies
const sessionId = z.string().uuid('session_id must be a UUID');

const StoreBodySchema = z.object({
    session_id: sessionId,
    content: z.string().min(1, 'content is required').max(16_384),
    category: z.string().max(64).optional(),
    importance: z.number().min(0).max(1).optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
});

const SearchBodySchema = z.object({
    session_id: sessionId,
    query: z.string().min(1, 'query is required').max(4_096),
    limit: z.number().int().min(1).max(100).optional(),
    min_score: z.number().min(0).max(1).optional(),
    task_type: z.string().max(64).optional(),
});

const QueryBodySchema = z.object({
    session_id: sessionId,
    task: z.string().min(1, 'task is required').max(4_096),
    context: z.string().max(8_192).optional(),
    task_type: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(100).optional(),
});

/** Inline ownership check helper — returns a 403/404 Response or null */
function ownerGuard(
    req: Request,
    sessions: SessionManager,
    sid: string,
    apiKey: string,
): Response | null {
    const own = sessions.checkOwnership(sid, apiKey);
    if (own === 'not_found') {
        return Response.json({ error: `Session ${sid} not found` }, { status: 404, headers: corsHeaders(req) });
    }
    if (own === 'forbidden') {
        return Response.json({ error: 'Access denied' }, { status: 403, headers: corsHeaders(req) });
    }
    return null;
}

/**
 * Memory API route handlers.
 *
 * POST /api/memory/store   — Store a fact/memory directly
 * POST /api/memory/search  — Semantic similarity search
 * POST /api/memory/query   — Unified context-aware query (Phase 1)
 * GET  /api/memory/stats   — Memory layer counts
 * GET  /api/memory/graph   — Knowledge graph query
 */
export function memoryRoutes(sessions: SessionManager) {
    return {
        /** Store a fact directly into semantic memory */
        async store(req: Request): Promise<Response> {
            const sizeError = checkBodySize(req);
            if (sizeError) return sizeError;

            const raw = await req.json().catch(() => null);
            const parsed = StoreBodySchema.safeParse(raw);
            if (!parsed.success) {
                return Response.json(
                    { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
                    { status: 400, headers: corsHeaders(req) },
                );
            }
            const body = parsed.data;
            const apiKey = extractApiKey(req);
            const guardErr = ownerGuard(req, sessions, body.session_id, apiKey);
            if (guardErr) return guardErr;

            const agent = sessions.getSession(body.session_id)!;

            const memory = await agent.getMemoryManager().semantic.store({
                content: body.content,
                category: body.category ?? 'general_knowledge',
                source: 'api',
                importance: body.importance ?? 0.7,
                tags: body.tags ?? [],
                metadata: { source: 'direct_api' },
            });

            // store() returns null when filtered by importance or matched as duplicate
            if (!memory) {
                return Response.json(
                    { stored: false, reason: 'filtered_by_importance_or_duplicate' },
                    { headers: corsHeaders(req) },
                );
            }

            return Response.json(
                { stored: true, id: memory.id, usage_count: memory.usage_count },
                { headers: corsHeaders(req) },
            );
        },

        /** Semantic search across memories */
        async search(req: Request): Promise<Response> {
            const raw = await req.json().catch(() => null);
            const parsed = SearchBodySchema.safeParse(raw);
            if (!parsed.success) {
                return Response.json(
                    { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
                    { status: 400, headers: corsHeaders(req) },
                );
            }
            const body = parsed.data;
            const apiKey = extractApiKey(req);
            const guardErr = ownerGuard(req, sessions, body.session_id, apiKey);
            if (guardErr) return guardErr;

            const agent = sessions.getSession(body.session_id)!;

            const results = await agent.getMemoryManager().retrieve({
                query: body.query,
                limit: body.limit,
                minScore: body.min_score,
                taskType: body.task_type,
            });

            return Response.json(
                {
                    query: body.query,
                    task_type: body.task_type ?? 'general',
                    count: results.length,
                    results: results.map((r) => ({
                        source: r.source,
                        content: r.memory.content,
                        score: r.score.totalScore,
                        task_relevance: r.score.taskRelevance,
                        importance: r.memory.importance,
                        usage_count: r.memory.usage_count,
                        tags: r.memory.tags,
                        timestamp: r.memory.timestamp,
                    })),
                },
                { headers: corsHeaders(req) },
            );
        },

        /**
         * Unified context-aware memory query (Phase 1 API).
         *
         * Body: { session_id, task, context?, task_type?, limit? }
         */
        async queryMemory(req: Request): Promise<Response> {
            const raw = await req.json().catch(() => null);
            const parsed = QueryBodySchema.safeParse(raw);
            if (!parsed.success) {
                return Response.json(
                    { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
                    { status: 400, headers: corsHeaders(req) },
                );
            }
            const body = parsed.data;
            const apiKey = extractApiKey(req);
            const guardErr = ownerGuard(req, sessions, body.session_id, apiKey);
            if (guardErr) return guardErr;

            const agent = sessions.getSession(body.session_id)!;

            const results = await agent.getMemoryManager().query({
                task: body.task,
                context: body.context,
                taskType: body.task_type,
                limit: body.limit,
            });

            return Response.json(
                {
                    task: body.task,
                    task_type: body.task_type ?? 'inferred',
                    count: results.length,
                    results: results.map((r) => ({
                        source: r.source,
                        content: r.memory.content,
                        score: r.score.totalScore,
                        task_relevance: r.score.taskRelevance,
                        importance: r.memory.importance,
                        usage_count: r.memory.usage_count,
                        tags: r.memory.tags,
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
