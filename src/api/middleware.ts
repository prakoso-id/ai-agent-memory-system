import { config } from '../config/index.js';
import { db } from '../database/connections.js';

type Handler = (req: Request) => Promise<Response> | Response;

/**
 * Authentication middleware.
 * Validates Bearer token against configured API keys.
 */
export function withAuth(handler: Handler): Handler {
    return async (req: Request) => {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return Response.json(
                { error: 'Missing or invalid Authorization header. Use: Bearer <api_key>' },
                { status: 401 },
            );
        }

        const token = authHeader.slice(7);
        if (!config.server.apiKeys.includes(token)) {
            return Response.json({ error: 'Invalid API key' }, { status: 403 });
        }

        return handler(req);
    };
}

/**
 * CORS headers for all responses.
 * Returns empty object (no CORS headers) for unrecognized origins — BUG-001 fix.
 */
export function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('Origin') ?? '';
    if (!origin || !config.server.corsOrigins.includes(origin)) {
        return {};
    }
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
    };
}

/**
 * Handle CORS preflight requests.
 */
export function handlePreflight(req: Request): Response {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/**
 * Rate limiting middleware — Redis sliding window counter (SEC-001 / ENH-008).
 * Fails open if Redis is unavailable so a DB outage doesn't block all traffic.
 *
 * @param maxPerMinute Maximum requests per minute per API key (or IP as fallback).
 */
export function withRateLimit(maxPerMinute: number): (handler: Handler) => Handler {
    return (handler) => async (req) => {
        const auth = req.headers.get('Authorization') ?? '';
        const keyId = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers.get('X-Forwarded-For') ?? 'anon');
        const windowKey = `ratelimit:${keyId}:${Math.floor(Date.now() / 60_000)}`;
        try {
            const count = await db.redis.incr(windowKey);
            if (count === 1) await db.redis.expire(windowKey, 60);
            if (count > maxPerMinute) {
                return Response.json(
                    { error: 'Rate limit exceeded', retryAfter: 60 },
                    { status: 429, headers: { 'Retry-After': '60' } },
                );
            }
        } catch {
            // Redis unavailable — fail open, do not block traffic
        }
        return handler(req);
    };
}

/**
 * Log request details.
 */
export function logRequest(method: string, path: string, status: number, durationMs: number): void {
    const timestamp = new Date().toISOString();
    const statusIcon = status < 400 ? '✅' : '❌';
    console.log(`  ${statusIcon} [${timestamp}] ${method} ${path} → ${status} (${durationMs}ms)`);
}
