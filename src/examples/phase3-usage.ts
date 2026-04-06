/**
 * Phase 3 Usage Example — Memory Evolution & Evaluation
 *
 * Demonstrates:
 *   1. Conflict detection when user changes preference
 *   2. Confidence evolution over interactions
 *   3. Hypothesis tracking for ambiguous information
 *   4. Evaluation metrics tracking
 *   5. Memory promotion lifecycle
 *   6. Decay and archival of stale memories
 *
 * Run: bun run example:phase3
 */

import { MemoryManager } from '../memory/memory-manager.js';
import { initializeDatabase } from '../database/init.js';
import { db } from '../database/connections.js';

async function main() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Phase 3: Memory Evolution & Evaluation — Example        ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    await initializeDatabase();
    const memory = new MemoryManager('phase3-demo');

    // ─────────────────────────────────────────────────────────────────────
    // 1. Conflict Detection
    // ─────────────────────────────────────────────────────────────────────
    console.log('━━━ 1. Conflict Detection ━━━');
    console.log('Storing contradictory user preferences...\n');

    // Store original preference
    const pref1 = await memory.semantic.store({
        content: 'User prefers dark mode and Vim keybindings',
        category: 'user_preference',
        source: 'episode:demo-1',
        importance: 0.8,
        tags: ['preference', 'ui'],
        metadata: {},
    });
    console.log(`  📝 Stored: "${pref1?.content}"\n`);

    // Store contradictory preference (user changed their mind)
    const pref2 = await memory.semantic.store({
        content: 'User switched to light mode and VS Code keybindings',
        category: 'user_preference',
        source: 'episode:demo-2',
        importance: 0.8,
        tags: ['preference', 'ui'],
        metadata: {},
    });
    console.log(`  📝 Stored: "${pref2?.content}"\n`);

    // Detect conflicts
    if (pref1 && pref2) {
        const similar = await memory.semantic.search(pref2.content, {
            limit: 5,
            minScore: 0.3,
        });
        const conflicts = await memory.conflicts.detectConflicts(pref2, similar);
        console.log(`  ⚡ Conflicts detected: ${conflicts.length}`);
        for (const c of conflicts) {
            console.log(`     Type: ${c.conflict_type} — "${c.description}"`);
        }

        // Create hypothesis if conflicts found
        for (const conflict of conflicts) {
            if (conflict.conflict_type === 'contradictory') {
                const hypothesis = await memory.hypotheses.createFromConflict(
                    conflict,
                    pref1.content,
                    pref2.content,
                );
                console.log(`  🔬 Hypothesis created: "${hypothesis.topic}"`);
                console.log(`     Perspectives: ${hypothesis.perspectives.length}`);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Confidence System
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n━━━ 2. Confidence Scoring ━━━');

    if (pref1) {
        // Compute confidence for the original preference
        const conf = await memory.confidence.computeConfidence(
            pref1.id,
            pref1.usage_count,
            pref1.source,
            pref1.timestamp,
        );
        console.log(`  📊 Confidence for "${pref1.content.substring(0, 40)}…":`);
        console.log(`     Overall:     ${conf.overall.toFixed(3)}`);
        console.log(`     Usage:       ${conf.usage_signal.toFixed(3)}`);
        console.log(`     Consistency: ${conf.consistency_signal.toFixed(3)}`);
        console.log(`     Source:      ${conf.source_reliability.toFixed(3)}`);
        console.log(`     Recency:     ${conf.recency_signal.toFixed(3)}`);

        // Update Qdrant with the computed confidence
        await memory.semantic.updateConfidence(pref1.id, conf.overall);
    }

    // Compare confidence tiers
    console.log('\n  📊 Source reliability tiers:');
    const sources = ['api', 'direct', 'reflection', 'episode:abc', 'unknown'];
    for (const src of sources) {
        const rel = memory.confidence.getSourceReliability(src);
        console.log(`     ${src.padEnd(15)} → ${rel.toFixed(2)}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Evaluation Tracking
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n━━━ 3. Evaluation Tracking ━━━');

    // Record some evaluations
    await memory.evaluations.recordEvaluation(
        'q-001', 'What UI theme does the user prefer?',
        [pref1?.id ?? 'unknown', pref2?.id ?? 'unknown'],
        true, 0.75,
    );
    await memory.evaluations.recordEvaluation(
        'q-002', 'What database does the project use?',
        [], false, 0,
    );
    await memory.evaluations.recordEvaluation(
        'q-003', 'User keybinding preference',
        [pref2?.id ?? 'unknown'],
        true, 1.0, 0.9,
    );

    const metrics = await memory.evaluations.getMetrics(7);
    console.log(`  📈 Evaluation metrics (last 7 days):`);
    console.log(`     Total queries:       ${metrics.total_queries}`);
    console.log(`     Avg hit rate:        ${(metrics.avg_hit_rate * 100).toFixed(1)}%`);
    console.log(`     Success rate:        ${(metrics.retrieval_success_rate * 100).toFixed(1)}%`);
    console.log(`     Avg usefulness:      ${(metrics.avg_usefulness * 100).toFixed(1)}%`);

    const trend = await memory.evaluations.getTrend(7);
    console.log(`     Trend:               ${trend.improving ? '📈 Improving' : '📉 Declining'} (Δ${trend.delta})`);

    // ─────────────────────────────────────────────────────────────────────
    // 4. Memory Promotion
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n━━━ 4. Memory Promotion ━━━');

    // Store an episode that qualifies for promotion
    const episode = await memory.episodic.store({
        eventType: 'conversation',
        sessionId: 'phase3-demo',
        content: 'User: I always use PostgreSQL for relational data\nAssistant: Noted! PostgreSQL is great for complex queries.',
        importance: 0.8,
        tags: ['database', 'preference'],
        metadata: {},
    });

    // Simulate high usage
    for (let i = 0; i < 7; i++) {
        await db.pg.query(
            `UPDATE episodic_memories
             SET usage_count = usage_count + 1
             WHERE id = $1`,
            [episode.id],
        );
    }

    const eligible = memory.promoter.isEpisodicPromotionEligible(7, 0.8);
    console.log(`  🎯 Episode eligible for promotion: ${eligible}`);

    if (eligible) {
        const newSemanticId = await memory.promoter.promoteEpisodicToSemantic(episode.id);
        if (newSemanticId) {
            console.log(`  ⬆️  Promoted to semantic memory (id: ${newSemanticId.substring(0, 8)}…)`);
        }
    }

    // Check promotion history
    const history = await memory.promoter.getPromotionHistory();
    console.log(`  📋 Promotion history: ${history.length} events`);

    // ─────────────────────────────────────────────────────────────────────
    // 5. Full System Stats
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n━━━ 5. System Stats (Phase 1 + 2 + 3) ━━━');

    const stats = await memory.getStats();
    console.log(`  📊 Memory System Statistics:`);
    for (const [key, value] of Object.entries(stats)) {
        console.log(`     ${key.padEnd(15)} ${value}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n━━━ Cleanup ━━━');
    if (pref1) await memory.semantic.delete(pref1.id);
    if (pref2) await memory.semantic.delete(pref2.id);
    await db.pg.query(`DELETE FROM episodic_memories WHERE session_id = 'phase3-demo'`);
    await db.pg.query(`DELETE FROM evaluation_records WHERE query_id IN ('q-001','q-002','q-003')`);
    await db.pg.query(`DELETE FROM evaluation_records WHERE query_id LIKE 'hypothesis:%'`);
    await db.pg.query(`DELETE FROM memory_conflicts WHERE memory_id_a = $1 OR memory_id_b = $1`, [pref1?.id ?? '']);
    await db.pg.query(`DELETE FROM promotion_events WHERE memory_id = $1`, [episode.id]);
    console.log('  ✅ Cleaned up demo data\n');

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Phase 3 demo complete!                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    await db.shutdown();
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Phase 3 example failed:', err);
    process.exit(1);
});
