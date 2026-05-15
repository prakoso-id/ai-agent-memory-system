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

        // BUG-006: support separate REDIS_PASSWORD env var injected into the URL if not already present
        const redisUrl = (() => {
            const url = config.redis.url;
            const sep = process.env.REDIS_PASSWORD;
            if (sep && !url.includes('@') && url.startsWith('redis://')) {
                return url.replace('redis://', `redis://:${encodeURIComponent(sep)}@`);
            }
            return url;
        })();

        // Redis
        this.redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        this.redis.on('error', (err) => console.error('Redis error:', err.message));
        await this.redis.ping();
        console.log('  ✅ Redis connected');

        // PostgreSQL (SEC-005: optional SSL via POSTGRES_SSL=true)
        this.pg = new Pool({
            host: config.postgres.host,
            port: config.postgres.port,
            user: config.postgres.user,
            password: config.postgres.password,
            database: config.postgres.database,
            max: 10,
            ssl: config.postgres.ssl ? { rejectUnauthorized: false } : false,
        });
        await this.pg.query('SELECT 1');
        console.log('  ✅ PostgreSQL connected');

        // Qdrant
        this.qdrant = new QdrantClient({
            url: config.qdrant.url,
            ...(config.qdrant.apiKey ? { apiKey: config.qdrant.apiKey } : {}),
        });
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

    /** ENH-007: Per-service health check — returns 'ok' or 'error' per service */
    async checkHealth(): Promise<Record<string, 'ok' | 'error'>> {
        const results: Record<string, 'ok' | 'error'> = {};
        await Promise.all([
            this.redis.ping().then(() => { results.redis = 'ok'; }).catch(() => { results.redis = 'error'; }),
            this.pg.query('SELECT 1').then(() => { results.postgres = 'ok'; }).catch(() => { results.postgres = 'error'; }),
            this.qdrant.getCollections().then(() => { results.qdrant = 'ok'; }).catch(() => { results.qdrant = 'error'; }),
            this.neo4j.getServerInfo().then(() => { results.neo4j = 'ok'; }).catch(() => { results.neo4j = 'error'; }),
        ]);
        return results;
    }
}

/** Global accessor for database connections */
export const db = DatabaseConnections.getInstance();
