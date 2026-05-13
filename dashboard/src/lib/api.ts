/**
 * API client — thin typed wrapper over the dashboard backend endpoints.
 *
 * All functions throw on non-2xx responses (callers should wrap in try/catch
 * or rely on SWR's error state).
 *
 * Configuration: set VITE_API_URL and VITE_API_KEY in dashboard/.env
 * Default: API at http://localhost:3001, proxied via Vite dev server /api.
 */

const BASE   = import.meta.env.VITE_API_URL ?? '';
const API_KEY = import.meta.env.VITE_API_KEY ?? 'dev-key-change-me';

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`,
            ...init?.headers,
        },
    });
    if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`API ${path} → ${res.status}: ${msg}`);
    }
    return res.json() as Promise<T>;
}

// ---- Types (local mirrors of backend types) ----

export type AgentRole = 'coder' | 'pm' | 'qa' | 'analyst' | 'general';
export type ConflictStatus = 'none' | 'detected' | 'hypothesis' | 'resolved' | 'superseded';

export interface DashboardMemory {
    id: string;
    content: string;
    category: string;
    source: string;
    importance: number;
    confidence: number;
    usageCount: number;
    tags: string[];
    roles: AgentRole[];
    conflictStatus: ConflictStatus;
    archived: boolean;
    timestamp: string;
    lastAccessed: string;
}

export interface DashboardGraphNode {
    id: string;
    label: string;
    name: string;
    confidence?: number;
    roles?: AgentRole[];
    importance: number;
    usageCount: number;
    timestamp: string;
}

export interface DashboardGraphEdge {
    id: string;
    source: string;
    target: string;
    relationship: string;
    weight: number;
}

export interface DashboardGraph {
    nodes: DashboardGraphNode[];
    edges: DashboardGraphEdge[];
}

export interface DashboardMetrics {
    cacheHitRate: number;
    cacheEntries: number;
    avgRetrievalLatencyMs: number;
    conflictFrequency: number;
    promotionRate: number;
    roleDistribution: Partial<Record<AgentRole, number>>;
}

export interface SemanticCacheStats {
    totalEntries: number;
    hitRate: number;
    totalHits: number;
    totalMisses: number;
    avgSimilarityOnHit: number;
}

export interface MemoryListParams {
    topic?: string;
    min_confidence?: number;
    max_confidence?: number;
    conflict_status?: ConflictStatus;
    agent_role?: AgentRole;
    archived?: boolean;
    limit?: number;
    offset?: number;
    session_id?: string;
}

// ---- API Functions ----

export const api = {
    // Metrics
    getMetrics: (sessionId?: string) =>
        fetchJSON<{ metrics: DashboardMetrics }>(
            `/api/dashboard/metrics${sessionId ? `?session_id=${sessionId}` : ''}`,
        ),

    getAdvisories: (sessionId?: string) =>
        fetchJSON<{ advisories: string[] }>(
            `/api/dashboard/advisories${sessionId ? `?session_id=${sessionId}` : ''}`,
        ),

    // Graph
    getGraph: (q = '', limit = 80) =>
        fetchJSON<DashboardGraph>(`/api/dashboard/graph?q=${encodeURIComponent(q)}&limit=${limit}`),

    // Memories
    listMemories: (params: MemoryListParams = {}) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) qs.set(k, String(v));
        }
        return fetchJSON<{ memories: DashboardMemory[]; total: number }>(
            `/api/dashboard/memories?${qs.toString()}`,
        );
    },

    updateMemory: (id: string, patch: {
        importance?: number;
        archived?: boolean;
        role_importance?: { role: AgentRole; value: number };
        session_id?: string;
    }) =>
        fetchJSON<{ updated: boolean }>(`/api/dashboard/memories/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        }),

    deleteMemory: (id: string, sessionId?: string) =>
        fetchJSON<{ deleted: boolean }>(
            `/api/dashboard/memories/${id}${sessionId ? `?session_id=${sessionId}` : ''}`,
            { method: 'DELETE' },
        ),

    // Cache
    getCacheStats: () =>
        fetchJSON<{ cache: SemanticCacheStats }>('/api/dashboard/cache/stats'),

    flushCache: () =>
        fetchJSON<{ flushed: boolean }>('/api/dashboard/cache', { method: 'DELETE' }),

    invalidateCacheEntry: (entryId: string) =>
        fetchJSON<{ invalidated: boolean }>(`/api/dashboard/cache/${entryId}`, { method: 'DELETE' }),

    // Roles
    getRoleMemories: (role: AgentRole, limit = 50, sessionId?: string) => {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (sessionId) qs.set('session_id', sessionId);
        return fetchJSON<{ role: AgentRole; memories: DashboardMemory[]; total: number }>(
            `/api/dashboard/roles/${role}/memories?${qs.toString()}`,
        );
    },

    // Legacy stats
    getStats: (sessionId: string) =>
        fetchJSON<Record<string, number>>(`/api/memory/stats?session_id=${sessionId}`),
};
