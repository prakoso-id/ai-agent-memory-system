import type { AgentRole, ConflictStatus, MemoryListParams } from '../lib/api.js';

interface FilterBarProps {
    params: MemoryListParams;
    onChange: (next: MemoryListParams) => void;
}

const ROLES: Array<AgentRole | ''> = ['', 'coder', 'pm', 'qa', 'analyst', 'general'];
const CONFLICT_STATUSES: Array<ConflictStatus | ''> = [
    '', 'none', 'detected', 'hypothesis', 'resolved', 'superseded',
];

/**
 * FilterBar — controls for the memory list and graph query.
 *
 * Exposes:
 *   • Free-text topic search
 *   • Confidence range (min / max)
 *   • Agent role filter
 *   • Conflict status filter
 *   • Archive toggle
 */
export function FilterBar({ params, onChange }: FilterBarProps) {
    function update(patch: Partial<MemoryListParams>) {
        onChange({ ...params, ...patch, offset: 0 });
    }

    return (
        <div style={styles.bar}>
            {/* Topic search */}
            <label style={styles.group}>
                <span style={styles.label}>Topic</span>
                <input
                    style={styles.input}
                    type="text"
                    placeholder="e.g. webpack"
                    value={params.topic ?? ''}
                    onChange={(e) => update({ topic: e.target.value || undefined })}
                />
            </label>

            {/* Confidence range */}
            <label style={styles.group}>
                <span style={styles.label}>Min confidence</span>
                <input
                    style={{ ...styles.input, width: 72 }}
                    type="number"
                    min={0} max={1} step={0.05}
                    value={params.min_confidence ?? ''}
                    onChange={(e) => update({ min_confidence: e.target.value ? parseFloat(e.target.value) : undefined })}
                />
            </label>

            <label style={styles.group}>
                <span style={styles.label}>Max confidence</span>
                <input
                    style={{ ...styles.input, width: 72 }}
                    type="number"
                    min={0} max={1} step={0.05}
                    value={params.max_confidence ?? ''}
                    onChange={(e) => update({ max_confidence: e.target.value ? parseFloat(e.target.value) : undefined })}
                />
            </label>

            {/* Role */}
            <label style={styles.group}>
                <span style={styles.label}>Agent role</span>
                <select
                    style={styles.select}
                    value={params.agent_role ?? ''}
                    onChange={(e) => update({ agent_role: (e.target.value as AgentRole) || undefined })}
                >
                    {ROLES.map((r) => <option key={r} value={r}>{r || 'All roles'}</option>)}
                </select>
            </label>

            {/* Conflict status */}
            <label style={styles.group}>
                <span style={styles.label}>Conflict status</span>
                <select
                    style={styles.select}
                    value={params.conflict_status ?? ''}
                    onChange={(e) => update({ conflict_status: (e.target.value as ConflictStatus) || undefined })}
                >
                    {CONFLICT_STATUSES.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}
                </select>
            </label>

            {/* Archived toggle */}
            <label style={{ ...styles.group, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input
                    type="checkbox"
                    checked={params.archived ?? false}
                    onChange={(e) => update({ archived: e.target.checked ? true : undefined })}
                />
                <span style={styles.label}>Show archived</span>
            </label>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    bar:    { display: 'flex', flexWrap: 'wrap', gap: 16, padding: '16px 0', alignItems: 'flex-end' },
    group:  { display: 'flex', flexDirection: 'column', gap: 4 },
    label:  { fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' },
    input:  { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 13, outline: 'none', width: 180 },
    select: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 13, outline: 'none' },
};
