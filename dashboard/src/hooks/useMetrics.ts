import useSWR from 'swr';
import { api, type DashboardMetrics, type SemanticCacheStats } from '../lib/api.js';

/**
 * useMetrics — fetches DashboardMetrics + semantic cache stats + advisory messages.
 *
 * Polls every 20 s by default so the dashboard reflects near-real-time state.
 */
export function useMetrics(sessionId?: string, refreshInterval = 20_000) {
    const { data: metricsData, error: metricsError, isLoading: metricsLoading } =
        useSWR<{ metrics: DashboardMetrics }>(
            ['metrics', sessionId],
            () => api.getMetrics(sessionId),
            { refreshInterval },
        );

    const { data: cacheData, error: cacheError } =
        useSWR<{ cache: SemanticCacheStats }>(
            'cache-stats',
            () => api.getCacheStats(),
            { refreshInterval },
        );

    const { data: advisoriesData } =
        useSWR<{ advisories: string[] }>(
            ['advisories', sessionId],
            () => api.getAdvisories(sessionId),
            { refreshInterval: refreshInterval * 3 },   // less frequent — LLM-free
        );

    return {
        metrics:    metricsData?.metrics,
        cacheStats: cacheData?.cache,
        advisories: advisoriesData?.advisories ?? [],
        isLoading:  metricsLoading,
        error:      metricsError ?? cacheError,
    };
}
