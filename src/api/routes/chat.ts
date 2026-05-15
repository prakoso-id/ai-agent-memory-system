import { SessionManager } from '../session-manager.js';
import { corsHeaders, extractApiKey } from '../middleware.js';
import { z } from 'zod';

const MAX_BODY_BYTES = 512 * 1024; // 512 KB

function checkBodySize(req: Request): Response | null {
    const contentLength = parseInt(req.headers.get('Content-Length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
        return Response.json({ error: 'Request body too large (max 512 KB)' }, { status: 413 });
    }
    return null;
}

const ChatBodySchema = z.object({
    session_id: z.string().uuid('session_id must be a UUID').optional(),
    message: z.string().min(1, 'message is required').max(32_768, 'message exceeds 32 768-character limit'),
});

/**
 * Chat API route handlers.
 * POST /api/chat      — SSE streaming response
 * POST /api/chat/sync — Full JSON response (non-streaming)
 */
export function chatRoutes(sessions: SessionManager) {
    return {
        /** SSE streaming chat */
        async stream(req: Request): Promise<Response> {
            const sizeError = checkBodySize(req);
            if (sizeError) return sizeError;

            const raw = await req.json().catch(() => null);
            const parsed = ChatBodySchema.safeParse(raw);
            if (!parsed.success) {
                return Response.json(
                    { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
                    { status: 400, headers: corsHeaders(req) },
                );
            }
            const body = parsed.data;
            const apiKey = extractApiKey(req);

            if (body.session_id) {
                const own = sessions.checkOwnership(body.session_id, apiKey);
                if (own === 'forbidden') {
                    return Response.json({ error: 'Access denied' }, { status: 403, headers: corsHeaders(req) });
                }
            }

            const { agent, sessionId } = sessions.getOrCreate(body.session_id, apiKey);

            const stream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    const send = (data: unknown) => {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                    };

                    try {
                        send({ type: 'session', sessionId });

                        for await (const event of agent.chatStream(body.message)) {
                            send(event);
                        }

                        sessions.trackInteraction(sessionId);
                    } catch (error) {
                        send({ type: 'error', message: String(error) });
                    } finally {
                        controller.close();
                    }
                },
            });

            return new Response(stream, {
                headers: {
                    ...corsHeaders(req),
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        },

        /** Non-streaming chat (full JSON response) */
        async sync(req: Request): Promise<Response> {
            const sizeError = checkBodySize(req);
            if (sizeError) return sizeError;

            const raw = await req.json().catch(() => null);
            const parsed = ChatBodySchema.safeParse(raw);
            if (!parsed.success) {
                return Response.json(
                    { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
                    { status: 400, headers: corsHeaders(req) },
                );
            }
            const body = parsed.data;
            const apiKey = extractApiKey(req);

            if (body.session_id) {
                const own = sessions.checkOwnership(body.session_id, apiKey);
                if (own === 'forbidden') {
                    return Response.json({ error: 'Access denied' }, { status: 403, headers: corsHeaders(req) });
                }
            }

            const { agent, sessionId } = sessions.getOrCreate(body.session_id, apiKey);
            const response = await agent.chat(body.message);
            sessions.trackInteraction(sessionId);

            return Response.json(
                { sessionId, response },
                { headers: corsHeaders(req) },
            );
        },
    };
}
