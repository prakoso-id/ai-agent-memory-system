import { config } from './config/index.js';
import { db } from './database/connections.js';
import { initializeDatabase } from './database/init.js';
import { SessionManager } from './api/session-manager.js';
import { withAuth, corsHeaders, handlePreflight, logRequest } from './api/middleware.js';
import { chatRoutes } from './api/routes/chat.js';
import { memoryRoutes } from './api/routes/memory.js';
import { sessionRoutes } from './api/routes/sessions.js';
import { dashboardRoutes } from './api/routes/dashboard.js';

/**
 * AI Agent Memory System — REST API Server.
 *
 * Endpoints:
 *   GET    /api/health                          — Health check
 *   POST   /api/chat                            — SSE streaming chat
 *   POST   /api/chat/sync                       — Non-streaming chat
 *   POST   /api/memory/store                    — Store a memory directly
 *   POST   /api/memory/search                   — Semantic search
 *   POST   /api/memory/query                    — Unified context-aware query (Phase 1)
 *   GET    /api/memory/stats                    — Memory statistics
 *   GET    /api/memory/graph                    — Knowledge graph query
 *   POST   /api/sessions                        — Create session
 *   GET    /api/sessions                        — List sessions
 *   GET    /api/sessions/:id                    — Get session details
 *   DELETE /api/sessions/:id                    — Delete session
 *
 *   Phase 4 (Dashboard + Observability + Cache + Roles):
 *   GET    /api/dashboard/metrics               — Metrics snapshot
 *   GET    /api/dashboard/advisories            — Self-healing suggestions
 *   GET    /api/dashboard/graph                 — Dashboard graph (Neo4j)
 *   GET    /api/dashboard/memories              — Paginated memory list + filters
 *   PATCH  /api/dashboard/memories/:id          — Update importance / archive / role weight
 *   DELETE /api/dashboard/memories/:id          — Hard-delete a memory
 *   GET    /api/dashboard/cache/stats           — Semantic cache statistics
 *   DELETE /api/dashboard/cache                 — Flush semantic cache
 *   DELETE /api/dashboard/cache/:id             — Invalidate single cache entry
 *   GET    /api/dashboard/roles/:role/memories  — Role-scoped memory list
 */
