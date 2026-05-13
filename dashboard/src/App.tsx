import { useState } from 'react';
import type { MemoryListParams, DashboardGraphNode } from './lib/api.js';
import { useMemoryGraph }  from './hooks/useMemoryGraph.js';
import { useMemoryList }   from './hooks/useMemoryList.js';
import { useMetrics }      from './hooks/useMetrics.js';
import { GraphView }       from './components/GraphView.js';
import { MemoryTable }     from './components/MemoryTable.js';
import { MetricsPanel }    from './components/MetricsPanel.js';
import { FilterBar }       from './components/FilterBar.js';
import { MemoryTimeline }  from './components/MemoryTimeline.js';

type Tab = 'graph' | 'memories' | 'timeline' | 'metrics';

/**
 * App — root component of the Agent Memory Dashboard.
 *
 * Tab layout:
 *   Graph     — D3 force-directed Neo4j graph
 *   Memories  — filterable table with archive/delete/importance actions
 *   Timeline  — chronological evolution view
 *   Metrics   — Phase 4 observability panel + cache management + advisories
 */
export default function App() {
    const [tab, setTab]       = useState<Tab>('graph');
    const [graphQ, setGraphQ] = useState('');
    const [filters, setFilters] = useState<MemoryListParams>({ limit: 50 });
    const [selectedNode, setSelectedNode] = useState<DashboardGraphNode | null>(null);

    const { graph, isLoading: graphLoading } = useMemoryGraph(graphQ);
    const { memories, isLoading: memLoading, archive, remove, setImportance } = useMemoryList(filters);
    const { metrics, cacheStats, advisories, isLoading: metLoading } = useMetrics();

    return (
        <div style={styles.root}>
            {/* Header */}
            <header style={styles.header}>
                <div style={styles.logo}>
                    <span style={styles.logoIcon}>🧠</span>
                    <span>Agent Memory Dashboard</span>
                </div>
                <div style={styles.nav}>
                    {(['graph', 'memories', 'timeline', 'metrics'] as Tab[]).map((t) => (
                        <button
                            key={t}
                            style={{ ...styles.navBtn, ...(tab === t ? styles.navActive : {}) }}
                            onClick={() => setTab(t)}
                        >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </header>

            {/* Body */}
            <main style={styles.main}>
                {/* ── Graph Tab ── */}
                {tab === 'graph' && (
                    <div>
                        <div style={styles.sectionHeader}>
                            <h2 style={styles.sectionTitle}>Knowledge Graph</h2>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input
                                    style={styles.searchInput}
                                    type="text"
                                    placeholder="Filter graph by keyword…"
                                    value={graphQ}
                                    onChange={(e) => setGraphQ(e.target.value)}
                                />
                                <span style={styles.counter}>
                                    {graph.nodes.length} nodes · {graph.edges.length} edges
                                </span>
                            </div>
                        </div>
                        {graphLoading
                            ? <div style={styles.loadingMsg}>Loading graph…</div>
                            : <GraphView graph={graph} height={560} onNodeClick={setSelectedNode} />
                        }
                        {selectedNode && (
                            <div style={styles.nodeDetail}>
                                <strong>{selectedNode.name}</strong>
                                <span style={{ color: 'var(--muted)' }}>[{selectedNode.label}]</span>
                                <span>importance {selectedNode.importance.toFixed(2)}</span>
                                <span>usage {selectedNode.usageCount}</span>
                                {selectedNode.confidence !== undefined && (
                                    <span>confidence {selectedNode.confidence.toFixed(2)}</span>
                                )}
                                <button style={styles.closeBtn} onClick={() => setSelectedNode(null)}>✕</button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Memories Tab ── */}
                {tab === 'memories' && (
                    <div>
                        <h2 style={styles.sectionTitle}>Memory Browser</h2>
                        <FilterBar params={filters} onChange={setFilters} />
                        <MemoryTable
                            memories={memories}
                            isLoading={memLoading}
                            onArchive={archive}
                            onDelete={remove}
                            onSetImportance={setImportance}
                        />
                    </div>
                )}

                {/* ── Timeline Tab ── */}
                {tab === 'timeline' && (
                    <div>
                        <h2 style={styles.sectionTitle}>Memory Evolution Timeline</h2>
                        <FilterBar params={filters} onChange={setFilters} />
                        <div style={{ marginTop: 24 }}>
                            <MemoryTimeline memories={memories} />
                        </div>
                    </div>
                )}

                {/* ── Metrics Tab ── */}
                {tab === 'metrics' && (
                    <div>
                        <h2 style={styles.sectionTitle}>Observability & Metrics</h2>
                        <MetricsPanel
                            metrics={metrics}
                            cacheStats={cacheStats}
                            advisories={advisories}
                            isLoading={metLoading}
                        />
                    </div>
                )}
            </main>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    root:        { minHeight: '100vh', display: 'flex', flexDirection: 'column' },
    header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 28px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', gap: 24, flexWrap: 'wrap' },
    logo:        { display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 18, color: 'var(--text)' },
    logoIcon:    { fontSize: 22 },
    nav:         { display: 'flex', gap: 4 },
    navBtn:      { background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 14, fontWeight: 600, padding: '6px 16px', borderRadius: 6, cursor: 'pointer' },
    navActive:   { background: '#2d2f4d', color: 'var(--accent)' },
    main:        { flex: 1, padding: '28px 32px', maxWidth: 1400, width: '100%', margin: '0 auto' },
    sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
    sectionTitle:  { fontSize: 20, fontWeight: 800 },
    searchInput: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '7px 12px', fontSize: 13, outline: 'none', width: 220 },
    counter:     { display: 'flex', alignItems: 'center', fontSize: 13, color: 'var(--muted)' },
    loadingMsg:  { color: 'var(--muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' },
    nodeDetail:  { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', marginTop: 12, fontSize: 13 },
    closeBtn:    { marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16 },
};
