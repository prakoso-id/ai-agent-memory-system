import useSWR from 'swr';
import { api, type DashboardGraph } from '../lib/api.js';

/**
 * useMemoryGraph — fetches Neo4j knowledge graph for the graph visualisation.
 *
 * Re-fetches whenever `query` changes or every `refreshInterval` ms.
 */
export function useMemoryGraph(query = '', limit = 80, refreshInterval = 30_000) {
    const { data, error, isLoading, mutate } = useSWR<DashboardGraph>(
        ['graph', query, limit],
        () => api.getGraph(query, limit),
        { refreshInterval, revalidateOnFocus: false },
    );

    return {
        graph:     data ?? { nodes: [], edges: [] },
        isLoading,
        error,
        refresh:   mutate,
    };
}
