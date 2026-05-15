import { AgentController } from '../agent/agent-controller.js';
import { db } from '../database/connections.js';

interface SessionInfo {
    sessionId: string;
    createdAt: string;
    lastActivity: string;
    interactionCount: number;
}

const SESSION_KEY_PREFIX = 'session:meta:';
const SESSION_INDEX_KEY  = 'session:index';

/**
 * Session Manager — pools multiple AgentController instances.
 * Session metadata is persisted to Redis (ENH-005) so that the dashboard
 * survives server restarts. The AgentController itself is re-hydrated on
 * first access — conversation history is already in Redis via WorkingMemory.
 */
export class SessionManager {
    private sessions = new Map<string, { agent: AgentController; info: SessionInfo }>();
    private ttlMs: number;
    private cleanupInterval: ReturnType<typeof setInterval>;

    constructor(ttlMs = 3600_000) { // default 1 hour
        this.ttlMs = ttlMs;
        // Cleanup expired sessions every 5 minutes
        this.cleanupInterval = setInterval(() => this.cleanup(), 300_000);
    }

    /** Load persisted session metadata from Redis on startup */
    async loadFromRedis(): Promise<void> {
        try {
            const ids = await db.redis.smembers(SESSION_INDEX_KEY);
            for (const id of ids) {
                const raw = await db.redis.get(`${SESSION_KEY_PREFIX}${id}`);
                if (!raw) continue;
                const info: SessionInfo = JSON.parse(raw);
                // Re-hydrate with a new AgentController — WorkingMemory will load history from Redis
                const agent = new AgentController(id);
                this.sessions.set(id, { agent, info });
            }
            if (ids.length > 0) console.log(`  📂 Restored ${ids.length} session(s) from Redis`);
        } catch {
            // Non-fatal: Redis may not have any persisted sessions on first run
        }
    }

    /** Persist a session's metadata to Redis */
    private async persistToRedis(info: SessionInfo): Promise<void> {
        try {
            const ttlSec = Math.ceil(this.ttlMs / 1000);
            await db.redis.setex(`${SESSION_KEY_PREFIX}${info.sessionId}`, ttlSec, JSON.stringify(info));
            await db.redis.sadd(SESSION_INDEX_KEY, info.sessionId);
        } catch { /* best-effort */ }
    }

    /** Remove a session's metadata from Redis */
    private async removeFromRedis(sessionId: string): Promise<void> {
        try {
            await db.redis.del(`${SESSION_KEY_PREFIX}${sessionId}`);
            await db.redis.srem(SESSION_INDEX_KEY, sessionId);
        } catch { /* best-effort */ }
    }

    /** Create a new session, optionally with a specific ID */
    createSession(sessionId?: string): { agent: AgentController; sessionId: string } {
        const agent = new AgentController(sessionId);
        const id = agent.getSessionId();

        const info: SessionInfo = {
            sessionId: id,
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            interactionCount: 0,
        };
        this.sessions.set(id, { agent, info });
        void this.persistToRedis(info);

        console.log(`  📌 Session created: ${id}`);
        return { agent, sessionId: id };
    }

    /** Get an existing session, or create one if sessionId is provided but doesn't exist */
    getOrCreate(sessionId?: string): { agent: AgentController; sessionId: string } {
        if (sessionId && this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId)!;
            session.info.lastActivity = new Date().toISOString();
            void this.persistToRedis(session.info);
            return { agent: session.agent, sessionId };
        }
        return this.createSession(sessionId);
    }

    /** Get an existing session */
    getSession(sessionId: string): AgentController | undefined {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.info.lastActivity = new Date().toISOString();
            void this.persistToRedis(session.info);
        }
        return session?.agent;
    }

    /** Track interaction for a session */
    trackInteraction(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.info.interactionCount++;
            session.info.lastActivity = new Date().toISOString();
            void this.persistToRedis(session.info);
        }
    }

    /** List all active sessions */
    listSessions(): SessionInfo[] {
        return Array.from(this.sessions.values()).map((s) => s.info);
    }

    /** Delete a session */
    deleteSession(sessionId: string): boolean {
        const deleted = this.sessions.delete(sessionId);
        if (deleted) {
            void this.removeFromRedis(sessionId);
            console.log(`  🗑️  Session deleted: ${sessionId}`);
        }
        return deleted;
    }

    /** Remove expired sessions */
    private cleanup(): void {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            const lastActive = new Date(session.info.lastActivity).getTime();
            if (now - lastActive > this.ttlMs) {
                this.sessions.delete(id);
                void this.removeFromRedis(id);
                console.log(`  ♻️  Session expired: ${id}`);
            }
        }
    }

    /** Shutdown cleanup interval */
    destroy(): void {
        clearInterval(this.cleanupInterval);
    }
}
