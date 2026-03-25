import { db } from './connections.js';
import { config } from '../config/index.js';
import { llm } from '../llm/llm-client.js';

/**
 * Initialize all database schemas on first run.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export async function initializeDatabase(): Promise<void> {
    await db.initialize();

    console.log('📦 Initializing database schemas...\n');

    // ---- PostgreSQL: Episodic Memory ----
    await db.pg.query(`
    CREATE TABLE IF NOT EXISTS episodic_memories (
      id            UUID PRIMARY KEY,
      event_type    VARCHAR(50) NOT NULL,
      session_id    VARCHAR(100) NOT NULL,
      content       TEXT NOT NULL,
      task          TEXT,
      result        VARCHAR(20),
      context       TEXT,
      importance    REAL NOT NULL DEFAULT 0.5,
      usage_count   INTEGER NOT NULL DEFAULT 0,
      last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      tags          TEXT[] DEFAULT '{}',
      metadata      JSONB DEFAULT '{}',
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_episodic_session    ON episodic_memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_episodic_event      ON episodic_memories(event_type);
    CREATE INDEX IF NOT EXISTS idx_episodic_created    ON episodic_memories(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memories(importance DESC);
  `);

    // Phase 1 migration: add columns to pre-existing tables (safe to run repeatedly)
    await db.pg.query(`
    ALTER TABLE episodic_memories
      ADD COLUMN IF NOT EXISTS usage_count   INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS tags          TEXT[] DEFAULT '{}';

    CREATE INDEX IF NOT EXISTS idx_episodic_tags ON episodic_memories USING gin(tags);
  `);
    console.log('  ✅ episodic_memories table ready');

    // ---- PostgreSQL: Reflection Memory ----
    await db.pg.query(`
    CREATE TABLE IF NOT EXISTS reflection_memories (
      id                    UUID PRIMARY KEY,
      content               TEXT NOT NULL,
      observation           TEXT NOT NULL,
      root_cause            TEXT NOT NULL,
      lesson_learned        TEXT NOT NULL,
      strategy_improvement  TEXT NOT NULL,
      related_episode_ids   UUID[] DEFAULT '{}',
      importance            REAL NOT NULL DEFAULT 0.7,
      usage_count           INTEGER NOT NULL DEFAULT 0,
      last_accessed         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      tags                  TEXT[] DEFAULT '{}',
      metadata              JSONB DEFAULT '{}',
      created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_reflection_created    ON reflection_memories(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reflection_importance ON reflection_memories(importance DESC);
  `);

    // Phase 1 migration: add columns to pre-existing reflection table
    await db.pg.query(`
    ALTER TABLE reflection_memories
      ADD COLUMN IF NOT EXISTS usage_count   INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS tags          TEXT[] DEFAULT '{}';

    CREATE INDEX IF NOT EXISTS idx_reflection_tags ON reflection_memories USING gin(tags);
  `);
    console.log('  ✅ reflection_memories table ready');

    // ---- Qdrant: Semantic Memory Collection ----
    // Auto-detect embedding dimension from LLM
    console.log('  🔍 Detecting embedding dimension from LLM...');
    const testEmbedding = await llm.embed('dimension test');
    const embeddingSize = testEmbedding.length;
    console.log(`  📐 Embedding dimension: ${embeddingSize}`);

    const collections = await db.qdrant.getCollections();
    const existing = collections.collections.find(
        (c) => c.name === config.qdrant.collection,
    );

    if (existing) {
        // Check if dimension matches
        const info = await db.qdrant.getCollection(config.qdrant.collection);
        const currentSize = (info.config?.params?.vectors as { size?: number })?.size;
        if (currentSize && currentSize !== embeddingSize) {
            console.log(`  ⚠️  Collection dimension mismatch: ${currentSize} → ${embeddingSize}. Recreating...`);
            await db.qdrant.deleteCollection(config.qdrant.collection);
            await db.qdrant.createCollection(config.qdrant.collection, {
                vectors: { size: embeddingSize, distance: 'Cosine' },
            });
            console.log(`  ✅ Qdrant collection "${config.qdrant.collection}" recreated (dim=${embeddingSize})`);
        } else {
            console.log(`  ✅ Qdrant collection "${config.qdrant.collection}" exists (dim=${currentSize})`);
        }
    } else {
        await db.qdrant.createCollection(config.qdrant.collection, {
            vectors: { size: embeddingSize, distance: 'Cosine' },
        });
        console.log(`  ✅ Qdrant collection "${config.qdrant.collection}" created (dim=${embeddingSize})`);
    }

    // ---- Neo4j: Knowledge Graph Constraints ----
    const neo4jSession = db.neo4j.session();
    try {
        await neo4jSession.run(`
      CREATE CONSTRAINT entity_id IF NOT EXISTS
      FOR (e:Entity)
      REQUIRE e.id IS UNIQUE
    `);
        console.log('  ✅ Neo4j constraints ready');
    } finally {
        await neo4jSession.close();
    }

    console.log('\n📦 All schemas initialized.\n');
}

// Allow running directly: bun run src/database/init.ts
const isMainModule = process.argv[1]?.endsWith('init.ts') || process.argv[1]?.endsWith('init.js');
if (isMainModule) {
    initializeDatabase()
        .then(() => db.shutdown())
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ Database init failed:', err);
            process.exit(1);
        });
}
