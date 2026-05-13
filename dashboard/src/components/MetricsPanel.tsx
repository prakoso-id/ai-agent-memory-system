import { useState } from 'react';
import type { DashboardMetrics, SemanticCacheStats } from '../lib/api.js';
import { api } from '../lib/api.js';

interface MetricsPanelProps {
    metrics?: DashboardMetrics;
    cacheStats?: SemanticCacheStats;
    advisories: string[];
    isLoading: boolean;
}

/**
 * MetricsPanel — displays Phase 4 operational metrics in a card grid.
 *
 * Metrics displayed:
 *   • Cache hit rate (bar indicator)
 *   • Avg retrieval latency p50
 *   • Conflict frequency per 100 memories
 *   • Promotion rate
 *   • Role distribution (small bar)
 *   • Self-healing advisories
 */
export function MetricsPanel({ metrics, cacheStats, advisories, isLoading }: MetricsPanelProps) {
    const [flushing, setFlushing] = useState(false);

    async function handleFlushCache() {
        if (!confirm('Flush entire semantic cache? This cannot be undone.')) return;
        setFlushing(true);
        try {
            await api.flushCache();
            alert('Cache flushed successfully.');
        } finally {
            setFlushing(false);
        }
    }

    if (isLoading) return <div style={styles.loading}>Loading metrics…</div>;

    const hitRatePct = metrics ? (metrics.cacheHitRate * 100).toFixed(1) : '—';
    const roles = metrics?.roleDistribution ?? {};

    return (
        <div style={styles.grid}>
            {/* Cache metrics */}
            <div style={styles.card}>
                <div style={styles.cardTitle}>Semantic Cache</div>
                <BarMetric label="Hit rate" value={metrics?.cacheHitRate ?? 0} pct={hitRatePct + '%'} color="var(--green)" />
                <StatRow label="Entries"      value={cacheStats?.totalEntries ?? '—'} />
                <StatRow label="Total hits"   value={cacheStats?.totalHits ?? '—'} />
                <StatRow label="Total misses" value={cacheStats?.totalMisses ?? '—'} />
                <StatRow label="Avg similarity on hit" value={cacheStats ? cacheStats.avgSimilarityOnHit.toFixed(3) : '—'} />
                <button
                    style={{ ...styles.btn, opacity: flushing ? 0.6 : 1, marginTop: 12 }}
                    onClick={handleFlushCache}
                    disabled={flushing}
                >
                    {flushing ? 'Flushing…' : 'Flush Cache'}
                </button>
            </div>

            {/* Retrieval latency */}
            <div style={styles.card}>
                <div style={styles.cardTitle}>Retrieval Latency</div>
                <div style={styles.bigStat}>
                    {metrics?.avgRetrievalLatencyMs?.toFixed(0) ?? '—'}
                    <span style={styles.unit}>ms p50</span>
                </div>
                <StatRow label="Conflict rate"  value={metrics ? metrics.conflictFrequency.toFixed(1) + '/100' : '—'} />
                <StatRow label="Promotion rate" value={metrics ? metrics.promotionRate.toFixed(1) + '/100' : '—'} />
            </div>

            {/* Role distribution */}
            <div style={styles.card}>
                <div style={styles.cardTitle}>Role Distribution</div>
                {Object.entries(roles).length === 0
                    ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>No role-tagged memories yet.</div>
                    : Object.entries(roles).map(([role, count]) => (
                        <StatRow key={role} label={role} value={count ?? 0} />
                    ))
                }
            </div>

            {/* Advisories */}
            <div style={{ ...styles.card, gridColumn: '1 / -1' }}>
                <div style={styles.cardTitle}>Self-Healing Advisories</div>
                {advisories.length === 0
                    ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>No advisories.</div>
                    : advisories.map((a, i) => (
                        <div key={i} style={styles.advisory}>💡 {a}</div>
                    ))
                }
            </div>
        </div>
    );
}

function BarMetric({ label, value, pct, color }: { label: string; value: number; pct: string; color: string }) {
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>{label}</span>
                <span style={{ fontWeight: 600, color }}>{pct}</span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 9999 }}>
                <div style={{ height: '100%', width: `${value * 100}%`, background: color, borderRadius: 9999, transition: 'width 0.5s' }} />
            </div>
        </div>
    );
}

function StatRow({ label, value }: { label: string; value: unknown }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBlock: 4, borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--muted)' }}>{label}</span>
            <span style={{ fontWeight: 500 }}>{String(value)}</span>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    grid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 },
    card:     { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 },
    cardTitle:{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--accent)' },
    bigStat:  { fontSize: 42, fontWeight: 800, lineHeight: 1, marginBottom: 16, color: 'var(--text)' },
    unit:     { fontSize: 14, fontWeight: 400, marginLeft: 4, color: 'var(--muted)' },
    advisory: { fontSize: 13, padding: '8px 12px', background: '#1e2035', borderRadius: 6, marginBottom: 6, lineHeight: 1.5 },
    btn:      { background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer' },
    loading:  { color: 'var(--muted)', fontSize: 14, padding: 20 },
};
