/**
 * Phase 4 Usage Example
 *
 * Demonstrates:
 *   â€¢ Enhancement 2 â€” Cross-Agent / Role-Based Memory Partitioning
 *   â€¢ Enhancement 3 â€” Redis Semantic Caching
 *   â€¢ Enhancement 1 â€” Observability metrics & advisories
 *
 * Prerequisites: docker-compose up -d && bun run db:init
 * Run: bun run example:phase4
 */

import 'dotenv/config';
import { initializeDatabase } from '../database/init.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { db } from '../database/connections.js';

console.log('â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
console.log('â•‘   Phase 4 â€” Observability, Scalability & Efficiency      â•‘');
console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');

async function main() {
    await initializeDatabase();
    const memory = new MemoryManager('dashboard-demo-session');

    // ================================================================
    // DEMO 1 â€” Semantic Cache (Enhancement 3)
    // ================================================================
    console.log('â”â”â” Demo 1: Semantic Cache â”â”â”\n');

    const queryA = 'How should I configure webpack for production?';
    const queryB = 'What is the best webpack configuration for prod?';   // semantically similar

    // First call â€” cache miss, simulate LLM response
    const resultA = await memory.cachedQuery(
        { task: queryA, taskType: 'coding' },
        async () => {
            console.log('  ðŸ¤– [LLM called] Generating response for query Aâ€¦');
            return 'Use mode: "production" and enable TerserPlugin for tree-shaking.';
        },
    );
    console.log(`  cacheHit=${resultA.cacheHit} llmResponse="${resultA.llmResponse}"`);

    // Second call â€” high semantic similarity, should hit cache
    console.log('\n  Issuing semantically similar queryâ€¦');
    const resultB = await memory.cachedQuery(
        { task: queryB, taskType: 'coding' },
        async () => {
            console.log('  ðŸ¤– [LLM called] â€” this should NOT appear on a cache hit');
            return 'This response should be cached.';
        },
    );
    console.log(`  cacheHit=${resultB.cacheHit} (expected: true if similarity â‰¥ 0.95)`);

    const cacheStats = await memory.cache.getStats();
    console.log(`\n  Cache stats: entries=${cacheStats.totalEntries} hitRate=${(cacheStats.hitRate * 100).toFixed(1)}% hits=${cacheStats.totalHits} misses=${cacheStats.totalMisses}\n`);

    // ================================================================
    // DEMO 2 â€” Role-Based Memory Partitioning (Enhancement 2)
    // ================================================================
    console.log('â”â”â” Demo 2: Role-Based Memory Partitioning â”â”â”\n');

    // Store a memory that is highly relevant to the Coder agent
    const webpackMemId = await memory.roles.store({
        content: 'webpack config: mode=production enables TerserPlugin automatically',
        category: 'project_fact',
        source: 'api',
        importance: 0.8,
        tags: ['webpack', 'build', 'config'],
        metadata: {},
        roles: ['coder'],                              // visible to coders only
        importance_per_role: { coder: 0.9, pm: 0.2 }, // coder: high, pm: low
    });
    console.log(`  Stored webpack memory for role=[coder]: ${webpackMemId?.substring(0, 8)}`);

    // Store a memory relevant to the PM agent
    const roadmapMemId = await memory.roles.store({
        content: 'Q2 roadmap: ship dark mode by end of April',
        category: 'project_fact',
        source: 'api',
        importance: 0.8,
        tags: ['roadmap', 'planning'],
        metadata: {},
        roles: ['pm', 'analyst'],                      // PM + analyst only
        importance_per_role: { pm: 0.95, coder: 0.1, analyst: 0.7 },
    });
    console.log(`  Stored roadmap memory for role=[pm, analyst]: ${roadmapMemId?.substring(0, 8)}\n`);

    // Coder agent queries
    const coderResults = await memory.roleQuery({
        task: 'webpack production configuration',
        agentRole: 'coder',
        taskType: 'coding',
        limit: 3,
    });
    console.log(`  Coder query "webpack production config" â†’ ${coderResults.length} results`);
    coderResults.forEach((r, i) =>
        console.log(`    [${i + 1}] score=${r.score.totalScore.toFixed(3)} "${r.memory.content.substring(0, 70)}"`)
    );

    // PM agent queries â€” should see roadmap, not webpack (or webpack with low relevance)
    const pmResults = await memory.roleQuery({
        task: 'quarterly planning and roadmap',
        agentRole: 'pm',
        taskType: 'planning',
        limit: 3,
    });
    console.log(`\n  PM query "quarterly planning and roadmap" â†’ ${pmResults.length} results`);
    pmResults.forEach((r, i) =>
        console.log(`    [${i + 1}] score=${r.score.totalScore.toFixed(3)} "${r.memory.content.substring(0, 70)}"`)
    );

    // Role distribution
    const dist = await memory.roles.getRoleDistribution();
    console.log('\n  Role distribution:', dist);

    // ================================================================
    // DEMO 3 â€” Observability Metrics (Enhancement 1)
    // ================================================================
    console.log('\nâ”â”â” Demo 3: Phase 4 Metrics & Advisories â”â”â”\n');

    const metrics = await memory.getDashboardMetrics();
    console.log('  Phase 4 Metrics:');
    console.log(`    Cache hit rate:    ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`    Cache entries:     ${metrics.cacheEntries}`);
    console.log(`    Avg latency p50:   ${metrics.avgRetrievalLatencyMs.toFixed(0)}ms`);
    console.log(`    Conflict freq:     ${metrics.conflictFrequency.toFixed(1)} per 100 memories`);
    console.log(`    Promotion rate:    ${metrics.promotionRate.toFixed(1)} per 100 episodic`);
    console.log(`    Role distribution:`, metrics.roleDistribution);

    const advisories = await memory.getAdvisories();
    console.log('\n  Self-Healing Advisories:');
    advisories.forEach((a, i) => console.log(`    [${i + 1}] ${a}`));

    // ================================================================
    // CLEANUP
    // ================================================================
    console.log('\nâ”â”â” Cleanup â”â”â”\n');
    await memory.cache.flush();
    console.log('  Semantic cache flushed.\n');

    console.log('âœ… Phase 4 demo complete.\n');
    await db.shutdown();
}

main().catch((err) => {
    console.error('ðŸ’¥ Phase 4 example failed:', err);
    process.exit(1);
});
