import useSWR from 'swr';
import { api, type DashboardMemory, type MemoryListParams } from '../lib/api.js';

/**
 * useMemoryList — paginated memory list with filter support.
 *
 * Returns the raw list plus helpers for updating / archiving / deleting
 * individual memories, with optimistic cache invalidation.
 */
export function useMemoryList(params: MemoryListParams = {}, refreshInterval = 15_000) {
    const key = ['memories', JSON.stringify(params)];

    const { data, error, isLoading, mutate } = useSWR<{ memories: DashboardMemory[]; total: number }>(
        key,
        () => api.listMemories(params),
        { refreshInterval, revalidateOnFocus: false },
    );

    async function archive(id: string) {
        await api.updateMemory(id, { archived: true });
        await mutate();
    }

    async function remove(id: string) {
        await api.deleteMemory(id);
        await mutate();
    }

    async function setImportance(id: string, importance: number) {
        await api.updateMemory(id, { importance });
        await mutate();
    }

    return {
        memories:     data?.memories ?? [],
        total:        data?.total ?? 0,
        isLoading,
        error,
        refresh:      mutate,
        archive,
        remove,
        setImportance,
    };
}
