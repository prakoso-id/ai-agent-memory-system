/**
 * PHASE 2 — Adaptive Learning & Context Optimization
 * Example usage demonstrating all new APIs.
 *
 * Run with:  bun run src/examples/phase2-usage.ts
 */

import { initializeDatabase } from '../database/init.js';
import { db } from '../database/connections.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { StrategyMemoryService } from '../memory/strategy-memory.js';
import { FeedbackTracker } from '../memory/feedback-tracker.js';
import { ContextCompressor } from '../memory/context-compression.js';
import { ContextBuilder } from '../agent/context-builder.js';
import { BehaviorEngine } from '../reflection/behavior-engine.js';

// ============================================================
// Bootstrap
// ============================================================

await initializeDatabase();
const memory = new MemoryManager('phase2-demo-session');
const strategies = memory.strategies;
const feedback = memory.feedback;
const compressor = new ContextCompressor();
const behavior = new BehaviorEngine();
const contextBuilder = new ContextBuilder(memory, strategies, behavior);

// ============================================================
// 1. Retrieval Feedback & Adaptive Scoring
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  1. Retrieval Feedback & Adaptive Scoring');
console.log('══════════════════════════════════════════');

// Seed some memories
const memories = await Promise.all([
    memory.semantic.store({
        content: 'The user prefers TypeScript over JavaScript for all projects.',
        category: 'user_preference',
        source: 'example',
        importance: 0.9,
        tags: ['typescript', 'user_preference'],
        metadata: {},
    }),
    memory.semantic.store({
        content: 'React hooks should always specify dependency arrays explicitly.',
        category: 'technical_detail',
        source: 'example',
        importance: 0.85,
        tags: ['react', 'coding', 'best_practice'],
        metadata: {},
    }),
    memory.semantic.store({
        content: 'The project uses PostgreSQL with connection pooling for production.',
        category: 'project_fact',
        source: 'example',
        importance: 0.8,
        tags: ['database', 'architecture'],
        metadata: {},
    }),
]);

// Record feedback — the first memory was used and helpful
if (memories[0]) {
    await feedback.recordFeedback({
        memory_id: memories[0].id,
        query: 'what language does the user prefer?',
        used: true,
        helpful: true,
    });

    // Record more positive feedback to build signal
    for (let i = 0; i < 4; i++) {
        await feedback.recordFeedback({
            memory_id: memories[0].id,
            query: 'language preferences',
            used: true,
            helpful: true,
        });
    }
}

// The second memory was retrieved but not helpful for the query
if (memories[1]) {
    await feedback.recordFeedback({
        memory_id: memories[1].id,
        query: 'what language does the user prefer?',
        used: false,
        helpful: false,
    });
}

// Check boost scores
if (memories[0] && memories[1]) {
    const boost0 = await feedback.getMemoryBoost(memories[0].id);
    const boost1 = await feedback.getMemoryBoost(memories[1].id);
    console.log(`\nMemory boost scores:`);
    console.log(`  TS preference (5x helpful): boost = ${boost0.toFixed(3)}`);  // > 1.0
    console.log(`  React hooks (unhelpful):    boost = ${boost1.toFixed(3)}`);  // < 1.0
}

// Check adaptive weights
const weights = await feedback.getAdaptiveWeights();
console.log('\nAdaptive reranking weights:');
console.log(`  semantic: ${weights.semanticSimilarity.toFixed(3)}`);
console.log(`  recency:  ${weights.recency.toFixed(3)}`);
console.log(`  importance: ${weights.importance.toFixed(3)}`);
console.log(`  taskRelevance: ${weights.taskRelevance.toFixed(3)}`);
console.log(`  popularity: ${weights.usagePopularity.toFixed(3)}`);

// ============================================================
// 2. Strategy Memory — Pattern Storage
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  2. Strategy Memory — Pattern Storage');
console.log('══════════════════════════════════════════');

// Store strategies (patterns, not just facts)
const strategy1 = await strategies.store({
    pattern: 'Comparison tables work better than prose for feature comparisons',
    evidence: 'Users engaged more with tabular comparisons in past 3 interactions',
    effectiveness: 0.8,
    domain: 'content_format',
    metadata: {},
});
console.log(`Stored strategy: "${strategy1.pattern}" (effectiveness: ${strategy1.effectiveness})`);

const strategy2 = await strategies.store({
    pattern: 'Include code examples alongside text explanations for technical topics',
    evidence: 'Technical questions answered with both code and text received positive feedback',
    effectiveness: 0.75,
    domain: 'response_style',
    metadata: {},
});
console.log(`Stored strategy: "${strategy2.pattern}" (effectiveness: ${strategy2.effectiveness})`);

const strategy3 = await strategies.store({
    pattern: 'Ask clarifying questions before providing long answers on ambiguous topics',
    evidence: 'Ambiguous questions answered directly often required follow-up corrections',
    effectiveness: 0.6,
    domain: 'communication',
    metadata: {},
});
console.log(`Stored strategy: "${strategy3.pattern}" (effectiveness: ${strategy3.effectiveness})`);

