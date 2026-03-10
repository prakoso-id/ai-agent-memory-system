import Redis from 'ioredis';
import pg from 'pg';
import { QdrantClient } from '@qdrant/js-client-rest';
import neo4j, { type Driver as Neo4jDriver } from 'neo4j-driver';
import { config } from '../config/index.js';

const { Pool } = pg;

/**
 * Singleton database connection manager.
 * Handles lifecycle for Redis, PostgreSQL, Qdrant, and Neo4j.
 */
class DatabaseConnections {
    private static instance: DatabaseConnections;

    public redis!: Redis;
    public pg!: pg.Pool;
    public qdrant!: QdrantClient;
    public neo4j!: Neo4jDriver;

    private initialized = false;

    private constructor() { }

    static getInstance(): DatabaseConnections {
        if (!DatabaseConnections.instance) {
            DatabaseConnections.instance = new DatabaseConnections();
        }
        return DatabaseConnections.instance;
    }

    /** Initialize all database connections */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('🔌 Initializing database connections...');

        // Redis
        this.redis = new Redis(config.redis.url, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        this.redis.on('error', (err) => console.error('Redis error:', err.message));
        await this.redis.ping();
        console.log('  ✅ Redis connected');

        // PostgreSQL
        this.pg = new Pool({
            host: config.postgres.host,
            port: config.postgres.port,
            user: config.postgres.user,
            password: config.postgres.password,
            database: config.postgres.database,
            max: 10,
        });
        await this.pg.query('SELECT 1');
        console.log('  ✅ PostgreSQL connected');

        // Qdrant
        this.qdrant = new QdrantClient({ url: config.qdrant.url });
        await this.qdrant.getCollections(); // health check
        console.log('  ✅ Qdrant connected');

        // Neo4j
        this.neo4j = neo4j.driver(
            config.neo4j.uri,
            neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
        );
        const neo4jInfo = await this.neo4j.getServerInfo();
        console.log(`  ✅ Neo4j connected (${neo4jInfo.address})`);

        this.initialized = true;
        console.log('🔌 All databases connected.\n');
    }

    /** Graceful shutdown of all connections */
    async shutdown(): Promise<void> {
        console.log('\n🔌 Shutting down database connections...');
        try { await this.redis.quit(); } catch { }
        try { await this.pg.end(); } catch { }
        try { await this.neo4j.close(); } catch { }
        this.initialized = false;
        console.log('🔌 All connections closed.');
    }
}

/** Global accessor for database connections */
export const db = DatabaseConnections.getInstance();
