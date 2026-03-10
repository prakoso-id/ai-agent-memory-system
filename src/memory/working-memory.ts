import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import { config } from '../config/index.js';
import type { ConversationMessage, WorkingMemoryState } from './types.js';

const PREFIX = 'wm';    // Redis key prefix

/**
 * Working Memory — Redis-backed short-term context.
 * Stores the current conversation history and transient context.
 */
export class WorkingMemory {
    private sessionId: string;
    private ttl: number;

    constructor(sessionId?: string) {
        this.sessionId = sessionId ?? uuid();
        this.ttl = config.agent.workingMemoryTTL;
    }

    getSessionId(): string {
        return this.sessionId;
    }

    // ---- Keys ----
    private messagesKey(): string {
        return `${PREFIX}:${this.sessionId}:messages`;
    }
    private contextKey(): string {
        return `${PREFIX}:${this.sessionId}:context`;
    }

    // ---- Messages ----

    /** Append a message to the conversation history */
    async addMessage(role: ConversationMessage['role'], content: string): Promise<void> {
        const msg: ConversationMessage = {
            role,
            content,
            timestamp: new Date().toISOString(),
        };
        await db.redis.rpush(this.messagesKey(), JSON.stringify(msg));
        await db.redis.expire(this.messagesKey(), this.ttl);
    }

    /** Get the full conversation history */
    async getMessages(): Promise<ConversationMessage[]> {
        const raw = await db.redis.lrange(this.messagesKey(), 0, -1);
        return raw.map((r) => JSON.parse(r) as ConversationMessage);
    }

    /** Get the last N messages */
    async getRecentMessages(count: number): Promise<ConversationMessage[]> {
        const raw = await db.redis.lrange(this.messagesKey(), -count, -1);
        return raw.map((r) => JSON.parse(r) as ConversationMessage);
    }

    // ---- Context ----

    /** Set a context value */
    async setContext(key: string, value: unknown): Promise<void> {
        await db.redis.hset(this.contextKey(), key, JSON.stringify(value));
        await db.redis.expire(this.contextKey(), this.ttl);
    }

    /** Get a context value */
    async getContext(key: string): Promise<unknown | null> {
        const val = await db.redis.hget(this.contextKey(), key);
        return val ? JSON.parse(val) : null;
    }

    /** Get the full working memory state */
    async getState(): Promise<WorkingMemoryState> {
        const messages = await this.getMessages();
        const contextRaw = await db.redis.hgetall(this.contextKey());
        const activeContext: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(contextRaw)) {
            activeContext[k] = JSON.parse(v);
        }
        return { sessionId: this.sessionId, messages, activeContext };
    }

    /** Clear working memory for this session */
    async clear(): Promise<void> {
        await db.redis.del(this.messagesKey(), this.contextKey());
    }
}