// Record outcomes — strategy 1 was used and effective
await strategies.recordOutcome(strategy1.id, true);
await strategies.recordOutcome(strategy1.id, true);
// Strategy 3 was used but not effective this time
await strategies.recordOutcome(strategy3.id, false);

// Retrieve top strategies
const topStrategies = await strategies.getTopStrategies(undefined, 3);
console.log('\nTop strategies after outcomes:');
for (const s of topStrategies) {
    console.log(`  [${s.domain}] ${s.pattern} → eff: ${s.effectiveness.toFixed(2)}`);
}

// Retrieve by domain
const contentStrategies = await strategies.getTopStrategies('content_format');
console.log(`\nContent format strategies: ${contentStrategies.length}`);

// ============================================================
// 3. Context Compression
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  3. Context Compression');
console.log('══════════════════════════════════════════');

// Token estimation
const longText = 'This is a sample memory content that contains multiple sentences about a topic. ' +
    'It includes technical details, user preferences, and other relevant information. ' +
    'The context compressor should be able to condense this into a shorter summary.';

const tokens = compressor.estimateTokens(longText);
console.log(`Token estimation: "${longText.substring(0, 50)}..." → ~${tokens} tokens`);

// Demonstrate compression tiers (requires LLM)
console.log('\nCompression tiers (simulated without LLM):');
console.log(`  raw     → ${tokens} tokens (original)`);
console.log(`  summary → ~${Math.ceil(tokens / 3)} tokens (estimated 3x reduction)`);
console.log(`  insight → ~${Math.ceil(tokens / 6)} tokens (estimated 6x reduction)`);

// ============================================================
// 4. Context Builder — Token-Aware Assembly
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  4. Context Builder — buildContext()');
console.log('══════════════════════════════════════════');

// Build context with token budget
const context = await contextBuilder.buildContext({
    query: 'What TypeScript patterns should I use for error handling?',
    max_tokens: 2048,
    priority: ['relevant', 'important', 'recent'],
    taskType: 'coding',
    include_strategies: true,
    include_directives: true,
});

console.log('\nBuilt context summary:');
console.log(`  Memories:     ${context.memories.length}`);
console.log(`  Strategies:   ${context.strategies.length}`);
console.log(`  Directives:   ${context.directives.length}`);
console.log(`  Total tokens: ~${context.totalTokens}`);
console.log(`  Compressed:   ${context.compressionApplied}`);

if (context.memories.length > 0) {
    console.log('\n  Memory details:');
    for (const m of context.memories) {
        console.log(
            `    [${m.tier}] ${m.compressedContent.substring(0, 60)}... ` +
            `(${m.originalTokens}→${m.compressedTokens} tokens)`,
        );
    }
}

if (context.strategies.length > 0) {
    console.log('\n  Strategy details:');
    for (const s of context.strategies) {
        console.log(`    [${s.domain}] ${s.pattern.substring(0, 60)}...`);
    }
}

// Build context with different priorities
const recentContext = await contextBuilder.buildContext({
    query: 'What happened in recent conversations?',
    max_tokens: 1024,
    priority: ['recent', 'relevant', 'important'],
    include_strategies: false,
});

console.log('\nRecent-priority context:');
console.log(`  Memories: ${recentContext.memories.length}, ~${recentContext.totalTokens} tokens`);

// ============================================================
// 5. Retrieval with Adaptive Scoring (end-to-end)
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  5. End-to-End Adaptive Retrieval');
console.log('══════════════════════════════════════════');

// Query with adaptive scoring enabled (feedback boosts auto-applied)
const results = await memory.query({
    task: 'What language and framework does the user prefer?',
    taskType: 'chat',
    limit: 5,
});

console.log('\nAdaptive retrieval results:');
for (const r of results) {
    console.log(
        `  [${r.source}] score=${r.score.totalScore.toFixed(3)} ` +
        `"${r.memory.content.substring(0, 60)}"`,
    );
}

// Record batch feedback from this retrieval
await memory.recordFeedback(
    'What language and framework does the user prefer?',
    results.map((r, i) => ({
        memory_id: r.score.memoryId,
        used: i < 2,          // used the top 2
        helpful: i === 0,     // only the first was truly helpful
    })),
);

console.log(`\nRecorded feedback for ${results.length} retrieved memories.`);

// ============================================================
// Summary
// ============================================================

const stats = await memory.getStats();
console.log('\n══════════════════════════════════════════');
console.log('  📊 Final Memory Statistics');
console.log('══════════════════════════════════════════');
console.log(`  Episodic memories : ${stats.episodic}`);
console.log(`  Semantic memories : ${stats.semantic}`);
console.log(`  Reflections       : ${stats.reflections}`);
console.log(`  Knowledge nodes   : ${stats.graphNodes}`);
console.log(`  Strategies        : ${stats.strategies}`);
console.log(`  Interactions      : ${stats.interactions}`);

// ============================================================
// Cleanup
// ============================================================

await db.shutdown();
console.log('\n✅ Phase 2 example complete.\n');
