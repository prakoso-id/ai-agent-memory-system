import { config } from '../config/index.js';

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
 */
export function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('Origin') ?? '';
    const allowed = config.server.corsOrigins.includes(origin) ? origin : config.server.corsOrigins[0]!;

    return {
        'Access-Control-Allow-Origin': allowed,
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
 * Log request details.
 */
export function logRequest(method: string, path: string, status: number, durationMs: number): void {
    const timestamp = new Date().toISOString();
    const statusIcon = status < 400 ? '✅' : '❌';
    console.log(`  ${statusIcon} [${timestamp}] ${method} ${path} → ${status} (${durationMs}ms)`);
}
