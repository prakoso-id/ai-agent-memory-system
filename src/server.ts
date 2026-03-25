import { config } from './config/index.js';
import { db } from './database/connections.js';
import { initializeDatabase } from './database/init.js';
import { SessionManager } from './api/session-manager.js';
import { withAuth, corsHeaders, handlePreflight, logRequest } from './api/middleware.js';
import { chatRoutes } from './api/routes/chat.js';
import { memoryRoutes } from './api/routes/memory.js';
import { sessionRoutes } from './api/routes/sessions.js';

/**
 * AI Agent Memory System — REST API Server.
 *
 * Endpoints:
 *   GET    /api/health           — Health check
 *   POST   /api/chat             — SSE streaming chat
 *   POST   /api/chat/sync        — Non-streaming chat
 *   POST   /api/memory/store     — Store a memory directly
 *   POST   /api/memory/search    — Semantic search
 *   GET    /api/memory/stats     — Memory statistics
 *   GET    /api/memory/graph     — Knowledge graph query
 *   POST   /api/sessions         — Create session
 *   GET    /api/sessions         — List sessions
 *   GET    /api/sessions/:id     — Get session details
 *   DELETE /api/sessions/:id     — Delete session
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
                if (method === 'GET' && path === '/api/health') {
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

                        // Not found
                        return Response.json(
                            {
                                error: 'Not found', availableEndpoints: [
                                    'GET  /api/health',
                                    'POST /api/chat',
                                    'POST /api/chat/sync',
                                    'POST /api/memory/store',
                                    'POST /api/memory/search',
                                    'GET  /api/memory/stats?session_id=',
                                    'GET  /api/memory/graph?session_id=&q=',
                                    'POST /api/sessions',
                                    'GET  /api/sessions',
                                    'GET  /api/sessions/:id',
                                    'DELETE /api/sessions/:id',
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
