/**
 * PHASE 1 — Memory Foundation Improvements
 * Example usage demonstrating all new APIs.
 *
 * Run with:  bun run src/examples/phase1-usage.ts
 */

import { initializeDatabase } from '../database/init.js';
import { db } from '../database/connections.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { inferTaskType, scoreTaskRelevance } from '../memory/utils/task-relevance.js';
import { passesImportanceFilter, IMPORTANCE_THRESHOLD, NOVELTY_THRESHOLD } from '../memory/utils/write-filter.js';

// ============================================================
// Bootstrap
// ============================================================

await initializeDatabase();
const memory = new MemoryManager('phase1-demo-session');

// ============================================================
// 1. Write Filtering — importance threshold
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  1. Write Filtering — Importance Threshold');
console.log('══════════════════════════════════════════');

const lowImportance = 0.05;
const highImportance = 0.85;

console.log(`Threshold = ${IMPORTANCE_THRESHOLD}`);
console.log(`passesImportanceFilter(${lowImportance})  → ${passesImportanceFilter(lowImportance)}`);   // false
console.log(`passesImportanceFilter(${highImportance}) → ${passesImportanceFilter(highImportance)}`);   // true

// Storing below threshold — returns null, no LLM embedding call is made
const filtered = await memory.semantic.store({
    content: 'ok',
    category: 'general_knowledge',
    source: 'example',
    importance: 0.05,   // below threshold
    tags: [],
    metadata: {},
});
console.log('Low-importance store result:', filtered); // null

// ============================================================
// 2. Write Filtering — Novelty (duplicate detection)
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  2. Write Filtering — Novelty Detection');
console.log('══════════════════════════════════════════');
console.log(`Novelty threshold (cosine) = ${NOVELTY_THRESHOLD}`);

// First store — should succeed
const original = await memory.semantic.store({
    content: 'The user prefers TypeScript over JavaScript for all new projects.',
    category: 'user_preference',
    source: 'example',
    importance: 0.9,
    tags: ['user_preference', 'typescript', 'coding'],
    metadata: {},
});
console.log('First store  → id:', original?.id?.substring(0, 8), '  usage_count:', original?.usage_count);

// Near-duplicate store — should NOT create a new entry; bumps usage_count instead
const duplicate = await memory.semantic.store({
    content: 'The user prefers TypeScript for every new project over JavaScript.',
    category: 'user_preference',
    source: 'example',
    importance: 0.9,
    tags: ['user_preference', 'typescript'],
    metadata: {},
});
console.log('Duplicate store → id:', duplicate?.id?.substring(0, 8), '  usage_count:', duplicate?.usage_count);
// Same ID, usage_count incremented

// ============================================================
// 3. Task Type Inference + Relevance Scoring
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  3. Task Type Inference + Relevance Scoring');
console.log('══════════════════════════════════════════');

const tasks = [
    'Fix TypeScript compilation error in auth.ts',
    'Plan the database migration strategy',
    'Analyze the API response time metrics',
    "What's the user's preferred framework?",
    'General question about the project',
];

for (const task of tasks) {
    const taskType = inferTaskType(task);
    console.log(`  "${task.substring(0, 50)}" → ${taskType}`);
}

// Tag-based task relevance
const codingTags  = ['typescript', 'bug', 'function'];
const planningTags = ['roadmap', 'milestone', 'feature'];

console.log('\nTag relevance scores:');
console.log('  coding tags  vs coding  task:', scoreTaskRelevance(codingTags, 'coding').toFixed(2));
console.log('  coding tags  vs planning task:', scoreTaskRelevance(codingTags, 'planning').toFixed(2));
console.log('  planning tags vs planning task:', scoreTaskRelevance(planningTags, 'planning').toFixed(2));

// ============================================================
// 4. Context-Aware Retrieval via memory.query()
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  4. Unified memory.query() API');
console.log('══════════════════════════════════════════');

// Seed a few diverse memories first
await Promise.all([
    memory.semantic.store({
        content: 'The user always enables strict mode in TypeScript projects.',
        category: 'user_preference',
        source: 'example',
        importance: 0.9,
        tags: ['typescript', 'coding', 'user_preference'],
        metadata: {},
    }),
    memory.semantic.store({
        content: 'The project uses PostgreSQL for persistent storage and Redis for caching.',
        category: 'project_fact',
        source: 'example',
        importance: 0.85,
        tags: ['database', 'architecture', 'planning'],
        metadata: {},
    }),
    memory.semantic.store({
        content: 'A previous bug was caused by unhandled promise rejections in the API layer.',
        category: 'technical_detail',
        source: 'example',
        importance: 0.8,
        tags: ['bug', 'coding', 'error', 'api'],
        metadata: {},
    }),
]);

// Query with coding context — task_relevance will boost coding-tagged memories
const codingResults = await memory.query({
    task: 'Debug TypeScript async error in API handler',
    context: 'The error occurs when the promise is rejected without a catch block',
    taskType: 'coding',
    limit: 5,
});

console.log('\nCoding query results:');
for (const r of codingResults) {
    console.log(
        `  [${r.source}] score=${r.score.totalScore.toFixed(3)} ` +
        `taskRel=${r.score.taskRelevance.toFixed(2)} ` +
        `usage=${r.memory.usage_count} ` +
        `"${r.memory.content.substring(0, 70)}"`,
    );
}

// Same underlying data but planning context — different ranking
const planningResults = await memory.query({
    task: 'Design the data persistence architecture',
    taskType: 'planning',
    limit: 5,
});

console.log('\nPlanning query results:');
for (const r of planningResults) {
    console.log(
        `  [${r.source}] score=${r.score.totalScore.toFixed(3)} ` +
        `taskRel=${r.score.taskRelevance.toFixed(2)} ` +
        `"${r.memory.content.substring(0, 70)}"`,
    );
}

// ============================================================
// 5. Low-level retrieve() with source filter
// ============================================================

console.log('\n══════════════════════════════════════════');
console.log('  5. retrieve() with source filter');
console.log('══════════════════════════════════════════');

const semanticOnly = await memory.retrieve({
    query: 'TypeScript project preferences',
    taskType: 'coding',
    limit: 3,
    filters: { source: ['semantic'] },
});

console.log(`Semantic-only results (${semanticOnly.length}):`);
for (const r of semanticOnly) {
    console.log(`  [${r.source}] ${r.memory.content.substring(0, 80)}`);
}

// ============================================================
// Cleanup
// ============================================================

await db.shutdown();
console.log('\n✅ Phase 1 example complete.\n');