async function startServer(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   🧠  Memory System API Server                         ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // Initialize databases
    await initializeDatabase();

    // Create session manager and route handlers
    const sessions = new SessionManager(config.agent.workingMemoryTTL * 1000);
    const chat = chatRoutes(sessions);
    const memory = memoryRoutes(sessions);
    const session = sessionRoutes(sessions);
    const dashboard = dashboardRoutes(sessions);

    const server = Bun.serve({
        port: config.server.port,

        async fetch(req: Request): Promise<Response> {
            const start = Date.now();
            const url = new URL(req.url);
            const path = url.pathname;
            const method = req.method;

            // CORS preflight
            if (method === 'OPTIONS') {
                return handlePreflight(req);
            }

            let response: Response;

            try {
                // Health check (no auth required)
                if (method === 'GET' && (path === '/api/health' || path === '/health')) {
                    response = Response.json(
                        {
                            status: 'ok',
                            timestamp: new Date().toISOString(),
                            version: '1.0.0',
                            sessions: sessions.listSessions().length,
                        },
                        { headers: corsHeaders(req) },
                    );
                }
                // All other routes require auth
                else {
                    const authHandler = withAuth(async () => {
                        // ---- Chat routes ----
                        if (method === 'POST' && path === '/api/chat') {
                            return chat.stream(req);
                        }
                        if (method === 'POST' && path === '/api/chat/sync') {
                            return chat.sync(req);
                        }

                        // ---- Memory routes ----
                        if (method === 'POST' && path === '/api/memory/store') {
                            return memory.store(req);
                        }
                        if (method === 'POST' && path === '/api/memory/search') {
                            return memory.search(req);
                        }
                        if (method === 'POST' && path === '/api/memory/query') {
                            return memory.queryMemory(req);
                        }
                        if (method === 'GET' && path === '/api/memory/stats') {
                            return memory.stats(req);
                        }
                        if (method === 'GET' && path === '/api/memory/graph') {
                            return memory.graph(req);
                        }

                        // ---- Session routes ----
                        if (method === 'POST' && path === '/api/sessions') {
                            return session.create(req);
                        }
                        if (method === 'GET' && path === '/api/sessions') {
                            return session.list(req);
                        }

                        // Session routes with :id parameter
                        const sessionMatch = path.match(/^\/api\/sessions\/(.+)$/);
                        if (sessionMatch) {
                            const id = sessionMatch[1]!;
                            if (method === 'GET') return session.get(req, id);
                            if (method === 'DELETE') return session.remove(req, id);
                        }

                        // ---- Dashboard routes ----
                        if (method === 'GET' && path === '/api/dashboard/metrics') {
                            return dashboard.getMetrics(req);
                        }
                        if (method === 'GET' && path === '/api/dashboard/advisories') {
                            return dashboard.getAdvisories(req);
                        }
                        if (method === 'GET' && path === '/api/dashboard/graph') {
                            return dashboard.getGraph(req);
                        }
                        if (method === 'GET' && path === '/api/dashboard/memories') {
                            return dashboard.listMemories(req);
                        }
                        if (method === 'GET' && path === '/api/dashboard/cache/stats') {
                            return dashboard.getCacheStats(req);
                        }
                        if (method === 'DELETE' && path === '/api/dashboard/cache') {
                            return dashboard.flushCache(req);
                        }

                        // Dashboard routes with :id parameter
                        const dashMemMatch   = path.match(/^\/api\/dashboard\/memories\/(.+)$/);
                        const dashCacheMatch = path.match(/^\/api\/dashboard\/cache\/(.+)$/);
                        const dashRoleMatch  = path.match(/^\/api\/dashboard\/roles\/([^/]+)\/memories$/);

                        if (dashMemMatch) {
                            const id = dashMemMatch[1]!;
                            if (method === 'PATCH')  return dashboard.updateMemory(req, id);
                            if (method === 'DELETE') return dashboard.deleteMemory(req, id);
                        }
                        if (dashCacheMatch && method === 'DELETE') {
                            return dashboard.invalidateCacheEntry(req, dashCacheMatch[1]!);
                        }
                        if (dashRoleMatch && method === 'GET') {
                            return dashboard.getRoleMemories(req, dashRoleMatch[1]!);
                        }

                        // Not found
                        return Response.json(
                            {
                                error: 'Not found', availableEndpoints: [
                                    'GET  /api/health',
                                    'POST /api/chat',
                                    'POST /api/chat/sync',
                                    'POST /api/memory/store',
                                    'POST /api/memory/search',
                                    'POST /api/memory/query',
                                    'GET  /api/memory/stats?session_id=',
                                    'GET  /api/memory/graph?session_id=&q=',
                                    'POST /api/sessions',
                                    'GET  /api/sessions',
                                    'GET  /api/sessions/:id',
                                    'DELETE /api/sessions/:id',
                                    // Dashboard
                                    'GET    /api/dashboard/metrics?session_id=',
                                    'GET    /api/dashboard/advisories?session_id=',
                                    'GET    /api/dashboard/graph?q=&limit=',
                                    'GET    /api/dashboard/memories?topic=&min_confidence=&agent_role=&archived=&limit=&offset=',
                                    'PATCH  /api/dashboard/memories/:id',
                                    'DELETE /api/dashboard/memories/:id',
                                    'GET    /api/dashboard/cache/stats',
                                    'DELETE /api/dashboard/cache',
                                    'DELETE /api/dashboard/cache/:id',
                                    'GET    /api/dashboard/roles/:role/memories?session_id=&limit=',
                                ]
                            },
                            { status: 404, headers: corsHeaders(req) },
                        );
                    });

                    response = await authHandler(req);
                }
            } catch (error) {
                console.error('Server error:', error);
                response = Response.json(
                    { error: 'Internal server error' },
                    { status: 500, headers: corsHeaders(req) },
                );
            }

            logRequest(method, path, response.status, Date.now() - start);
            return response;
        },
    });

    console.log(`\n🚀 API Server running at http://localhost:${server.port}`);
    console.log(`   Auth: Bearer token required (configured ${config.server.apiKeys.length} key(s))`);
    console.log(`   CORS: ${config.server.corsOrigins.join(', ')}\n`);

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n👋 Shutting down server...');
        sessions.destroy();
        server.stop();
        await db.shutdown();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
    console.error('💥 Server failed to start:', err);
    process.exit(1);
});
