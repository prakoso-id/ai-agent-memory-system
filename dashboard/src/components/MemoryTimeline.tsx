import type { DashboardMemory } from '../lib/api.js';

interface MemoryTimelineProps {
    memories: DashboardMemory[];
}

/**
 * MemoryTimeline — chronological evolution view.
 *
 * Renders a vertical timeline where each event shows:
 *   • Timestamp → human-readable relative age
 *   • Confidence band (coloured bar that reflects the confidence at that time)
 *   • Content snippet
 *   • Status pill: archived / conflict / active
 *
 * For a full evolution view, the backend would need to store historical
 * confidence snapshots. This component shows the current-state timeline
 * sorted by `lastAccessed` descending — the closest approximation available
 * without a dedicated audit log.
 */
export function MemoryTimeline({ memories }: MemoryTimelineProps) {
    if (memories.length === 0) {
        return (
            <div style={{ color: 'var(--muted)', fontSize: 14, padding: '20px 0' }}>
                No memories to display. Apply a different filter or interact with the agent first.
            </div>
        );
    }

    const sorted = [...memories].sort(
        (a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime(),
    );

    return (
        <div style={styles.container}>
            {sorted.map((m, idx) => (
                <TimelineItem key={m.id} memory={m} isLast={idx === sorted.length - 1} />
            ))}
        </div>
    );
}

function TimelineItem({ memory, isLast }: { memory: DashboardMemory; isLast: boolean }) {
    const age = relativeTime(memory.lastAccessed);
    const conf = memory.confidence;
    const confColor = conf >= 0.75 ? 'var(--green)' : conf >= 0.4 ? 'var(--yellow)' : 'var(--red)';

    let statusLabel = 'active';
    let statusColor = 'var(--green)';
    if (memory.archived)                   { statusLabel = 'archived'; statusColor = 'var(--muted)'; }
    else if (memory.conflictStatus !== 'none') { statusLabel = memory.conflictStatus; statusColor = 'var(--yellow)'; }

    return (
        <div style={styles.item}>
            {/* Timeline spine */}
            <div style={styles.spine}>
                <div style={{ ...styles.dot, background: confColor }} />
                {!isLast && <div style={styles.line} />}
            </div>

            {/* Content */}
            <div style={styles.content}>
                <div style={styles.header}>
                    <span style={styles.age}>{age}</span>
                    <span style={{ ...styles.status, color: statusColor }}>{statusLabel}</span>
                    <span style={{ ...styles.status, color: confColor }}>conf {conf.toFixed(2)}</span>
                    <span style={styles.category}>{memory.category}</span>
                </div>

                {/* Confidence band */}
                <div style={styles.confBar}>
                    <div style={{ width: `${conf * 100}%`, height: '100%', background: confColor, borderRadius: 9999, transition: 'width 0.4s' }} />
                </div>

                <div style={styles.text}>
                    {memory.content.length > 140 ? memory.content.substring(0, 138) + '…' : memory.content}
                </div>

                {memory.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                        {memory.tags.map((t) => (
                            <span key={t} style={styles.tag}>{t}</span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1)   return 'just now';
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

const styles: Record<string, React.CSSProperties> = {
    container: { display: 'flex', flexDirection: 'column', gap: 0 },
    item:      { display: 'flex', gap: 16 },
    spine:     { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0 },
    dot:       { width: 12, height: 12, borderRadius: '50%', marginTop: 14, flexShrink: 0 },
    line:      { width: 2, flex: 1, background: 'var(--border)', marginTop: 4, marginBottom: 4 },
    content:   { flex: 1, paddingBottom: 24 },
    header:    { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' },
    age:       { fontSize: 12, color: 'var(--muted)', fontWeight: 600 },
    status:    { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' },
    category:  { fontSize: 11, color: 'var(--accent)', background: '#1e2035', padding: '2px 7px', borderRadius: 12 },
    confBar:   { height: 4, background: 'var(--border)', borderRadius: 9999, marginBottom: 8 },
    text:      { fontSize: 13, color: 'var(--text)', lineHeight: 1.5 },
    tag:       { fontSize: 11, background: 'var(--border)', color: 'var(--muted)', padding: '1px 6px', borderRadius: 9999 },
};
