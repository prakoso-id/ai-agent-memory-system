import { SessionManager } from '../session-manager.js';
import { corsHeaders } from '../middleware.js';

/**
 * Session API route handlers.
 * POST   /api/sessions     — Create a new session
 * GET    /api/sessions     — List active sessions
 * GET    /api/sessions/:id — Get session details
 * DELETE /api/sessions/:id — Delete a session
 */
export function sessionRoutes(sessions: SessionManager) {
    return {
        /** Create a new session */
        async create(req: Request): Promise<Response> {
            const body = await req.json().catch(() => ({})) as { session_id?: string };
            const { sessionId } = sessions.createSession(body.session_id);
            return Response.json(
                { sessionId, created: true },
                { status: 201, headers: corsHeaders(req) },
            );
        },

        /** List all active sessions */
        async list(req: Request): Promise<Response> {
            const list = sessions.listSessions();
            return Response.json(
                { count: list.length, sessions: list },
                { headers: corsHeaders(req) },
            );
        },

        /** Get session details */
        async get(req: Request, sessionId: string): Promise<Response> {
            const agent = sessions.getSession(sessionId);
            if (!agent) {
                return Response.json(
                    { error: `Session ${sessionId} not found` },
                    { status: 404, headers: corsHeaders(req) },
                );
            }

            const stats = await agent.getStats();
            const info = sessions.listSessions().find((s) => s.sessionId === sessionId);

            return Response.json(
                { ...info, stats },
                { headers: corsHeaders(req) },
            );
        },

        /** Delete a session */
        async remove(req: Request, sessionId: string): Promise<Response> {
            const deleted = sessions.deleteSession(sessionId);
            if (!deleted) {
                return Response.json(
                    { error: `Session ${sessionId} not found` },
                    { status: 404, headers: corsHeaders(req) },
                );
            }
            return Response.json(
                { deleted: true, sessionId },
                { headers: corsHeaders(req) },
            );
        },
    };
}
