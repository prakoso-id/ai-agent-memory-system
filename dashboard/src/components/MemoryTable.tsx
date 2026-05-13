import { useState } from 'react';
import type { DashboardMemory } from '../lib/api.js';

interface MemoryTableProps {
    memories: DashboardMemory[];
    isLoading: boolean;
    onArchive:     (id: string) => Promise<void>;
    onDelete:      (id: string) => Promise<void>;
    onSetImportance: (id: string, v: number) => Promise<void>;
}

/**
 * MemoryTable — paginated table view of memories with inline action buttons.
 *
 * Columns: content (truncated), category, confidence, importance, usage, roles, conflict, actions
 * Actions: Archive | Delete | Importance slider (inline)
 */
export function MemoryTable({ memories, isLoading, onArchive, onDelete, onSetImportance }: MemoryTableProps) {
    const [editId, setEditId] = useState<string | null>(null);
    const [editVal, setEditVal] = useState<number>(0.5);
    const [busy, setBusy] = useState<string | null>(null);

    async function doAction(id: string, fn: () => Promise<void>) {
        setBusy(id);
        try { await fn(); } finally { setBusy(null); }
    }

    function confidenceColor(v: number): string {
        if (v >= 0.75) return 'var(--green)';
        if (v >= 0.4)  return 'var(--yellow)';
        return 'var(--red)';
    }

    function conflictBadge(status: string) {
        const colors: Record<string, string> = {
            none:        'var(--muted)',
            detected:    'var(--yellow)',
            hypothesis:  'var(--accent)',
            resolved:    'var(--green)',
            superseded:  'var(--red)',
        };
        return (
            <span style={{ ...styles.badge, background: colors[status] ?? 'var(--muted)' }}>
                {status}
            </span>
        );
    }

    if (isLoading) return <div style={{ color: 'var(--muted)', fontSize: 14, padding: 20 }}>Loading memories…</div>;
    if (memories.length === 0) return <div style={{ color: 'var(--muted)', fontSize: 14, padding: 20 }}>No memories match the current filters.</div>;

    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
                <thead>
                    <tr>
                        {['Content', 'Category', 'Confidence', 'Importance', 'Usage', 'Roles', 'Conflict', 'Actions'].map((h) => (
                            <th key={h} style={styles.th}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {memories.map((m) => (
                        <tr key={m.id} style={{ ...styles.row, opacity: m.archived ? 0.5 : 1 }}>
                            <td style={styles.td} title={m.content}>
                                {m.content.length > 72 ? m.content.substring(0, 70) + '…' : m.content}
                            </td>
                            <td style={{ ...styles.td, color: 'var(--accent)', fontSize: 12 }}>{m.category}</td>
                            <td style={{ ...styles.td, color: confidenceColor(m.confidence), fontWeight: 600 }}>
                                {m.confidence.toFixed(2)}
                            </td>
                            <td style={styles.td}>
                                {editId === m.id ? (
                                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        <input
                                            type="range" min={0} max={1} step={0.05}
                                            value={editVal}
                                            onChange={(e) => setEditVal(parseFloat(e.target.value))}
                                            style={{ width: 80 }}
                                        />
                                        <span style={{ fontSize: 12, minWidth: 28 }}>{editVal.toFixed(2)}</span>
                                        <button style={styles.btnSmallGreen} onClick={() => doAction(m.id, () => onSetImportance(m.id, editVal).then(() => setEditId(null)))}>✓</button>
                                        <button style={styles.btnSmall} onClick={() => setEditId(null)}>✕</button>
                                    </span>
                                ) : (
                                    <span style={{ cursor: 'pointer', textDecoration: 'underline dotted' }} onClick={() => { setEditId(m.id); setEditVal(m.importance); }}>
                                        {m.importance.toFixed(2)}
                                    </span>
                                )}
                            </td>
                            <td style={styles.td}>{m.usageCount}</td>
                            <td style={styles.td}>
                                {m.roles.length > 0
                                    ? m.roles.map((r) => <span key={r} style={{ ...styles.badge, background: 'var(--surface)', border: '1px solid var(--border)', marginRight: 3 }}>{r}</span>)
                                    : <span style={{ color: 'var(--muted)', fontSize: 12 }}>all</span>
                                }
                            </td>
                            <td style={styles.td}>{conflictBadge(m.conflictStatus)}</td>
                            <td style={styles.td}>
                                <span style={{ display: 'flex', gap: 6 }}>
                                    {!m.archived && (
                                        <button
                                            style={{ ...styles.btnSmall, opacity: busy === m.id ? 0.6 : 1 }}
                                            disabled={!!busy}
                                            onClick={() => doAction(m.id, () => onArchive(m.id))}
                                            title="Archive this memory"
                                        >Archive</button>
                                    )}
                                    <button
                                        style={{ ...styles.btnSmall, ...styles.btnDanger, opacity: busy === m.id ? 0.6 : 1 }}
                                        disabled={!!busy}
                                        onClick={() => { if (confirm('Hard-delete this memory?')) doAction(m.id, () => onDelete(m.id)); }}
                                        title="Permanently delete"
                                    >Delete</button>
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    table:         { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th:            { background: 'var(--surface)', color: 'var(--muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' },
    row:           { borderBottom: '1px solid var(--border)' },
    td:            { padding: '10px 12px', verticalAlign: 'middle', maxWidth: 300 },
    badge:         { display: 'inline-block', padding: '2px 7px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: '#0f1117' },
    btnSmall:      { background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer' },
    btnSmallGreen: { background: 'var(--green)', color: '#0f1117', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer' },
    btnDanger:     { background: '#3b1f1f', color: 'var(--red)' },
};
