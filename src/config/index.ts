import 'dotenv/config';

export const config = {
    // LLM
    llm: {
        provider: process.env.LLM_PROVIDER || 'lmstudio',
        baseUrl: process.env.LLM_BASE_URL || 'http://localhost:1234/v1',
        apiKey: process.env.LLM_API_KEY || 'lm-studio',
        model: process.env.LLM_MODEL || 'deepseek-r1',
        embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
    },

    // Redis
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },

    // PostgreSQL
    postgres: {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        user: process.env.POSTGRES_USER || 'agent',
        password: process.env.POSTGRES_PASSWORD || 'agent_secret',
        database: process.env.POSTGRES_DB || 'agent_memory',
    },

    // Qdrant
    qdrant: {
        url: process.env.QDRANT_URL || 'http://localhost:6333',
        collection: process.env.QDRANT_COLLECTION || 'semantic_memory',
    },

    // Neo4j
    neo4j: {
        uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
        user: process.env.NEO4J_USER || 'neo4j',
        password: process.env.NEO4J_PASSWORD || 'agent_secret',
    },

    // Agent settings
    agent: {
        memoryRetrievalLimit: parseInt(process.env.MEMORY_RETRIEVAL_LIMIT || '7'),
        memoryDecayFactor: parseFloat(process.env.MEMORY_DECAY_FACTOR || '0.01'),
        workingMemoryTTL: parseInt(process.env.WORKING_MEMORY_TTL || '3600'),
    },

    // Context Builder (Phase 2)
    contextBuilder: {
        defaultMaxTokens: parseInt(process.env.CONTEXT_MAX_TOKENS || '2048'),
        compressionThreshold: parseFloat(process.env.COMPRESSION_THRESHOLD || '0.7'),
    },

    // Memory Evolution (Phase 3)
    evolution: {
        conflictSimilarityThreshold: parseFloat(process.env.CONFLICT_SIMILARITY_THRESHOLD || '0.75'),
        confidenceDecayRate: parseFloat(process.env.CONFIDENCE_DECAY_RATE || '0.005'),
        staleArchiveDays: parseInt(process.env.STALE_ARCHIVE_DAYS || '30'),
        promotionUsageThreshold: parseInt(process.env.PROMOTION_USAGE_THRESHOLD || '5'),
        promotionConfidenceThreshold: parseFloat(process.env.PROMOTION_CONFIDENCE_THRESHOLD || '0.7'),
    },

    // Server settings
    server: {
        port: parseInt(process.env.API_PORT || '3001'),
        corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()),
        apiKeys: (process.env.API_KEYS || 'dev-key-change-me').split(',').map(s => s.trim()),
    },
} as const;

export type Config = typeof config;
