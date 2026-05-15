import { SessionManager } from '../session-manager.js';
import { corsHeaders, extractApiKey } from '../middleware.js';
import { z } from 'zod';

const CreateSessionSchema = z.object({
    session_id: z.string().uuid('session_id must be a UUID').optional(),
});

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
            const raw = await req.json().catch(() => ({}));
            const parsed = CreateSessionSchema.safeParse(raw);
            if (!parsed.success) {
                return Response.json(
                    { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
                    { status: 400, headers: corsHeaders(req) },
                );
            }
            const apiKey = extractApiKey(req);
            const { sessionId } = sessions.createSession(parsed.data.session_id, apiKey);
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
            const apiKey = extractApiKey(req);
            const own = sessions.checkOwnership(sessionId, apiKey);
            if (own === 'not_found') {
                return Response.json({ error: `Session ${sessionId} not found` }, { status: 404, headers: corsHeaders(req) });
            }
            if (own === 'forbidden') {
                return Response.json({ error: 'Access denied' }, { status: 403, headers: corsHeaders(req) });
            }

            const agent = sessions.getSession(sessionId)!;
            const stats = await agent.getStats();
            const info = sessions.listSessions().find((s) => s.sessionId === sessionId);

            return Response.json(
                { ...info, stats },
                { headers: corsHeaders(req) },
            );
        },

        /** Delete a session */
        async remove(req: Request, sessionId: string): Promise<Response> {
            const apiKey = extractApiKey(req);
            const own = sessions.checkOwnership(sessionId, apiKey);
            if (own === 'not_found') {
                return Response.json({ error: `Session ${sessionId} not found` }, { status: 404, headers: corsHeaders(req) });
            }
            if (own === 'forbidden') {
                return Response.json({ error: 'Access denied' }, { status: 403, headers: corsHeaders(req) });
            }
            sessions.deleteSession(sessionId);
            return Response.json(
                { deleted: true, sessionId },
                { headers: corsHeaders(req) },
            );
        },
    };
}
