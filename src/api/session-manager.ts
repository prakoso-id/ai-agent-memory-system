import { AgentController } from '../agent/agent-controller.js';

interface SessionInfo {
    sessionId: string;
    createdAt: string;
    lastActivity: string;
    interactionCount: number;
}

/**
 * Session Manager — pools multiple AgentController instances.
 * Each session has its own memory context and conversation history.
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

    /** Create a new session, optionally with a specific ID */
    createSession(sessionId?: string): { agent: AgentController; sessionId: string } {
        const agent = new AgentController(sessionId);
        const id = agent.getSessionId();

        this.sessions.set(id, {
            agent,
            info: {
                sessionId: id,
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                interactionCount: 0,
            },
        });

        console.log(`  📌 Session created: ${id}`);
        return { agent, sessionId: id };
    }

    /** Get an existing session, or create one if sessionId is provided but doesn't exist */
    getOrCreate(sessionId?: string): { agent: AgentController; sessionId: string } {
        if (sessionId && this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId)!;
            session.info.lastActivity = new Date().toISOString();
            return { agent: session.agent, sessionId };
        }
        return this.createSession(sessionId);
    }

    /** Get an existing session */
    getSession(sessionId: string): AgentController | undefined {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.info.lastActivity = new Date().toISOString();
        }
        return session?.agent;
    }

    /** Track interaction for a session */
    trackInteraction(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.info.interactionCount++;
            session.info.lastActivity = new Date().toISOString();
        }
    }

    /** List all active sessions */
    listSessions(): SessionInfo[] {
        return Array.from(this.sessions.values()).map((s) => s.info);
    }

    /** Delete a session */
    deleteSession(sessionId: string): boolean {
        const deleted = this.sessions.delete(sessionId);
        if (deleted) console.log(`  🗑️  Session deleted: ${sessionId}`);
        return deleted;
    }

    /** Remove expired sessions */
    private cleanup(): void {
        const now = Date.now();
        for (const [id, session] of this.sessions) {
            const lastActive = new Date(session.info.lastActivity).getTime();
            if (now - lastActive > this.ttlMs) {
                this.sessions.delete(id);
                console.log(`  ♻️  Session expired: ${id}`);
            }
        }
    }

    /** Shutdown cleanup interval */
    destroy(): void {
        clearInterval(this.cleanupInterval);
    }
}
