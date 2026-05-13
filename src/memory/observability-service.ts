import { db } from '../database/connections.js';
import { config } from '../config/index.js';
import type { DashboardMetrics, LatencySample } from './types.js';

/**
 * Observability Service â€” Phase 4 / Enhancement 1 (metrics backend).
 *
 * Captures and exposes operational metrics used by:
 *   â€¢ The dashboard Metrics Panel (via GET /api/dashboard/metrics)
 *   â€¢ Bonus evaluation tracking (cache hit rate, conflict frequency,
 *     retrieval latency p50)
 *
 * All data survives in Redis with a configurable ring-buffer size so that
 * the dashboard always reflects recent system behaviour.
 */
export class ObservabilityService {
    private readonly latencyKey   = config.observability.latencyKey;
    private readonly bufferSize   = config.observability.latencyBufferSize;
    private readonly cacheCounter = config.observability.cacheCounterKey;

    // =====================================================================
    // LATENCY TRACKING
    // =====================================================================

    /**
     * Record a single retrieval latency sample.
     * Uses a Redis List as a fixed-size ring buffer (LPUSH + LTRIM).
     */
    async recordLatency(sample: Omit<LatencySample, 'timestamp'>): Promise<void> {
        const entry: LatencySample = { ...sample, timestamp: new Date().toISOString() };
        await db.redis.lpush(this.latencyKey, JSON.stringify(entry));
        await db.redis.ltrim(this.latencyKey, 0, this.bufferSize - 1);
    }

    /**
     * Compute the p50 (median) latency for a given source from the buffer.
     */
    async getP50LatencyMs(source?: 'cache' | 'retrieval'): Promise<number> {
        const raw = await db.redis.lrange(this.latencyKey, 0, -1);
        const samples: LatencySample[] = raw
            .map((s) => {
                try { return JSON.parse(s) as LatencySample; } catch { return null; }
            })
            .filter((s): s is LatencySample => s !== null && (!source || s.source === source));

        if (samples.length === 0) return 0;

        const sorted = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted[mid] ?? 0;
    }

    // =====================================================================
    // METRICS AGGREGATION
    // =====================================================================

    /**
     * Build the full DashboardMetrics snapshot.
     * Called by GET /api/dashboard/metrics and surfaced to the dashboard.
     */
    async getMetrics(deps: {
        conflictCount: number;
        semanticCount: number;
        promotionCount: number;
        episodicCount: number;
        roleDistribution: Partial<Record<string, number>>;
        cacheEntries: number;
    }): Promise<DashboardMetrics> {
        const [hits, misses, p50] = await Promise.all([
            db.redis.hget(this.cacheCounter, 'hits').then(v => parseInt(v ?? '0')),
            db.redis.hget(this.cacheCounter, 'misses').then(v => parseInt(v ?? '0')),
            this.getP50LatencyMs('retrieval'),
        ]);

        const total = hits + misses;

        return {
            cacheHitRate:          total > 0 ? hits / total : 0,
            cacheEntries:          deps.cacheEntries,
            avgRetrievalLatencyMs: p50,
            conflictFrequency:     deps.semanticCount > 0
                ? (deps.conflictCount / deps.semanticCount) * 100
                : 0,
            promotionRate:         deps.episodicCount > 0
                ? (deps.promotionCount / deps.episodicCount) * 100
                : 0,
            roleDistribution:      deps.roleDistribution as Partial<Record<import('./types.js').AgentRole, number>>,
        };
    }

    // =====================================================================
    // IMPROVEMENT SUGGESTIONS (Bonus)
    // =====================================================================

    /**
     * Generate self-healing memory suggestions based on current metrics.
     * Returns an array of human-readable advisory strings for the dashboard.
     */
    generateAdvisories(metrics: DashboardMetrics): string[] {
        const advisories: string[] = [];

        if (metrics.cacheHitRate < 0.3 && metrics.cacheEntries > 50) {
            advisories.push(
                'Cache hit rate is low (<30%). Consider lowering CACHE_SIMILARITY_THRESHOLD ' +
                'from 0.95 â†’ 0.90 to accept more semantic matches.',
            );
        }

        if (metrics.conflictFrequency > 10) {
            advisories.push(
                `High conflict frequency (${metrics.conflictFrequency.toFixed(1)} per 100 memories). ` +
                'Run hypothesis resolution cycle or tighten CONFLICT_SIMILARITY_THRESHOLD.',
            );
        }

        if (metrics.avgRetrievalLatencyMs > 500) {
            advisories.push(
                `Retrieval p50 latency is high (${metrics.avgRetrievalLatencyMs}ms). ` +
                'Consider enabling semantic caching and reducing MEMORY_RETRIEVAL_LIMIT.',
            );
        }

        if (metrics.promotionRate < 1) {
            advisories.push(
                'Promotion rate is very low â€” episodic memories are rarely promoted to semantic. ' +
                'Consider reducing PROMOTION_USAGE_THRESHOLD or interaction frequency.',
            );
        }

        if (advisories.length === 0) {
            advisories.push('System health looks good. No immediate improvements recommended.');
        }

        return advisories;
    }

    /**
     * Emit a structured log event for important memory lifecycle transitions.
     * In production this would fan out to a structured logger (e.g. Pino, OTLP).
     */
    logEvent(event: {
        type: 'cache_hit' | 'cache_miss' | 'conflict_detected' | 'memory_promoted' | 'role_query';
        data: Record<string, unknown>;
    }): void {
        const ts = new Date().toISOString();
        console.log(`  ðŸ“Š [Observability] ${ts} event=${event.type} ${JSON.stringify(event.data)}`);
    }
}

/** Singleton instance shared across the application */
export const observabilityService = new ObservabilityService();
